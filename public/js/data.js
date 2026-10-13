import * as api from './api.js';
import { getUnsynced } from './store.js';
import { getProjectId } from './state.js';
import { MAX_ACCURACY_M } from './depth.js';

// One reading shape for the table, the depth map and the live map, merged from
// the server and the not-yet-pushed local queue.
function fromServer(row) {
  return {
    id: row.id,
    origin: 'server',
    depth: row.depth,
    coords: row.latitude != null
      ? { latitude: row.latitude, longitude: row.longitude, accuracy: row.accuracy }
      : null,
    hasWeeds: Boolean(row.hasWeeds),
    isShore: Boolean(row.isShore),
    createdAt: row.createdAt
  };
}

function fromLocal(row) {
  return {
    id: row.id,
    origin: 'local',
    depth: row.depth,
    coords: row.coords || null,
    hasWeeds: Boolean(row.hasWeeds),
    isShore: Boolean(row.isShore),
    createdAt: row.createdAt,
    raw: row
  };
}

export async function loadReadings() {
  const projectId = getProjectId();
  if (!projectId) return [];

  let server = [];
  try {
    server = (await api.getReadings(projectId)).map(fromServer);
  } catch (e) {
    console.warn('Could not load server readings', e.message);
  }

  let queued = [];
  try {
    queued = (await getUnsynced(projectId)).map(fromLocal);
  } catch (e) {
    console.warn('Could not read the local queue', e.message);
  }

  return [...queued, ...server].sort((a, b) => b.createdAt - a.createdAt);
}

// Points usable for interpolation: they need coordinates, and a fix too vague
// would smear the contours.
export function mappablePoints(readings) {
  return readings.filter(r => r.coords && (r.coords.accuracy == null || r.coords.accuracy <= MAX_ACCURACY_M));
}

export function excludedCount(readings) {
  return readings.length - mappablePoints(readings).length;
}
