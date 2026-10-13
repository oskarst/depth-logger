import * as api from './api.js';
import { putLocal, deleteLocal, clearLocalProject } from './store.js';
import { getProjectId, getOffset } from './state.js';
import { loadReadings } from './data.js';
import { displayDepth } from './maplayers.js';
import { emit } from './events.js';
import { $, toast, el, confirmAction } from './ui.js';
import { pushQueue } from './sync.js';

let editing = null;

function depthCell(reading, offset) {
  const shown = displayDepth(reading, offset);
  const cell = el('td', null, shown.toFixed(1));
  if (offset) cell.title = `measured ${Number(reading.depth).toFixed(1)}m, offset ${offset > 0 ? '+' : ''}${offset}m`;
  return cell;
}

export async function renderDataTable() {
  const body = document.querySelector('#data-table tbody');
  if (!body) return;

  const offset = getOffset();
  const rows = await loadReadings();

  const header = document.querySelector('#data-table thead th:nth-child(2)');
  if (header) header.textContent = offset ? 'Depth (m) *' : 'Depth (m)';

  body.innerHTML = '';
  for (const reading of rows) {
    const tr = document.createElement('tr');
    const queued = reading.origin === 'local' ? ' (queued)' : '';
    const tags = (reading.isShore ? '🏖️' : '') + (reading.hasWeeds ? '🌿' : '');

    tr.append(
      el('td', null, new Date(reading.createdAt).toLocaleString() + queued),
      depthCell(reading, offset),
      el('td', null, tags),
      el('td', null, reading.coords ? reading.coords.latitude.toFixed(5) : ''),
      el('td', null, reading.coords ? reading.coords.longitude.toFixed(5) : '')
    );

    const actions = el('td', 'row-actions');
    const edit = el('button', 'row-btn edit-btn', '✏️');
    edit.title = 'Edit';
    edit.addEventListener('click', () => openReadingModal(reading));
    const remove = el('button', 'row-btn delete-btn', '🗑️');
    remove.title = 'Delete';
    remove.addEventListener('click', () => deleteReadingEntry(reading));
    actions.append(edit, remove);
    tr.appendChild(actions);

    body.appendChild(tr);
  }
}

async function deleteReadingEntry(reading) {
  if (!confirmAction('Delete this reading?')) return;
  try {
    if (reading.origin === 'server') await api.deleteReading(reading.id);
    else await deleteLocal(reading.id);
    emit('readings:changed');
    toast('Reading deleted');
  } catch (e) {
    toast('Failed to delete: ' + e.message);
  }
}

// === Edit modal ===

function updateShoreWarning() {
  const depth = parseFloat($('#reading-depth').value) || 0;
  $('#shore-warning').classList.toggle('hidden', !$('#reading-shore').checked || depth === 0);
}

function openReadingModal(reading) {
  editing = reading;
  const offset = getOffset();

  $('#reading-depth').value = reading.depth;
  $('#reading-weeds').checked = reading.hasWeeds;
  $('#reading-shore').checked = reading.isShore;
  $('#reading-lat').value = reading.coords?.latitude ?? '';
  $('#reading-lon').value = reading.coords?.longitude ?? '';
  $('#reading-time').textContent =
    `Recorded: ${new Date(reading.createdAt).toLocaleString()}` +
    (reading.origin === 'local' ? ' • not yet pushed to the server' : '');

  const label = document.querySelector('label[for="reading-depth"]');
  if (label) {
    label.textContent = offset
      ? `Depth (m) as measured — shown as ${displayDepth(reading, offset).toFixed(1)}m with the offset`
      : 'Depth (m)';
  }

  updateShoreWarning();
  $('#reading-modal').classList.remove('hidden');
}

function closeReadingModal() {
  $('#reading-modal').classList.add('hidden');
  editing = null;
}

async function saveReadingModal() {
  if (!editing) return;

  const depth = parseFloat($('#reading-depth').value);
  if (Number.isNaN(depth)) {
    toast('Invalid depth');
    return;
  }

  const hasWeeds = $('#reading-weeds').checked;
  const isShore = $('#reading-shore').checked;
  const latitude = $('#reading-lat').value ? parseFloat($('#reading-lat').value) : null;
  const longitude = $('#reading-lon').value ? parseFloat($('#reading-lon').value) : null;

  if (isShore && depth !== 0 && !confirmAction('Shore points should have depth 0m. Save anyway?')) return;

  try {
    if (editing.origin === 'server') {
      await api.patchReading(editing.id, { depth, hasWeeds, hasFish: false, isShore, latitude, longitude });
    } else {
      const coords = latitude != null && longitude != null
        ? { latitude, longitude, accuracy: editing.coords?.accuracy ?? null }
        : editing.coords;
      await putLocal({ ...editing.raw, depth, hasWeeds, isShore, coords });
    }
    closeReadingModal();
    emit('readings:changed');
    toast('Reading updated');
  } catch (e) {
    toast('Failed to update: ' + e.message);
  }
}

async function deleteFromModal() {
  if (!editing) return;
  if (!confirmAction('Delete this reading?')) return;
  try {
    if (editing.origin === 'server') await api.deleteReading(editing.id);
    else await deleteLocal(editing.id);
    closeReadingModal();
    emit('readings:changed');
    toast('Reading deleted');
  } catch (e) {
    toast('Failed to delete: ' + e.message);
  }
}

// Tags the newest reading of this project, whether it is still queued locally
// or already on the server. The original only ever touched the local queue, so
// the tag silently vanished once a point had been pushed.
export async function tagLatestWithWeeds() {
  const rows = await loadReadings();
  if (!rows.length) {
    toast('No points to tag yet');
    return;
  }
  const latest = rows[0];
  try {
    if (latest.origin === 'server') {
      await api.patchReading(latest.id, {
        depth: latest.depth,
        hasWeeds: true,
        hasFish: false,
        isShore: latest.isShore,
        latitude: latest.coords?.latitude ?? null,
        longitude: latest.coords?.longitude ?? null
      });
    } else {
      await putLocal({ ...latest.raw, hasWeeds: true });
      await pushQueue();
    }
    emit('readings:changed');
    toast('Tagged the last point as Has Weeds 🌿');
  } catch (e) {
    toast('Could not tag the point: ' + e.message);
  }
}

// Clears one project: its queued rows and its server rows. Other projects'
// queued readings are left alone.
export async function clearCurrentProject() {
  const projectId = getProjectId();
  if (!projectId) {
    toast('Select a project first');
    return;
  }
  if (!confirmAction('Clear ALL saved points for this project? This cannot be undone.')) return;

  try {
    await clearLocalProject(projectId);
    await api.clearReadings(projectId);
    emit('readings:changed');
    toast('All points for this project cleared');
  } catch (e) {
    toast('Cleared locally, but the server refused: ' + e.message);
    emit('readings:changed');
  }
}

export function bindReadingModal() {
  $('#reading-modal-close').addEventListener('click', closeReadingModal);
  $('#reading-modal').querySelector('.modal-backdrop').addEventListener('click', closeReadingModal);
  $('#reading-depth').addEventListener('input', updateShoreWarning);
  $('#reading-shore').addEventListener('change', updateShoreWarning);
  $('#reading-modal-save').addEventListener('click', saveReadingModal);
  $('#reading-modal-delete').addEventListener('click', deleteFromModal);
}
