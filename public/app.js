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
const weedsBtn = $('#weeds-btn');
const fishBtn = $('#fish-btn');
const coordBadge = $('#coord-status');
const syncBtn = $('#sync-btn');
const exportBtn = $('#export-btn');
const dataBtn = $('#data-btn');
const locBtn = $('#loc-btn');
const screenProjects = $('#screen-projects');
const screenLogger = $('#screen-logger');
const screenData = $('#screen-data');
const screenMap = $('#screen-map');
const screenLivemap = $('#screen-livemap');
const loggerContent = $('#logger-content');
const mapBtn = $('#map-btn');
const livemapBtn = $('#livemap-btn');
const projectBadge = $('#bottombar-project');
const changeProjectBtn = $('#change-project-btn');
const projectsList = $('#projects-list');
const newProjectInput = $('#new-project-input');
const addProjectBtn = $('#add-project-btn');
const importBtn = $('#import-btn');
const importFileInput = $('#import-file-input');
const dataTableBody = document.querySelector('#data-table tbody');
let depthMap = null;
let liveMap = null;
let liveMarker = null;
let mapLayers = { depth: null, contours: null, points: null, weeds: null, shore: null, fish: null };
let currentProject = null; // { id, name }

let highRange = false;
let awaitingDecimal = null;
let currentScreen = 'logger';

// Live tracking
let watchId = null;
let liveFix = null; // { latitude, longitude, accuracy, ts }
let lastSavedPoint = null;

function showScreen(which){
  currentScreen = which;

  // Project screen is separate from logger content
  const inLogger = ['logger', 'data', 'map', 'livemap'].includes(which);
  screenProjects.classList.toggle('active', which === 'projects');
  loggerContent.classList.toggle('hidden', !inLogger);

  screenLogger.classList.toggle('active', which === 'logger');
  screenData.classList.toggle('active', which === 'data');
  screenMap.classList.toggle('active', which === 'map');
  screenLivemap.classList.toggle('active', which === 'livemap');

  if (which === 'projects') loadProjects();
  if (which === 'data') renderDataTable();
  if (which === 'map') renderDepthMap();
  if (which === 'livemap') renderLiveMap();
}

// === Project Management ===
async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    const data = await res.json();
    if (data.ok) renderProjectsList(data.projects);
  } catch (e) {
    console.error('Failed to load projects', e);
  }
}

function renderProjectsList(projects) {
  projectsList.innerHTML = '';
  if (!projects.length) {
    projectsList.innerHTML = '<div style="text-align:center;color:#666;padding:20px">No projects yet. Create one below.</div>';
    return;
  }
  for (const p of projects) {
    const div = document.createElement('div');
    div.className = 'project-item';
    div.innerHTML = `
      <div>
        <div class="project-name">${p.name}</div>
        <div class="project-count">${p.readingsCount} readings</div>
      </div>
      <button class="project-delete" data-id="${p.id}" title="Delete project">✕</button>
    `;
    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('project-delete')) return;
      selectProject(p);
    });
    div.querySelector('.project-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteProject(p);
    });
    projectsList.appendChild(div);
  }
}

