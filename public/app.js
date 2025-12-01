const DB_NAME = 'lakeLogger';
const DB_VERSION = 1;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('readings')) {
        const store = db.createObjectStore('readings', { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_synced', 'synced');
        store.createIndex('by_time', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function reqToPromise(req){
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function txDone(tx){
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('tx aborted'));
  });
}
async function withStore(mode, fn){
  if (!db) db = await openDB();
  const tx = db.transaction('readings', mode);
  const store = tx.objectStore('readings');
  const out = await fn(store, reqToPromise);
  await txDone(tx);
  return out;
}

const $ = (sel) => document.querySelector(sel);

const padEl = $('#pad');
const lastSavedEl = $('#last-saved');
const liveLineEl = $('#live-line');
const fishBtn = $('#fish-btn');
const coordBadge = $('#coord-status');
const syncBtn = $('#sync-btn');
const exportBtn = $('#export-btn');
const dataBtn = $('#data-btn');
const locBtn = $('#loc-btn');
const screenLogger = $('#screen-logger');
const screenData = $('#screen-data');
const screenMap = $('#screen-map');
const mapBtn = $('#map-btn');
const dataTableBody = document.querySelector('#data-table tbody');
let depthMap = null;

let highRange = false;
let awaitingDecimal = null;
let currentScreen = 'logger';

// Live tracking
let watchId = null;
let liveFix = null; // { latitude, longitude, accuracy, ts }
let lastSavedPoint = null;

function showScreen(which){
  currentScreen = which;
  screenLogger.classList.toggle('active', which === 'logger');
  screenData.classList.toggle('active', which === 'data');
  screenMap.classList.toggle('active', which === 'map');
  if (which === 'data') renderDataTable();
  if (which === 'map') renderDepthMap();
}

function updatePermissionBadge(state){
  const map = { granted: 'GPS: On', prompt: 'GPS: Tap Enable', denied: 'GPS: Blocked' };
  coordBadge.textContent = map[state] || 'GPS: Unknown';
}
async function ensureGeoPermission() {
  try {
    if (!navigator.permissions) return true;
    const status = await navigator.permissions.query({ name: 'geolocation' });
    updatePermissionBadge(status.state);
    return status.state !== 'denied';
  } catch {
    return true;
  }
}

function startTracking(){
  if (!('geolocation' in navigator)) return;
  if (watchId != null) return;
  const opts = { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 };
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const ts = pos.timestamp || Date.now();
      liveFix = { latitude, longitude, accuracy, ts };
    },
    (err) => {
      console.warn('watchPosition error', err);
    },
    opts
  );
}
function stopTracking(){
  if (watchId != null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
  }
  watchId = null;
}

function renderLiveLine(){
  if (!liveFix) {
    liveLineEl.textContent = 'Live: waiting for GPS…';
    return;
  }
  const age = Math.max(0, Date.now() - liveFix.ts);
  const s = Math.round(age/1000);
  liveLineEl.textContent = `Live: ${liveFix.latitude.toFixed(5)}, ${liveFix.longitude.toFixed(5)} • ~${Math.round(liveFix.accuracy||0)}m • ${s}s ago`;
}
setInterval(renderLiveLine, 3000);

function renderPad() {
  padEl.innerHTML = '';
  const keys = [];
  if (awaitingDecimal === null) {
    if (!highRange) {
      for (let n=1; n<=19; n++) keys.push({ label: String(n), value: n, toggler:false });
      keys.push({ label: '....', value: null, toggler:true });
    } else {
      keys.push({ label: '....', value: null, toggler:true });
      for (let n=20; n<=40; n++) keys.push({ label: String(n), value: n, toggler:false });
    }
  } else {
    for (let n=1; n<=9; n++) keys.push({ label: String(n), value: n, decimal:true });
    keys.push({ label: '0', value: 0, decimal:true });
  }
  for (const k of keys) {
    const btn = document.createElement('button');
    btn.className = 'key' + (k.toggler ? ' toggler' : '');
    btn.textContent = k.label;
    btn.addEventListener('click', async () => {
      if (k.toggler) {
        highRange = !highRange;
        renderPad();
        toast('Range ' + (highRange ? '20–40' : '1–19'));
        return;
      }
      if (awaitingDecimal === null) {
        awaitingDecimal = k.value;
        renderPad();
      } else {
        const depth = Number(`${awaitingDecimal}.${k.value}`);
        awaitingDecimal = null;
        await logPoint(depth);
        renderPad();
      }
    });
    padEl.appendChild(btn);
  }
}

async function getFreshLiveOrWait(maxWaitMs=5000){
  const recent = (f) => f && (Date.now() - f.ts) < 5000;
  if (recent(liveFix)) return liveFix;
  return new Promise((resolve) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (recent(liveFix) || (Date.now() - start) > maxWaitMs) {
        clearInterval(t);
        resolve(liveFix || null);
      }
    }, 250);
  });
}

