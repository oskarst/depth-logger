import { addLocal, newClientId } from './store.js';
import { getProjectId } from './state.js';
import { getFreshFix, ensurePermission, startTracking } from './gps.js';
import { emit } from './events.js';
import { toast, $ } from './ui.js';

let lastSavedPoint = null;

export function updateLastSavedUI() {
  const el = $('#last-saved');
  if (!el) return;
  if (!lastSavedPoint) {
    el.textContent = 'Last saved: —';
    return;
  }
  el.textContent =
    `Last saved: ${lastSavedPoint.latitude.toFixed(5)}, ${lastSavedPoint.longitude.toFixed(5)}` +
    ` • ~${Math.round(lastSavedPoint.accuracy || 0)}m`;
}

export function noteLastSaved(coords) {
  if (coords) {
    lastSavedPoint = coords;
    updateLastSavedUI();
  }
}

export async function logPoint(depth, isShore = false) {
  const projectId = getProjectId();
  if (!projectId) {
    toast('Select a project first');
    return null;
  }
  if (!(await ensurePermission())) toast('Enable location in settings');
  startTracking();

  const fix = await getFreshFix();
  const reading = {
    projectId,
    clientId: newClientId(),
    depth,
    coords: fix ? { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy } : null,
    hasWeeds: false,
    hasFish: false,
    isShore,
    createdAt: Date.now(),
    synced: false
  };

  await addLocal(reading);
  noteLastSaved(reading.coords);
  emit('readings:changed');
  emit('readings:logged', reading);

  const where = reading.coords
    ? ` @ ${reading.coords.latitude.toFixed(5)}, ${reading.coords.longitude.toFixed(5)}`
    : ' • no GPS';
  toast(isShore ? `Shore line marked 🏖️${where}` : `Saved ${depth.toFixed(1)}m${where}`);
  return reading;
}