async function handleImport(file) {
  if (!currentProject || !file) {
    toast('Select a project first');
    return;
  }
  try {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      toast('Invalid JSON file');
      return;
    }

    const readings = Array.isArray(data) ? data : data.readings || [];

    if (!readings.length) {
      toast('No readings found in file');
      return;
    }

    const res = await fetch(`/api/projects/${currentProject.id}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readings })
    });
    const result = await res.json();
    if (result.ok) {
      const skippedMsg = result.skipped ? ` (${result.skipped} duplicates skipped)` : '';
      toast(`Imported ${result.imported} readings${skippedMsg}`);
      renderDataTable();
    } else {
      toast(result.error || 'Import failed');
    }
  } catch (e) {
    console.error('Import error:', e);
    toast('Import failed: ' + e.message);
  }
  importFileInput.value = '';
}

function selectProject(project) {
  currentProject = { ...project, waterLevelOffset: project.waterLevelOffset || 0 };
  localStorage.setItem('currentProjectId', project.id);
  localStorage.setItem('currentProjectName', project.name);
  localStorage.setItem('currentProjectOffset', project.waterLevelOffset || 0);
  projectBadge.textContent = project.name;
  showScreen('logger');
}

async function createProject(name) {
  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (data.ok) {
      toast(`Created project: ${name}`);
      loadProjects();
      newProjectInput.value = '';
    } else {
      toast(data.error || 'Failed to create project');
    }
  } catch (e) {
    toast('Error creating project');
  }
}

async function deleteProject(project) {
  if (!confirm(`Delete "${project.name}" and all its readings?`)) return;
  try {
    const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      toast(`Deleted: ${project.name}`);
      if (currentProject?.id === project.id) {
        currentProject = null;
        localStorage.removeItem('currentProjectId');
        localStorage.removeItem('currentProjectName');
      }
      loadProjects();
    } else {
      toast(data.error || 'Failed to delete');
    }
  } catch (e) {
    toast('Error deleting project');
  }
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
      // shore, 0-17, toggler (20 keys for 5x4 grid)
      keys.push({ label: 'Shore', value: null, shore:true });
      for (let n=0; n<=17; n++) keys.push({ label: String(n), value: n, toggler:false });
      keys.push({ label: '....', value: null, toggler:true });
    } else {
      // toggler, 18-40 (24 keys for 6x4 grid)
      keys.push({ label: '....', value: null, toggler:true });
      for (let n=18; n<=40; n++) keys.push({ label: String(n), value: n, toggler:false });
    }
  } else {
    for (let n=1; n<=9; n++) keys.push({ label: String(n), value: n, decimal:true });
    keys.push({ label: '0', value: 0, decimal:true });
    keys.push({ label: '✕', value: null, cancel:true });
  }
  for (const k of keys) {
    const btn = document.createElement('button');
    btn.className = 'key' + (k.toggler ? ' toggler' : '') + (k.cancel ? ' cancel' : '') + (k.shore ? ' shore' : '');
    btn.textContent = k.label;
    btn.addEventListener('click', async () => {
      if (k.cancel) {
        awaitingDecimal = null;
        renderPad();
        toast('Cancelled');
        return;
      }
      if (k.shore) {
        // Record shore line at current location with depth 0
        await logPoint(0, true);
        toast('Shore line marked 🏖️');
        return;
      }
      if (k.toggler) {
        highRange = !highRange;
        renderPad();
        toast('Range ' + (highRange ? '18–40' : '0–17'));
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

async function getFreshLiveOrWait(maxWaitMs=3000){
  const recent = (f) => f && (Date.now() - f.ts) < 3000;
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

async function logPoint(depth, isShore = false) {
  if (!(await ensureGeoPermission())) {
    toast('Enable location in settings');
  }
  startTracking();
  const fix = await getFreshLiveOrWait(3000);
  const reading = {
    depth,
    coords: fix ? { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy } : null,
    hasWeeds: false,
    hasFish: false,
    isShore: isShore,
    createdAt: Date.now(),
    synced: false
  };
  await withStore('readwrite', (store, rp) => rp(store.add(reading)));
  lastSavedPoint = reading.coords;
  updateLastSavedUI();
  if (currentScreen === 'data') renderDataTable();
  if (currentScreen === 'livemap') {
    try {
      await updateLiveMapPoints();
    } catch (e) {
      console.error('Failed to update live map:', e);
    }
  }
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
  let rows = [];

  // Fetch from server if project selected
  if (currentProject) {
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/readings`);
      const data = await res.json();
      if (data.ok) {
        rows = data.readings.map(r => ({
          ...r,
          coords: r.latitude ? { latitude: r.latitude, longitude: r.longitude, accuracy: r.accuracy } : null,
          isServer: true
        }));
      }
    } catch (e) {
      console.error('Failed to fetch readings', e);
    }
  }

  // Also get local unsynced entries
  const localRows = await withStore('readonly', (store, rp) => rp(store.getAll()));
  const unsyncedLocal = localRows.filter(r => !r.synced).map(r => ({ ...r, isLocal: true }));
  rows = [...unsyncedLocal, ...rows];

  rows.sort((a,b) => b.createdAt - a.createdAt);
  dataTableBody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    const t = new Date(r.createdAt).toLocaleString();
    const lat = r.coords ? r.coords.latitude.toFixed(5) : '';
    const lon = r.coords ? r.coords.longitude.toFixed(5) : '';
    const synced = r.isLocal ? ' (local)' : '';
    const markers = (r.isShore ? '🏖️' : '') + (r.hasWeeds ? '🌿' : '');
    tr.innerHTML = `
      <td>${t}${synced}</td>
      <td>${Number(r.depth).toFixed(1)}</td>
      <td>${markers}</td>
      <td>${lat}</td>
      <td>${lon}</td>
      <td class="row-actions">
        <button class="row-btn edit-btn" title="Edit">✏️</button>
        <button class="row-btn delete-btn" title="Delete">🗑️</button>
      </td>
    `;
    tr.querySelector('.edit-btn').addEventListener('click', () => editReading(r));
    tr.querySelector('.delete-btn').addEventListener('click', () => deleteReadingEntry(r));
    dataTableBody.appendChild(tr);
  }
  if (rows.length && rows[0].coords) {
    lastSavedPoint = rows[0].coords;
    updateLastSavedUI();
  }

  // Also render fish table
  renderFishTable();
}

const fishTableBody = document.querySelector('#fish-table tbody');

