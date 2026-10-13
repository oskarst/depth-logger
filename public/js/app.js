import { $, toast } from './ui.js';
import { on, emit } from './events.js';
import { initStore, getAllLocal } from './store.js';
import { getProject, getProjectId, getScreen, setScreen, restoreProject } from './state.js';
import { startTracking, renderLiveLine, watchPermission, ensurePermission } from './gps.js';
import { mountPad } from './pad.js';
import { logPoint, updateLastSavedUI } from './logger.js';
import { pushQueue, queuedCount, startAutoSync } from './sync.js';
import { loadProjects, selectProject, bindProjects, updateQueuedBadge, refreshCurrentProject } from './projects.js';
import { renderDataTable, bindReadingModal, tagLatestWithWeeds, clearCurrentProject } from './readings.js';
import { renderFishTable, bindFish } from './fish.js';
import { renderDepthMap, renderLiveMap, refreshLiveMap, bindLayerToggles } from './maps.js';
import { bindWaterLevel, renderOffsetBadge } from './waterlevel.js';

const LOGGER_SCREENS = ['logger', 'data', 'map', 'livemap'];

function showScreen(which) {
  setScreen(which);

  $('#screen-projects').classList.toggle('active', which === 'projects');
  $('#logger-content').classList.toggle('hidden', !LOGGER_SCREENS.includes(which));
  $('#screen-logger').classList.toggle('active', which === 'logger');
  $('#screen-data').classList.toggle('active', which === 'data');
  $('#screen-map').classList.toggle('active', which === 'map');
  $('#screen-livemap').classList.toggle('active', which === 'livemap');

  renderActiveScreen();
}

function renderActiveScreen() {
  const screen = getScreen();
  if (screen === 'projects') loadProjects();
  if (screen === 'data') {
    renderDataTable();
    renderFishTable();
  }
  if (screen === 'map') renderDepthMap();
  if (screen === 'livemap') renderLiveMap();
}

function toggleScreen(which) {
  showScreen(getScreen() === which ? 'logger' : which);
}

async function exportProjectJson() {
  $('#settings-menu').classList.add('hidden');
  const project = getProject();
  if (!project) {
    toast('Select a project first');
    return;
  }

  let readings = [];
  try {
    const { loadReadings } = await import('./data.js');
    readings = (await loadReadings()).map(r => ({
      depth: r.depth,
      latitude: r.coords?.latitude ?? null,
      longitude: r.coords?.longitude ?? null,
      accuracy: r.coords?.accuracy ?? null,
      hasWeeds: r.hasWeeds,
      isShore: r.isShore,
      createdAt: r.createdAt
    }));
  } catch (e) {
    toast('Could not read the readings: ' + e.message);
    return;
  }

  const payload = {
    project: project.name,
    waterLevelOffset: project.waterLevelOffset,
    exportedAt: new Date().toISOString(),
    readings
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.replace(/[^\w.-]+/g, '-')}-readings.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${readings.length} readings`);
}

async function syncNow() {
  $('#settings-menu').classList.add('hidden');
  if (!getProjectId()) {
    toast('Select a project first');
    return;
  }
  const queued = await queuedCount();
  if (!queued) {
    toast('Nothing to sync');
    return;
  }
  const saved = await pushQueue({ silent: false });
  toast(saved === null ? 'Sync failed — points stay queued' : `Synced ${saved} readings`);
}

function bindChrome() {
  $('#data-btn').addEventListener('click', () => toggleScreen('data'));
  $('#map-btn').addEventListener('click', () => toggleScreen('map'));
  $('#livemap-btn').addEventListener('click', () => toggleScreen('livemap'));
  $('#change-project-btn').addEventListener('click', () => showScreen('projects'));
  $('#weeds-btn').addEventListener('click', tagLatestWithWeeds);
  $('#clear-btn')?.addEventListener('click', clearCurrentProject);
  $('#sync-btn').addEventListener('click', syncNow);
  $('#export-btn').addEventListener('click', exportProjectJson);

  const settingsBtn = $('#settings-btn');
  const settingsMenu = $('#settings-menu');
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenu.classList.toggle('hidden');
  });
  settingsMenu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => settingsMenu.classList.add('hidden'));

  $('#loc-btn').addEventListener('click', async () => {
    settingsMenu.classList.add('hidden');
    if (!(await ensurePermission())) toast('Enable location in your browser settings');
    startTracking();
  });
}

function bindEvents() {
  on('screen:request', showScreen);

  on('readings:changed', () => {
    updateQueuedBadge();
    const screen = getScreen();
    if (screen === 'data') renderDataTable();
    if (screen === 'map') renderDepthMap();
    if (screen === 'livemap') refreshLiveMap();
  });

  on('fish:changed', () => {
    const screen = getScreen();
    if (screen === 'data') renderFishTable();
    if (screen === 'map') renderDepthMap();
    if (screen === 'livemap') refreshLiveMap();
  });

  on('project:changed', () => {
    renderOffsetBadge();
    updateQueuedBadge();
    renderActiveScreen();
  });

  on('sync:changed', updateQueuedBadge);

  window.addEventListener('online', () => toast('Back online'));
  window.addEventListener('offline', () => toast('You are offline — points stay queued'));
}

async function init() {
  await initStore();

  const padHandlers = {
    onLog: (depth) => logPoint(depth),
    onShore: () => logPoint(0, true)
  };
  mountPad($('#pad'), padHandlers);
  mountPad($('#live-pad'), padHandlers);

  bindChrome();
  bindEvents();
  bindProjects();
  bindReadingModal();
  bindFish();
  bindWaterLevel();
  bindLayerToggles();

  updateLastSavedUI();
  renderOffsetBadge();
  updateQueuedBadge();

  const restored = restoreProject();
  if (restored) {
    $('#bottombar-project').textContent = restored.name;
    showScreen('logger');
    await refreshCurrentProject();
  } else {
    showScreen('projects');
  }

  await watchPermission();
  startTracking();
  renderLiveLine();
  setInterval(renderLiveLine, 3000);

  startAutoSync();
}

init().catch(e => {
  console.error('Lake Logger failed to start', e);
  toast('Failed to start: ' + e.message);
});

// Exposed for the odd console poke while out on the water.
window.lakeLogger = { getAllLocal, pushQueue, selectProject };
