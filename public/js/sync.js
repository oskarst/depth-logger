import * as api from './api.js';
import { getUnsynced, markSynced, countUnsynced } from './store.js';
import { getProjectId } from './state.js';
import { emit, on } from './events.js';

const RETRY_MS = 30000;

let pushing = false;
let retryTimer = null;

// A reading is pushed under a clientId, so a retry after a dropped response is
// ignored by the server instead of inserting the point twice.
function withClientId(reading) {
  if (reading.clientId) return reading;
  const clientId = (crypto.randomUUID?.() || `${reading.createdAt}-${Math.random().toString(36).slice(2)}`);
  return { ...reading, clientId };
}

export async function queuedCount() {
  const projectId = getProjectId();
  if (!projectId) return 0;
  try {
    return await countUnsynced(projectId);
  } catch {
    return 0;
  }
}

// Pushes the current project's queue. Returns the number of readings accepted,
// or null when there was nothing to do. Never throws: a failed push just leaves
// the rows queued and schedules a retry.
export async function pushQueue({ silent = true } = {}) {
  const projectId = getProjectId();
  if (!projectId || pushing) return null;

  let queued;
  try {
    queued = (await getUnsynced(projectId)).map(withClientId);
  } catch (e) {
    console.error('Could not read the local queue', e);
    return null;
  }
  if (!queued.length) {
    stopRetrying();
    return null;
  }

  pushing = true;
  try {
    const result = await api.syncReadings(projectId, queued);
    await markSynced(queued);
    stopRetrying();
    emit('sync:changed', { queued: 0 });
    emit('readings:changed');
    if (!silent) emit('sync:reported', { saved: result.saved, duplicates: result.duplicates });
    return result.saved;
  } catch (e) {
    scheduleRetry();
    emit('sync:changed', { queued: queued.length, error: e.message });
    if (!silent) emit('sync:failed', { queued: queued.length, error: e.message });
    return null;
  } finally {
    pushing = false;
  }
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setInterval(() => pushQueue(), RETRY_MS);
}

function stopRetrying() {
  if (!retryTimer) return;
  clearInterval(retryTimer);
  retryTimer = null;
}

// Readings reach the server on their own: right after each entry, when the
// network comes back, and every 30s while anything is still queued.
export function startAutoSync() {
  on('readings:logged', () => pushQueue());
  on('project:changed', () => pushQueue());
  window.addEventListener('online', () => pushQueue());
  pushQueue();
}