async function renderFishTable() {
  if (!currentProject || !fishTableBody) return;

  try {
    const res = await fetch(`/api/projects/${currentProject.id}/fish`);
    const data = await res.json();
    if (!data.ok) return;

    fishTableBody.innerHTML = '';
    for (const f of data.catches) {
      const tr = document.createElement('tr');
      const t = new Date(f.createdAt).toLocaleString();
      const lat = f.latitude ? f.latitude.toFixed(5) : '';
      const lon = f.longitude ? f.longitude.toFixed(5) : '';
      tr.innerHTML = `
        <td>${t}</td>
        <td>${f.fishType || '-'}</td>
        <td>${f.weight ? f.weight + ' kg' : '-'}</td>
        <td>${f.length ? f.length + ' cm' : '-'}</td>
        <td>${lat}</td>
        <td>${lon}</td>
        <td class="row-actions">
          <button class="row-btn edit-btn" title="Edit">✏️</button>
          <button class="row-btn delete-btn" title="Delete">🗑️</button>
        </td>
      `;
      tr.querySelector('.edit-btn').addEventListener('click', () => openFishModal(f));
      tr.querySelector('.delete-btn').addEventListener('click', async () => {
        if (!confirm('Delete this fish catch?')) return;
        try {
          await fetch(`/api/fish/${f.id}`, { method: 'DELETE' });
          toast('Fish catch deleted');
          renderFishTable();
        } catch (e) {
          toast('Failed to delete');
        }
      });
      fishTableBody.appendChild(tr);
    }
  } catch (e) {
    console.error('Failed to load fish catches', e);
  }
}

async function deleteReadingEntry(reading) {
  if (!confirm('Delete this reading?')) return;
  try {
    if (reading.isServer) {
      await fetch(`/api/readings/${reading.id}`, { method: 'DELETE' });
    } else if (reading.isLocal) {
      await withStore('readwrite', (store) => store.delete(reading.id));
    }
    renderDataTable();
    toast('Reading deleted');
  } catch (e) {
    toast('Failed to delete');
  }
}

// Reading edit modal handling
const readingModal = $('#reading-modal');
const readingModalClose = $('#reading-modal-close');
const readingModalSave = $('#reading-modal-save');
const readingModalDelete = $('#reading-modal-delete');
const readingDepthInput = $('#reading-depth');
const readingWeedsInput = $('#reading-weeds');
const readingShoreInput = $('#reading-shore');
const readingLatInput = $('#reading-lat');
const readingLonInput = $('#reading-lon');
const readingTimeEl = $('#reading-time');
const shoreWarningEl = $('#shore-warning');
let editingReading = null;

function openReadingModal(reading) {
  editingReading = reading;

  readingDepthInput.value = reading.depth;
  readingWeedsInput.checked = reading.hasWeeds || false;
  readingShoreInput.checked = reading.isShore || false;
  readingLatInput.value = reading.coords?.latitude || '';
  readingLonInput.value = reading.coords?.longitude || '';
  readingTimeEl.textContent = `Recorded: ${new Date(reading.createdAt).toLocaleString()}`;

  // Update shore warning visibility
  updateShoreWarning();

  readingModal.classList.remove('hidden');
}

function closeReadingModal() {
  readingModal.classList.add('hidden');
  editingReading = null;
}

function updateShoreWarning() {
  const depth = parseFloat(readingDepthInput.value) || 0;
  const isShore = readingShoreInput.checked;
  shoreWarningEl.classList.toggle('hidden', !isShore || depth === 0);
}

readingModalClose.addEventListener('click', closeReadingModal);
readingModal.querySelector('.modal-backdrop').addEventListener('click', closeReadingModal);
readingDepthInput.addEventListener('input', updateShoreWarning);
readingShoreInput.addEventListener('change', updateShoreWarning);