async function logPoint(depth) {
  if (!(await ensureGeoPermission())) {
    toast('Enable location in settings');
  }
  startTracking();
  const fix = await getFreshLiveOrWait(5000);
  const reading = {
    depth,
    coords: fix ? { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy } : null,
    hasFish: false,
    createdAt: Date.now(),
    synced: false
  };
  await withStore('readwrite', (store, rp) => rp(store.add(reading)));
  lastSavedPoint = reading.coords;
  updateLastSavedUI();
  if (currentScreen === 'data') renderDataTable();
  toast(`Saved ${depth.toFixed(1)}m` + (reading.coords ? ` @ ${reading.coords.latitude.toFixed(5)}, ${reading.coords.longitude.toFixed(5)}` : ' • no GPS'));
}

function updateLastSavedUI(){
  if (!lastSavedPoint) {
    lastSavedEl.textContent = 'Last saved: —';
    return;
  }
  lastSavedEl.textContent = `Last saved: ${lastSavedPoint.latitude.toFixed(5)}, ${lastSavedPoint.longitude.toFixed(5)} • ~${Math.round(lastSavedPoint.accuracy||0)}m`;
}

async function renderDataTable(){
  const rows = await withStore('readonly', (store, rp) => rp(store.getAll()));
  rows.sort((a,b) => b.createdAt - a.createdAt);
  dataTableBody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    const t = new Date(r.createdAt).toLocaleString();
    const lat = r.coords ? r.coords.latitude.toFixed(5) : '';
    const lon = r.coords ? r.coords.longitude.toFixed(5) : '';
    tr.innerHTML = `<td>${t}</td><td>${Number(r.depth).toFixed(1)}</td><td>${r.hasFish?'🐟':''}</td><td>${lat}</td><td>${lon}</td>`;
    dataTableBody.appendChild(tr);
  }
  if (rows.length && rows[0].coords) {
    lastSavedPoint = rows[0].coords;
    updateLastSavedUI();
  }
}

fishBtn.addEventListener('click', async () => {
  const rows = await withStore('readonly', (store, rp) => rp(store.getAll()));
  rows.sort((a,b) => b.createdAt - a.createdAt);
  if (!rows.length) return;
  const latest = rows[0];
  latest.hasFish = true;
  await withStore('readwrite', (store, rp) => rp(store.put(latest)));
  if (currentScreen === 'data') renderDataTable();
  toast('Tagged last point as Has Fish 🐟');
});

dataBtn.addEventListener('click', () => showScreen(currentScreen === 'data' ? 'logger' : 'data'));
mapBtn.addEventListener('click', () => showScreen(currentScreen === 'map' ? 'logger' : 'map'));
document.getElementById('loc-btn').addEventListener('click', async () => {
  const hasPerm = await ensureGeoPermission();
  if (!hasPerm) toast('Enable location in browser settings');
  startTracking();
});

syncBtn.addEventListener('click', async () => {
  const unsynced = (await withStore('readonly', (store, rp) => rp(store.getAll()))).filter(r => !r.synced);
  if (!unsynced.length){ toast('Nothing to sync'); return; }
  try {
    const res = await fetch('/api/sync', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ readings: unsynced })
    });
    const data = await res.json();
    if (data.ok){
      for (const r of unsynced){ r.synced = true; }
      await withStore('readwrite', (store, rp) => Promise.all(unsynced.map(r => rp(store.put(r)))));
      toast('Synced ' + unsynced.length + ' readings');
      if (currentScreen === 'data') renderDataTable();
    } else {
      toast('Sync failed');
    }
  } catch(e){
    console.error(e);
    toast('Sync error (offline?)');
  }
});

exportBtn.addEventListener('click', async () => {
  const all = await withStore('readonly', (store, rp) => rp(store.getAll()));
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lake-readings.json';
  a.click();
  URL.revokeObjectURL(url);
});

window.addEventListener('DOMContentLoaded', () => {
  const clearBtn = document.getElementById('clear-btn');
  clearBtn?.addEventListener('click', async () => {
    if (!confirm('Clear ALL saved points? This cannot be undone.')) return;
    await withStore('readwrite', (store, rp) => rp(store.clear()));
    lastSavedPoint = null;
    updateLastSavedUI();
    if (currentScreen === 'data') renderDataTable();
    toast('All data cleared');
  });
});

// Depth color scale (shallow to deep)
function getDepthColor(depth, maxDepth) {
  const ratio = depth / maxDepth;
  const colors = [
    [173, 216, 230], // light blue - 0m
    [135, 206, 250], // sky blue
    [100, 149, 237], // cornflower
    [65, 105, 225],  // royal blue
    [0, 0, 205],     // medium blue
    [0, 0, 139],     // dark blue
    [25, 25, 112]    // midnight blue - max
  ];
  const idx = Math.min(Math.floor(ratio * (colors.length - 1)), colors.length - 2);
  const t = (ratio * (colors.length - 1)) - idx;
  const r = Math.round(colors[idx][0] + t * (colors[idx + 1][0] - colors[idx][0]));
  const g = Math.round(colors[idx][1] + t * (colors[idx + 1][1] - colors[idx][1]));
  const b = Math.round(colors[idx][2] + t * (colors[idx + 1][2] - colors[idx][2]));
  return `rgb(${r},${g},${b})`;
}

