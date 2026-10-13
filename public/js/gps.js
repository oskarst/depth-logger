import { $ } from './ui.js';

const WATCH_OPTS = { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 };

let watchId = null;
let fix = null; // { latitude, longitude, accuracy, ts }

export function getFix() {
  return fix;
}

export function startTracking() {
  if (!('geolocation' in navigator)) return;
  if (watchId != null) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      fix = { latitude, longitude, accuracy, ts: pos.timestamp || Date.now() };
    },
    (err) => console.warn('watchPosition error', err),
    WATCH_OPTS
  );
}

export function stopTracking() {
  if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function updatePermissionBadge(state) {
  const labels = { granted: 'GPS: On', prompt: 'GPS: Tap Enable', denied: 'GPS: Blocked' };
  const badge = $('#coord-status');
  if (badge) badge.textContent = labels[state] || 'GPS: Unknown';
}

export async function ensurePermission() {
  try {
    if (!navigator.permissions) return true;
    const status = await navigator.permissions.query({ name: 'geolocation' });
    updatePermissionBadge(status.state);
    return status.state !== 'denied';
  } catch {
    return true;
  }
}

export async function watchPermission() {
  if (!navigator.permissions) return;
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    updatePermissionBadge(status.state);
    status.onchange = () => updatePermissionBadge(status.state);
  } catch {
    /* permissions API unavailable */
  }
}

// Anything older than this is called out, so a point saved without a usable
// fix is visible rather than silent.
const STALE_AFTER_MS = 15000;

export function renderLiveLine() {
  const liveLineEl = $('#live-line');
  if (!liveLineEl) return;
  if (!fix) {
    liveLineEl.textContent = 'Live: waiting for GPS…';
    liveLineEl.classList.add('stale');
    return;
  }
  const age = Math.max(0, Date.now() - fix.ts);
  const seconds = Math.round(age / 1000);
  liveLineEl.classList.toggle('stale', age > STALE_AFTER_MS);
  liveLineEl.textContent =
    `Live: ${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)}` +
    ` • ~${Math.round(fix.accuracy || 0)}m • ${seconds}s ago` +
    (age > STALE_AFTER_MS ? ' • stale' : '');
}

// Resolves with a fix no older than maxAgeMs, waiting up to maxWaitMs for the
// watch to deliver one. Resolves with whatever we have (possibly null) on
// timeout rather than blocking a depth entry.
export function getFreshFix({ maxAgeMs = 10000, maxWaitMs = 3000 } = {}) {
  const fresh = () => fix && Date.now() - fix.ts < maxAgeMs;
  if (fresh()) return Promise.resolve(fix);
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (fresh() || Date.now() - started > maxWaitMs) {
        clearInterval(timer);
        resolve(fresh() ? fix : null);
      }
    }, 250);
  });
}