readingModalSave.addEventListener('click', async () => {
  if (!editingReading) return;

  const depth = parseFloat(readingDepthInput.value);
  if (isNaN(depth)) {
    toast('Invalid depth');
    return;
  }

  const hasWeeds = readingWeedsInput.checked;
  const isShore = readingShoreInput.checked;
  const latitude = readingLatInput.value ? parseFloat(readingLatInput.value) : null;
  const longitude = readingLonInput.value ? parseFloat(readingLonInput.value) : null;

  // Warn if shore is checked but depth is not 0
  if (isShore && depth !== 0) {
    if (!confirm('Shore points should have depth 0m. Save anyway?')) {
      return;
    }
  }

  try {
    if (editingReading.isServer) {
      await fetch(`/api/readings/${editingReading.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depth, hasWeeds, hasFish: false, isShore, latitude, longitude })
      });
    } else if (editingReading.isLocal) {
      editingReading.depth = depth;
      editingReading.hasWeeds = hasWeeds;
      editingReading.isShore = isShore;
      if (latitude !== null && longitude !== null) {
        editingReading.coords = { latitude, longitude, accuracy: editingReading.coords?.accuracy };
      }
      await withStore('readwrite', (store) => store.put(editingReading));
    }
    closeReadingModal();
    renderDataTable();
    toast('Reading updated');
  } catch (e) {
    toast('Failed to update');
  }
});

readingModalDelete.addEventListener('click', async () => {
  if (!editingReading) return;
  if (!confirm('Delete this reading?')) return;

  try {
    if (editingReading.isServer) {
      await fetch(`/api/readings/${editingReading.id}`, { method: 'DELETE' });
    } else if (editingReading.isLocal) {
      await withStore('readwrite', (store) => store.delete(editingReading.id));
    }
    closeReadingModal();
    renderDataTable();
    toast('Reading deleted');
  } catch (e) {
    toast('Failed to delete');
  }
});

function editReading(reading) {
  openReadingModal(reading);
}

weedsBtn.addEventListener('click', async () => {
  const rows = await withStore('readonly', (store, rp) => rp(store.getAll()));
  rows.sort((a,b) => b.createdAt - a.createdAt);
  if (!rows.length) return;
  const latest = rows[0];
  latest.hasWeeds = true;
  await withStore('readwrite', (store, rp) => rp(store.put(latest)));
  if (currentScreen === 'data') renderDataTable();
  toast('Tagged last point as Has Weeds 🌿');
});

// Fish catch modal handling
const fishModal = $('#fish-modal');
const fishModalClose = $('#fish-modal-close');
const fishModalSave = $('#fish-modal-save');
const fishModalDelete = $('#fish-modal-delete');
const fishModalTitle = $('#fish-modal-title');
const fishTypeInput = $('#fish-type');
const fishWeightInput = $('#fish-weight');
const fishLengthInput = $('#fish-length');
const fishNotesInput = $('#fish-notes');
const fishLatInput = $('#fish-lat');
const fishLonInput = $('#fish-lon');
let editingFishId = null;

function openFishModal(fishCatch = null) {
  editingFishId = fishCatch?.id || null;
  fishModalTitle.textContent = fishCatch ? 'Edit Fish Catch' : 'Log Fish Catch';
  fishModalDelete.classList.toggle('hidden', !fishCatch);

  fishTypeInput.value = fishCatch?.fishType || '';
  fishWeightInput.value = fishCatch?.weight || '';
  fishLengthInput.value = fishCatch?.length || '';
  fishNotesInput.value = fishCatch?.notes || '';

  if (fishCatch && fishCatch.latitude) {
    fishLatInput.value = fishCatch.latitude;
    fishLonInput.value = fishCatch.longitude;
  } else if (liveFix) {
    fishLatInput.value = liveFix.latitude;
    fishLonInput.value = liveFix.longitude;
  } else {
    fishLatInput.value = '';
    fishLonInput.value = '';
  }

  fishModal.classList.remove('hidden');
}

function closeFishModal() {
  fishModal.classList.add('hidden');
  editingFishId = null;
}

fishModalClose.addEventListener('click', closeFishModal);
fishModal.querySelector('.modal-backdrop').addEventListener('click', closeFishModal);

fishModalSave.addEventListener('click', async () => {
  if (!currentProject) {
    toast('Select a project first');
    return;
  }

  const fishData = {
    fishType: fishTypeInput.value.trim(),
    weight: fishWeightInput.value ? parseFloat(fishWeightInput.value) : null,
    length: fishLengthInput.value ? parseFloat(fishLengthInput.value) : null,
    notes: fishNotesInput.value.trim(),
    latitude: fishLatInput.value ? parseFloat(fishLatInput.value) : null,
    longitude: fishLonInput.value ? parseFloat(fishLonInput.value) : null,
    accuracy: null
  };

  try {
    if (editingFishId) {
      await fetch(`/api/fish/${editingFishId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fishData)
      });
      toast('Fish catch updated');
    } else {
      await fetch(`/api/projects/${currentProject.id}/fish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fishData)
      });
      toast('Fish catch logged 🐟');
    }
    closeFishModal();
    if (currentScreen === 'data') {
      renderDataTable();
      renderFishTable();
    }
  } catch (e) {
    toast('Failed to save fish catch');
  }
});

fishModalDelete.addEventListener('click', async () => {
  if (!editingFishId) return;
  if (!confirm('Delete this fish catch?')) return;
  try {
    await fetch(`/api/fish/${editingFishId}`, { method: 'DELETE' });
    toast('Fish catch deleted');
    closeFishModal();
    if (currentScreen === 'data') renderFishTable();
  } catch (e) {
    toast('Failed to delete');
  }
});

fishBtn.addEventListener('click', () => {
  startTracking();
  openFishModal();
});

// Water level modal handling
const waterLevelModal = document.getElementById('water-level-modal');
const waterLevelModalClose = document.getElementById('water-level-modal-close');
const waterLevelModalSave = document.getElementById('water-level-modal-save');
const waterLevelOffsetInput = document.getElementById('water-level-offset');
const shoreReadingsInfo = document.getElementById('shore-readings-info');
const waterLevelBtn = document.getElementById('water-level-btn');

async function openWaterLevelModal() {
  if (!currentProject) {
    toast('Select a project first');
    return;
  }
  // Load current offset
  waterLevelOffsetInput.value = currentProject.waterLevelOffset || 0;

  // Load shore readings info
  try {
    const res = await fetch(`/api/projects/${currentProject.id}/shore`);
    const data = await res.json();
    if (data.ok && data.shores.length > 0) {
      const latest = data.shores[0];
      const date = new Date(latest.createdAt).toLocaleDateString();
      shoreReadingsInfo.textContent = `${data.shores.length} shore point(s). Latest: ${date}`;
    } else {
      shoreReadingsInfo.textContent = 'No shore points recorded yet.';
    }
  } catch (e) {
    shoreReadingsInfo.textContent = '';
  }

  waterLevelModal.classList.remove('hidden');
}

function closeWaterLevelModal() {
  waterLevelModal.classList.add('hidden');
}

waterLevelModalClose.addEventListener('click', closeWaterLevelModal);
waterLevelModal.querySelector('.modal-backdrop').addEventListener('click', closeWaterLevelModal);

waterLevelModalSave.addEventListener('click', async () => {
  if (!currentProject) return;
  const offset = parseFloat(waterLevelOffsetInput.value) || 0;
  try {
    await fetch(`/api/projects/${currentProject.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waterLevelOffset: offset })
    });
    currentProject.waterLevelOffset = offset;
    toast(`Water level offset set to ${offset}m`);
    closeWaterLevelModal();
  } catch (e) {
    toast('Failed to save');
  }
});