async function renderDepthMap() {
  const rows = await withStore('readonly', (store, rp) => rp(store.getAll()));
  const validPoints = rows.filter(p => p.coords && p.coords.accuracy <= 50);

  if (validPoints.length < 3) {
    document.getElementById('depth-map').innerHTML = '<div style="padding:40px;text-align:center;color:#666">Need at least 3 GPS points to render map</div>';
    return;
  }

  // Clear existing map
  if (depthMap) {
    depthMap.remove();
    depthMap = null;
  }

  // Create Turf points
  const points = validPoints.map(p => turf.point([p.coords.longitude, p.coords.latitude], { depth: p.depth, hasFish: p.hasFish }));
  const weedPoints = validPoints.filter(p => p.hasFish).map(p => turf.point([p.coords.longitude, p.coords.latitude], { depth: p.depth }));
  const fc = turf.featureCollection(points);
  const maxDepth = Math.max(...points.map(p => p.properties.depth));

  // Create interpolated grid using IDW
  const cellSize = 0.00005;
  const options = { gridType: 'point', property: 'depth', units: 'degrees', weight: 2 };
  const grid = turf.interpolate(fc, cellSize, options);

  // Create TIN from points
  const tin = turf.tin(fc, 'depth');

  // Initialize map
  const center = turf.center(fc);
  depthMap = L.map('depth-map').setView([center.geometry.coordinates[1], center.geometry.coordinates[0]], 16);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(depthMap);

  // Add TIN triangles
  const tinLayer = L.geoJSON(tin, {
    style: function(feature) {
      const avgDepth = (feature.properties.a + feature.properties.b + feature.properties.c) / 3;
      return {
        fillColor: getDepthColor(avgDepth, maxDepth),
        fillOpacity: 0.7,
        weight: 0.5,
        color: getDepthColor(avgDepth, maxDepth),
        opacity: 0.8
      };
    }
  }).addTo(depthMap);

  // Add contour lines (1m intervals)
  const breaks = Array.from({length: Math.ceil(maxDepth)}, (_, i) => i + 1);
  const isobaths = turf.isolines(grid, breaks, { zProperty: 'depth' });

  L.geoJSON(isobaths, {
    style: { color: '#000', weight: 1.5, opacity: 0.6, dashArray: '4,4' },
    onEachFeature: function(feature, layer) {
      if (feature.properties && feature.properties.depth) {
        layer.bindTooltip(feature.properties.depth + 'm', { permanent: false, direction: 'center' });
      }
    }
  }).addTo(depthMap);

  // Add depth points
  L.geoJSON(fc, {
    pointToLayer: function(feature, latlng) {
      return L.circleMarker(latlng, {
        radius: 4,
        fillColor: getDepthColor(feature.properties.depth, maxDepth),
        color: '#333',
        weight: 1,
        fillOpacity: 0.9
      });
    },
    onEachFeature: function(feature, layer) {
      const hasWeeds = feature.properties.hasFish ? ' (weeds)' : '';
      layer.bindPopup(`Depth: ${feature.properties.depth}m${hasWeeds}`);
    }
  }).addTo(depthMap);

  // Add weeds overlay
  if (weedPoints.length > 0) {
    const weedsFc = turf.featureCollection(weedPoints);
    L.geoJSON(weedsFc, {
      pointToLayer: function(feature, latlng) {
        return L.circleMarker(latlng, {
          radius: 8,
          fillColor: '#228B22',
          color: '#006400',
          weight: 2,
          fillOpacity: 0.6
        });
      },
      onEachFeature: function(feature, layer) {
        layer.bindPopup(`Weeds at ${feature.properties.depth}m`);
      }
    }).addTo(depthMap);
  }

  // Fit bounds
  depthMap.fitBounds(tinLayer.getBounds(), { padding: [30, 30] });

  // Render legend
  const legendEl = document.getElementById('map-legend');
  const depths = [0, 5, 10, 15, 20, Math.ceil(maxDepth)];
  legendEl.innerHTML = depths.map(d =>
    `<span class="legend-item"><span class="legend-swatch" style="background:${getDepthColor(d, maxDepth)}"></span>${d}m</span>`
  ).join('') + '<span class="legend-item"><span class="legend-weeds"></span>Weeds</span>';
}

let toastEl;
function toast(msg){
  if (!toastEl){
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.add('hidden'), 2200);
}

(async function init(){
  db = await openDB();
  renderPad();
  await renderDataTable();
  updateLastSavedUI();
  if (navigator.permissions) {
    try{
      const st = await navigator.permissions.query({ name:'geolocation' });
      updatePermissionBadge(st.state);
      st.onchange = () => updatePermissionBadge(st.state);
    }catch{}
  }
  startTracking();
  renderLiveLine();
  setInterval(renderLiveLine, 3000);
  window.addEventListener('online', ()=> toast('Back online'));
  window.addEventListener('offline', ()=> toast('You are offline'));
})();
