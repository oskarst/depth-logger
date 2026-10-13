import { toast } from './ui.js';

// One pad, used by both the logger screen and the live-map screen. The entry
// state is shared on purpose: switching screens mid-entry keeps your place.
const LOW_MAX = 17;
const HIGH_MIN = 18;
const HIGH_MAX = 40;

let highRange = false;
let awaitingWhole = null;

// Pure, so it can be unit tested without a DOM.
export function padKeys({ high = false, whole = null } = {}) {
  if (whole !== null) {
    const keys = [];
    for (let n = 0; n <= 9; n++) keys.push({ label: String(n), value: n, kind: 'decimal' });
    keys.push({ label: '✕', value: null, kind: 'cancel' });
    return keys;
  }
  if (!high) {
    const keys = [{ label: 'Shore', value: null, kind: 'shore' }];
    for (let n = 0; n <= LOW_MAX; n++) keys.push({ label: String(n), value: n, kind: 'whole' });
    keys.push({ label: '...', value: null, kind: 'range' });
    return keys;
  }
  const keys = [{ label: '...', value: null, kind: 'range' }];
  for (let n = HIGH_MIN; n <= HIGH_MAX; n++) keys.push({ label: String(n), value: n, kind: 'whole' });
  return keys;
}

export function rangeLabel(high = highRange) {
  return high ? `${HIGH_MIN}–${HIGH_MAX}` : `0–${LOW_MAX}`;
}

const CLASS_FOR_KIND = { range: 'toggler', cancel: 'cancel', shore: 'shore' };

// Both pads (logger screen and live map) are kept in sync, so a half-entered
// depth never shows two different keypads.
const mounted = new Map();

export function mountPad(container, handlers) {
  if (!container) return;
  mounted.set(container, handlers);
  renderPad(container, handlers);
}

function rerenderAll() {
  for (const [container, handlers] of mounted) renderPad(container, handlers);
}

function renderPad(container, { onLog, onShore }) {
  if (!container) return;
  container.innerHTML = '';
  const rerender = rerenderAll;

  for (const key of padKeys({ high: highRange, whole: awaitingWhole })) {
    const btn = document.createElement('button');
    btn.className = 'key' + (CLASS_FOR_KIND[key.kind] ? ' ' + CLASS_FOR_KIND[key.kind] : '');
    btn.textContent = key.label;
    btn.addEventListener('click', async () => {
      if (key.kind === 'cancel') {
        awaitingWhole = null;
        rerender();
        toast('Cancelled');
        return;
      }
      if (key.kind === 'range') {
        highRange = !highRange;
        rerender();
        toast('Range ' + rangeLabel());
        return;
      }
      if (key.kind === 'shore') {
        try {
          await onShore();
        } catch (e) {
          console.error('Failed to log shore point', e);
          toast('Error saving shore point');
        }
        return;
      }
      if (awaitingWhole === null) {
        awaitingWhole = key.value;
        rerender();
        return;
      }
      const depth = Number(`${awaitingWhole}.${key.value}`);
      awaitingWhole = null;
      try {
        await onLog(depth);
      } catch (e) {
        console.error('Failed to log point', e);
        toast('Error saving point');
      } finally {
        rerender();
      }
    });
    container.appendChild(btn);
  }
}