waterLevelBtn.addEventListener('click', () => {
  settingsMenu.classList.add('hidden');
  openWaterLevelModal();
});

dataBtn.addEventListener('click', () => showScreen(currentScreen === 'data' ? 'logger' : 'data'));
mapBtn.addEventListener('click', () => showScreen(currentScreen === 'map' ? 'logger' : 'map'));
livemapBtn.addEventListener('click', () => showScreen(currentScreen === 'livemap' ? 'logger' : 'livemap'));
changeProjectBtn.addEventListener('click', () => showScreen('projects'));
addProjectBtn.addEventListener('click', () => {
  const name = newProjectInput.value.trim();
  if (name) createProject(name);
});
newProjectInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const name = newProjectInput.value.trim();
    if (name) createProject(name);
  }
});
importBtn.addEventListener('click', () => {
  settingsMenu.classList.add('hidden');
  importFileInput.click();
});
importFileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleImport(e.target.files[0]);
});

// Layer visibility toggles
['depth', 'contours', 'points', 'weeds', 'shore', 'fish'].forEach(name => {
  const checkbox = document.getElementById('layer-' + name);
  if (checkbox) {
    checkbox.addEventListener('change', () => {
      if (!depthMap || !mapLayers[name]) return;
      if (checkbox.checked) {
        depthMap.addLayer(mapLayers[name]);
      } else {
        depthMap.removeLayer(mapLayers[name]);
      }
    });
  }
});

// Settings dropdown toggle
const settingsBtn = document.getElementById('settings-btn');
const settingsMenu = document.getElementById('settings-menu');
settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsMenu.classList.toggle('hidden');
});
document.addEventListener('click', () => settingsMenu.classList.add('hidden'));
settingsMenu.addEventListener('click', (e) => e.stopPropagation());

document.getElementById('loc-btn').addEventListener('click', async () => {
  settingsMenu.classList.add('hidden');
  const hasPerm = await ensureGeoPermission();
  if (!hasPerm) toast('Enable location in browser settings');
  startTracking();
});

