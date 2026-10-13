import * as api from './api.js';
import { $ } from './ui.js';
import { getProjectId, getOffset, getScreen } from './state.js';
import { loadReadings, mappablePoints, excludedCount } from './data.js';
import { getFix, startTracking } from './gps.js';
import { MAX_ACCURACY_M } from './depth.js';
import {
  createMap,
  toFeatureCollection,
  maxDepthOf,
  buildTinLayer,
  buildContourLayer,
  buildPointsLayer,
  buildWeedsLayer,
  buildShoreLayer,
  buildFishLayer,
  renderLegend
} from './maplayers.js';

const LAYER_NAMES = ['depth', 'contours', 'points', 'weeds', 'shore', 'fish'];

let depthMap = null;
let depthLayers = {};

let liveMap = null;
let liveMarker = null;
let liveLayers = {};

async function fishCatches() {
  const projectId = getProjectId();
  if (!projectId) return [];
  try {
    return await api.getFish(projectId);
  } catch (e) {
    console.warn('Could not load fish catches for the map', e.message);
    return [];
  }
}

function clearLayers(map, layers) {
  for (const name of Object.keys(layers)) {
    if (layers[name]) map.removeLayer(layers[name]);
  }
  return {};
}

function applyLayerToggles() {
  for (const name of LAYER_NAMES) {
    const checkbox = document.getElementById('layer-' + name);
    if (!checkbox || !depthLayers[name] || !depthMap) continue;
    if (checkbox.checked) depthMap.addLayer(depthLayers[name]);
    else depthMap.removeLayer(depthLayers[name]);
  }
}

export function bindLayerToggles() {
  for (const name of LAYER_NAMES) {
    const checkbox = document.getElementById('layer-' + name);
    checkbox?.addEventListener('change', () => {
      if (!depthMap || !depthLayers[name]) return;
      if (checkbox.checked) depthMap.addLayer(depthLayers[name]);
      else depthMap.removeLayer(depthLayers[name]);
    });
  }
}

export async function renderDepthMap() {
  const container = document.getElementById('depth-map');
  if (!container) return;

  const readings = await loadReadings();
  const points = mappablePoints(readings);
  const hidden = excludedCount(readings);

  if (points.length < 3) {
    if (depthMap) {
      depthMap.remove();
      depthMap = null;
      depthLayers = {};
    }
    container.innerHTML =
      '<div style="padding:40px;text-align:center;color:#666">Need at least 3 GPS points to render the map</div>';
    return;
  }

  // Leaflet cannot re-init over a container it already owns.
  if (depthMap) {
    depthMap.remove();
    depthMap = null;
  }
  container.innerHTML = '';
  depthLayers = {};

  const offset = getOffset();
  const fc = toFeatureCollection(points, offset);
  const maxDepth = maxDepthOf(fc);
  const center = turf.center(fc).geometry.coordinates;

  depthMap = createMap('depth-map', [center[1], center[0]]);

  depthLayers.depth = buildTinLayer(fc, maxDepth).addTo(depthMap);
  try {
    depthLayers.contours = buildContourLayer(fc, maxDepth).addTo(depthMap);
  } catch (e) {
    console.warn('Could not build contours', e.message);
  }
  depthLayers.points = buildPointsLayer(fc, maxDepth, 4).addTo(depthMap);

  const weeds = buildWeedsLayer(points);
  if (weeds) depthLayers.weeds = weeds.addTo(depthMap);

  const shore = buildShoreLayer(points);
  if (shore) depthLayers.shore = shore.addTo(depthMap);

  const fish = buildFishLayer(await fishCatches());
  if (fish) depthLayers.fish = fish.addTo(depthMap);

  depthMap.fitBounds(depthLayers.depth.getBounds(), { padding: [30, 30] });
  applyLayerToggles();

  const legend = $('#map-legend');
  renderLegend(legend, maxDepth, { offset });
  if (hidden && legend) {
    const note = document.createElement('span');
    note.className = 'legend-item legend-note';
    note.textContent = `${hidden} point${hidden === 1 ? '' : 's'} hidden (GPS worse than ${MAX_ACCURACY_M}m)`;
    legend.appendChild(note);
  }
}

export async function renderLiveMap() {
  startTracking();

  const fix = getFix();
  if (!liveMap) {
    const start = fix ? [fix.latitude, fix.longitude] : [41.73, 44.73];
    liveMap = createMap('live-map', start);
    liveMarker = L.marker(start, {
      icon: L.divIcon({ className: 'live-marker', iconSize: [16, 16] }),
      // Markers have no bringToFront(); the z-index offset keeps the live dot
      // above the point layers for good.
      zIndexOffset: 1000
    }).addTo(liveMap);
  }

  if (fix) {
    liveMarker.setLatLng([fix.latitude, fix.longitude]);
    liveMap.setView([fix.latitude, fix.longitude], liveMap.getZoom());
  }

  await refreshLiveMap({ fit: true });

  if (!liveMap._followTimer) {
    liveMap._followTimer = setInterval(() => {
      const current = getFix();
      if (!current || getScreen() !== 'livemap' || !liveMarker) return;
      const pos = [current.latitude, current.longitude];
      liveMarker.setLatLng(pos);
      if (!liveMap.getBounds().contains(pos)) liveMap.panTo(pos);
    }, 1000);
  }

  setTimeout(() => liveMap.invalidateSize(), 100);
}

export async function refreshLiveMap({ fit = false } = {}) {
  if (!liveMap || !getProjectId()) return;

  liveLayers = clearLayers(liveMap, liveLayers);

  const points = mappablePoints(await loadReadings());
  if (!points.length) return;

  const offset = getOffset();
  const fc = toFeatureCollection(points, offset);
  const maxDepth = maxDepthOf(fc);

  liveLayers.points = buildPointsLayer(fc, maxDepth, 6).addTo(liveMap);

  if (points.length >= 3) {
    try {
      liveLayers.contours = buildContourLayer(fc, maxDepth).addTo(liveMap);
    } catch (e) {
      console.warn('Could not build live contours', e.message);
    }
  }

  const weeds = buildWeedsLayer(points);
  if (weeds) liveLayers.weeds = weeds.addTo(liveMap);

  const shore = buildShoreLayer(points, 20);
  if (shore) liveLayers.shore = shore.addTo(liveMap);

  const fish = buildFishLayer(await fishCatches(), 20);
  if (fish) liveLayers.fish = fish.addTo(liveMap);

  if (fit) {
    try {
      const bounds = liveLayers.points.getBounds();
      if (bounds.isValid()) liveMap.fitBounds(bounds, { padding: [20, 20], maxZoom: 17 });
    } catch {
      /* no valid bounds yet */
    }
  }
}