syncBtn.addEventListener('click', async () => {
  settingsMenu.classList.add('hidden');
  if (!currentProject) {
    toast('Select a project first');
    return;
  }
  const unsynced = (await withStore('readonly', (store, rp) => rp(store.getAll()))).filter(r => !r.synced);
  if (!unsynced.length){ toast('Nothing to sync'); return; }
  try {
    const res = await fetch(`/api/projects/${currentProject.id}/sync`, {
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
  settingsMenu.classList.add('hidden');
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
    if (!confirm('Clear ALL saved points for this project? This cannot be undone.')) return;

    // Clear local IndexedDB
    await withStore('readwrite', (store, rp) => rp(store.clear()));

    // Clear server data for current project
    if (currentProject) {
      try {
        await fetch(`/api/projects/${currentProject.id}/readings`, { method: 'DELETE' });
      } catch (e) {
        console.error('Failed to clear server data', e);
      }
    }

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
  let rows = [];

  // Fetch from server if project selected
  if (currentProject) {
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/readings`);
      const data = await res.json();
      if (data.ok) {
        rows = data.readings.map(r => ({
          ...r,
          coords: r.latitude ? { latitude: r.latitude, longitude: r.longitude, accuracy: r.accuracy } : null
        }));
      }
    } catch (e) {
      console.error('Failed to fetch readings for map', e);
    }
  }

  // Also get local unsynced entries
  const localRows = await withStore('readonly', (store, rp) => rp(store.getAll()));
  const unsyncedLocal = localRows.filter(r => !r.synced);
  rows = [...unsyncedLocal, ...rows];

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
  const points = validPoints.map(p => turf.point([p.coords.longitude, p.coords.latitude], { depth: p.depth, hasWeeds: p.hasWeeds }));
  const weedPoints = validPoints.filter(p => p.hasWeeds).map(p => turf.point([p.coords.longitude, p.coords.latitude], { depth: p.depth }));
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
  mapLayers.depth = L.geoJSON(tin, {
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

  mapLayers.contours = L.geoJSON(isobaths, {
    style: { color: '#000', weight: 1.5, opacity: 0.6, dashArray: '4,4' },
    onEachFeature: function(feature, layer) {
      if (feature.properties && feature.properties.depth) {
        layer.bindTooltip(feature.properties.depth + 'm', { permanent: false, direction: 'center' });
      }
    }
  }).addTo(depthMap);

  // Add depth points
  mapLayers.points = L.geoJSON(fc, {
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
      const hasWeeds = feature.properties.hasWeeds ? ' (weeds)' : '';
      layer.bindPopup(`Depth: ${feature.properties.depth}m${hasWeeds}`);
    }
  }).addTo(depthMap);

  // Add weeds cloud overlay
  mapLayers.weeds = null;
  if (weedPoints.length > 0) {
    const weedsFc = turf.featureCollection(weedPoints);

    // Create buffered circles around each weed point (radius in km, ~10m)
    const buffered = weedPoints.map(p => turf.buffer(p, 0.010, { units: 'kilometers' }));

    // Try to union/dissolve overlapping buffers into a cloud
    let weedCloud;
    try {
      if (buffered.length === 1) {
        weedCloud = buffered[0];
      } else {
        weedCloud = buffered.reduce((acc, buf) => {
          try {
            return turf.union(acc, buf);
          } catch (e) {
            return acc;
          }
        });
      }
    } catch (e) {
      weedCloud = turf.featureCollection(buffered);
    }

    // Add the cloud polygon layer with blur effect using SVG filter
    const cloudLayer = L.geoJSON(weedCloud, {
      style: {
        fillColor: '#228B22',
        fillOpacity: 0.5,
        color: '#228B22',
        weight: 0,
        opacity: 0
      },
      onEachFeature: function(feature, layer) {
        if (layer._path) {
          layer._path.style.filter = 'url(#weed-blur)';
        } else {
          layer.on('add', function() {
            if (layer._path) layer._path.style.filter = 'url(#weed-blur)';
          });
        }
      }
    });

    mapLayers.weeds = cloudLayer.addTo(depthMap);
  }

  // Add shore line markers
  const shorePoints = validPoints.filter(p => p.isShore);
  mapLayers.shore = null;
  if (shorePoints.length > 0) {
    const shoreFc = turf.featureCollection(
      shorePoints.map(p => turf.point([p.coords.longitude, p.coords.latitude], { createdAt: p.createdAt }))
    );
    mapLayers.shore = L.geoJSON(shoreFc, {
      pointToLayer: function(feature, latlng) {
        return L.marker(latlng, {
          icon: L.divIcon({
            className: 'shore-map-marker',
            html: '🏖️',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          })
        });
      },
      onEachFeature: function(feature, layer) {
        const date = new Date(feature.properties.createdAt).toLocaleDateString();
        layer.bindPopup(`Shore line (${date})`);
      }
    }).addTo(depthMap);
  }

  // Fit bounds
  depthMap.fitBounds(mapLayers.depth.getBounds(), { padding: [30, 30] });

  // Sync layer visibility with checkboxes
  ['depth', 'contours', 'points', 'weeds', 'shore'].forEach(name => {
    const checkbox = document.getElementById('layer-' + name);
    if (checkbox && mapLayers[name]) {
      if (!checkbox.checked) depthMap.removeLayer(mapLayers[name]);
    }
  });

  // Fetch and add fish catches layer
  mapLayers.fish = null;
  if (currentProject) {
    try {
      const fishRes = await fetch(`/api/projects/${currentProject.id}/fish`);
      const fishData = await fishRes.json();
      if (fishData.ok && fishData.catches.length > 0) {
        const fishPoints = fishData.catches
          .filter(f => f.latitude && f.longitude)
          .map(f => turf.point([f.longitude, f.latitude], {
            fishType: f.fishType,
            weight: f.weight,
            length: f.length,
            notes: f.notes
          }));
        if (fishPoints.length > 0) {
          const fishFc = turf.featureCollection(fishPoints);
          mapLayers.fish = L.geoJSON(fishFc, {
            pointToLayer: function(feature, latlng) {
              return L.marker(latlng, {
                icon: L.divIcon({
                  className: 'fish-map-marker',
                  html: '🐟',
                  iconSize: [24, 24],
                  iconAnchor: [12, 12]
                })
              });
            },
            onEachFeature: function(feature, layer) {
              const p = feature.properties;
              const details = [
                p.fishType || 'Unknown',
                p.weight ? `${p.weight}kg` : null,
                p.length ? `${p.length}cm` : null,
                p.notes || null
              ].filter(Boolean).join(' • ');
              layer.bindPopup(`🐟 ${details}`);
            }
          }).addTo(depthMap);
        }
      }
    } catch (e) {
      console.error('Failed to load fish catches for map', e);
    }
  }

  // Render legend
  const legendEl = document.getElementById('map-legend');
  const depths = [0, 5, 10, 15, 20, Math.ceil(maxDepth)];
  legendEl.innerHTML = depths.map(d =>
    `<span class="legend-item"><span class="legend-swatch" style="background:${getDepthColor(d, maxDepth)}"></span>${d}m</span>`
  ).join('') + '<span class="legend-item"><span class="legend-weeds"></span>Weeds</span>' +
  '<span class="legend-item"><span class="legend-fish">🏖️</span>Shore</span>' +
  '<span class="legend-item"><span class="legend-fish">🐟</span>Fish</span>';
}

// === Live Map ===
let liveMapPointsLayer = null;
let liveMapContoursLayer = null;
let liveMapWeedsLayer = null;
let liveMapFishLayer = null;

async function renderLiveMap() {
  const livePadEl = document.getElementById('live-pad');

  // Render compact pad
  renderLivePad(livePadEl);

  // Ensure GPS tracking is active
  startTracking();

  // Initialize map if needed
  if (!liveMap) {
    const startLat = liveFix?.latitude || 54.5;
    const startLon = liveFix?.longitude || -1.5;
    liveMap = L.map('live-map').setView([startLat, startLon], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(liveMap);

    // Create live marker
    const liveIcon = L.divIcon({ className: 'live-marker', iconSize: [16, 16] });
    liveMarker = L.marker([startLat, startLon], { icon: liveIcon }).addTo(liveMap);
  }

  // Update live marker position
  if (liveFix) {
    liveMarker.setLatLng([liveFix.latitude, liveFix.longitude]);
    liveMap.setView([liveFix.latitude, liveFix.longitude], liveMap.getZoom());
  }

  // Load points and fit bounds if we have data
  await updateLiveMapPoints();

  // Fit to points layer if exists, otherwise stay on GPS position
  if (liveMapPointsLayer) {
    try {
      const bounds = liveMapPointsLayer.getBounds();
      if (bounds.isValid()) {
        liveMap.fitBounds(bounds, { padding: [20, 20], maxZoom: 17 });
      }
    } catch (e) {}
  }

  // Start updating live marker position continuously
  if (!liveMap._liveInterval) {
    liveMap._liveInterval = setInterval(() => {
      if (liveFix && currentScreen === 'livemap' && liveMarker) {
        const newPos = [liveFix.latitude, liveFix.longitude];
        liveMarker.setLatLng(newPos);
        liveMarker.bringToFront();
        // Pan map to follow marker (smooth pan)
        if (!liveMap.getBounds().contains(newPos)) {
          liveMap.panTo(newPos);
        }
      }
    }, 1000);
  }

  // Fix map size after render
  setTimeout(() => liveMap.invalidateSize(), 100);
}

async function updateLiveMapPoints() {
  if (!liveMap || !currentProject) return;

  // Remove old layers
  if (liveMapPointsLayer) {
    liveMap.removeLayer(liveMapPointsLayer);
    liveMapPointsLayer = null;
  }
  if (liveMapContoursLayer) {
    liveMap.removeLayer(liveMapContoursLayer);
    liveMapContoursLayer = null;
  }
  if (liveMapWeedsLayer) {
    liveMap.removeLayer(liveMapWeedsLayer);
    liveMapWeedsLayer = null;
  }
  if (liveMapFishLayer) {
    liveMap.removeLayer(liveMapFishLayer);
    liveMapFishLayer = null;
  }

  // Fetch points from server
  let serverRows = [];
  try {
    const res = await fetch(`/api/projects/${currentProject.id}/readings`);
    const data = await res.json();
    if (data.ok) {
      serverRows = data.readings.map(r => ({
        ...r,
        coords: r.latitude ? { latitude: r.latitude, longitude: r.longitude } : null
      }));
    }
  } catch (e) {
    console.error('Failed to fetch server readings:', e);
  }

  // Get local unsynced
  let localRows = [];
  try {
    localRows = await withStore('readonly', (store, rp) => rp(store.getAll()));
  } catch (e) {
    console.error('Failed to fetch local readings:', e);
  }
  const unsynced = (localRows || []).filter(r => !r.synced);

  const allRows = [...serverRows, ...unsynced];
  const validPoints = allRows.filter(p => p.coords);

  if (validPoints.length === 0) {
    // Bring live marker to front even if no points
    if (liveMarker) liveMarker.bringToFront();
    return;
  }

  // Get max depth for color scale
  const maxDepth = Math.max(...validPoints.map(p => p.depth || 0), 1);

  // Create points layer
  try {
    const points = validPoints.map(p => turf.point(
      [p.coords.longitude, p.coords.latitude],
      { depth: p.depth, hasWeeds: p.hasWeeds }
    ));
    const fc = turf.featureCollection(points);

    liveMapPointsLayer = L.geoJSON(fc, {
      pointToLayer: function(feature, latlng) {
        return L.circleMarker(latlng, {
          radius: 6,
          fillColor: getDepthColor(feature.properties.depth, maxDepth),
          color: '#333',
          weight: 1,
          fillOpacity: 0.9
        });
      },
      onEachFeature: function(feature, layer) {
        const hasWeeds = feature.properties.hasWeeds ? ' (weeds)' : '';
        layer.bindPopup(`${feature.properties.depth}m${hasWeeds}`);
      }
    }).addTo(liveMap);
  } catch (e) {
    console.error('Failed to create points layer:', e);
  }

  // Add contour lines (need at least 3 points)
  if (validPoints.length >= 3) {
    try {
      const cellSize = 0.00005;
      const options = { gridType: 'point', property: 'depth', units: 'degrees', weight: 2 };
      const grid = turf.interpolate(fc, cellSize, options);
      const breaks = Array.from({length: Math.ceil(maxDepth)}, (_, i) => i + 1);
      const isobaths = turf.isolines(grid, breaks, { zProperty: 'depth' });

      liveMapContoursLayer = L.geoJSON(isobaths, {
        style: { color: '#000', weight: 1.5, opacity: 0.6, dashArray: '4,4' },
        onEachFeature: function(feature, layer) {
          if (feature.properties && feature.properties.depth) {
            layer.bindTooltip(feature.properties.depth + 'm', { permanent: false, direction: 'center' });
          }
        }
      }).addTo(liveMap);
    } catch (e) {
      console.error('Failed to generate contours:', e);
    }
  }

  // Add weeds cloud to live map
  try {
    const weedPoints = validPoints.filter(p => p.hasWeeds);
    if (weedPoints.length > 0) {
      const weedTurfPoints = weedPoints.map(p => turf.point([p.coords.longitude, p.coords.latitude]));
      const buffered = weedTurfPoints.map(p => turf.buffer(p, 0.010, { units: 'kilometers' }));
      let weedCloud;
      try {
        if (buffered.length === 1) {
          weedCloud = buffered[0];
        } else {
          weedCloud = buffered.reduce((acc, buf) => {
            try { return turf.union(acc, buf); } catch (e) { return acc; }
          });
        }
      } catch (e) {
        weedCloud = turf.featureCollection(buffered);
      }
      liveMapWeedsLayer = L.geoJSON(weedCloud, {
        style: { fillColor: '#228B22', fillOpacity: 0.5, color: '#228B22', weight: 0 },
        onEachFeature: function(feature, layer) {
          layer.on('add', function() {
            if (layer._path) layer._path.style.filter = 'url(#weed-blur)';
          });
        }
      }).addTo(liveMap);
    }
  } catch (e) {
    console.error('Failed to create weeds layer:', e);
  }

  // Add fish catches to live map
  if (currentProject) {
    try {
      const fishRes = await fetch(`/api/projects/${currentProject.id}/fish`);
      const fishData = await fishRes.json();
      if (fishData.ok && fishData.catches.length > 0) {
        const fishPoints = fishData.catches
          .filter(f => f.latitude && f.longitude)
          .map(f => turf.point([f.longitude, f.latitude], { fishType: f.fishType }));
        if (fishPoints.length > 0) {
          const fishFc = turf.featureCollection(fishPoints);
          liveMapFishLayer = L.geoJSON(fishFc, {
            pointToLayer: function(feature, latlng) {
              return L.marker(latlng, {
                icon: L.divIcon({
                  className: 'fish-map-marker',
                  html: '🐟',
                  iconSize: [20, 20],
                  iconAnchor: [10, 10]
                })
              });
            },
            onEachFeature: function(feature, layer) {
              layer.bindPopup(`🐟 ${feature.properties.fishType || 'Fish'}`);
            }
          }).addTo(liveMap);
        }
      }
    } catch (e) {
      console.error('Failed to load fish catches:', e);
    }
  }

  // Bring live marker to front
  if (liveMarker) liveMarker.bringToFront();
}

function renderLivePad(container) {
  container.innerHTML = '';
  const keys = [];

  if (awaitingDecimal === null) {
    if (!highRange) {
      keys.push({ label: 'Shore', value: null, shore:true });
      for (let n=0; n<=17; n++) keys.push({ label: String(n), value: n, toggler:false });
      keys.push({ label: '...', value: null, toggler:true });
    } else {
      keys.push({ label: '...', value: null, toggler:true });
      for (let n=18; n<=40; n++) keys.push({ label: String(n), value: n, toggler:false });
    }
  } else {
    for (let n=0; n<=9; n++) keys.push({ label: String(n), value: n, decimal:true });
    keys.push({ label: '✕', value: null, cancel:true });
  }

  for (const k of keys) {
    const btn = document.createElement('button');
    btn.className = 'key' + (k.toggler ? ' toggler' : '') + (k.cancel ? ' cancel' : '') + (k.shore ? ' shore' : '');
    btn.textContent = k.label;
    btn.addEventListener('click', async () => {
      if (k.cancel) {
        awaitingDecimal = null;
        renderLivePad(container);
        toast('Cancelled');
        return;
      }
      if (k.shore) {
        await logPoint(0, true);
        toast('Shore line marked 🏖️');
        return;
      }
      if (k.toggler) {
        highRange = !highRange;
        renderLivePad(container);
        toast('Range ' + (highRange ? '18–40' : '0–17'));
        return;
      }
      if (awaitingDecimal === null) {
        awaitingDecimal = k.value;
        renderLivePad(container);
      } else {
        const depth = Number(`${awaitingDecimal}.${k.value}`);
        awaitingDecimal = null;
        await logPoint(depth);
        renderLivePad(container);
      }
    });
    container.appendChild(btn);
  }
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
  updateLastSavedUI();

  // Check for saved project
  const savedProjectId = localStorage.getItem('currentProjectId');
  const savedProjectName = localStorage.getItem('currentProjectName');
  const savedProjectOffset = parseFloat(localStorage.getItem('currentProjectOffset')) || 0;
  if (savedProjectId && savedProjectName) {
    currentProject = { id: parseInt(savedProjectId), name: savedProjectName, waterLevelOffset: savedProjectOffset };
    projectBadge.textContent = savedProjectName;
    showScreen('logger');
  } else {
    showScreen('projects');
  }

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
