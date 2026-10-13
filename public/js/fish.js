import * as api from './api.js';
import { getProjectId } from './state.js';
import { getFix, startTracking } from './gps.js';
import { emit } from './events.js';
import { $, toast, el, confirmAction } from './ui.js';

let editingId = null;

export async function renderFishTable() {
  const body = document.querySelector('#fish-table tbody');
  const projectId = getProjectId();
  if (!body || !projectId) return;

  let catches = [];
  try {
    catches = await api.getFish(projectId);
  } catch (e) {
    console.warn('Could not load fish catches', e.message);
    return;
  }

  body.innerHTML = '';
  for (const f of catches) {
    const tr = document.createElement('tr');
    tr.append(
      el('td', null, new Date(f.createdAt).toLocaleString()),
      el('td', null, f.fishType || '-'),
      el('td', null, f.weight ? `${f.weight} kg` : '-'),
      el('td', null, f.length ? `${f.length} cm` : '-'),
      el('td', null, f.latitude ? f.latitude.toFixed(5) : ''),
      el('td', null, f.longitude ? f.longitude.toFixed(5) : '')
    );

    const actions = el('td', 'row-actions');
    const edit = el('button', 'row-btn edit-btn', '✏️');
    edit.title = 'Edit';
    edit.addEventListener('click', () => openFishModal(f));
    const remove = el('button', 'row-btn delete-btn', '🗑️');
    remove.title = 'Delete';
    remove.addEventListener('click', async () => {
      if (!confirmAction('Delete this fish catch?')) return;
      try {
        await api.deleteFish(f.id);
        toast('Fish catch deleted');
        emit('fish:changed');
      } catch (e) {
        toast('Failed to delete: ' + e.message);
      }
    });
    actions.append(edit, remove);
    tr.appendChild(actions);

    body.appendChild(tr);
  }
}

export function openFishModal(fishCatch = null) {
  editingId = fishCatch?.id || null;
  $('#fish-modal-title').textContent = fishCatch ? 'Edit Fish Catch' : 'Log Fish Catch';
  $('#fish-modal-delete').classList.toggle('hidden', !fishCatch);

  $('#fish-type').value = fishCatch?.fishType || '';
  $('#fish-weight').value = fishCatch?.weight ?? '';
  $('#fish-length').value = fishCatch?.length ?? '';
  $('#fish-notes').value = fishCatch?.notes || '';

  const fix = getFix();
  if (fishCatch?.latitude) {
    $('#fish-lat').value = fishCatch.latitude;
    $('#fish-lon').value = fishCatch.longitude;
  } else if (fix) {
    $('#fish-lat').value = fix.latitude;
    $('#fish-lon').value = fix.longitude;
  } else {
    $('#fish-lat').value = '';
    $('#fish-lon').value = '';
  }

  $('#fish-modal').classList.remove('hidden');
}

function closeFishModal() {
  $('#fish-modal').classList.add('hidden');
  editingId = null;
}

async function saveFishModal() {
  const projectId = getProjectId();
  if (!projectId) {
    toast('Select a project first');
    return;
  }

  const fields = {
    fishType: $('#fish-type').value.trim(),
    weight: $('#fish-weight').value ? parseFloat($('#fish-weight').value) : null,
    length: $('#fish-length').value ? parseFloat($('#fish-length').value) : null,
    notes: $('#fish-notes').value.trim(),
    latitude: $('#fish-lat').value ? parseFloat($('#fish-lat').value) : null,
    longitude: $('#fish-lon').value ? parseFloat($('#fish-lon').value) : null,
    accuracy: null
  };

  try {
    if (editingId) {
      await api.patchFish(editingId, fields);
      toast('Fish catch updated');
    } else {
      await api.addFish(projectId, fields);
      toast('Fish catch logged 🐟');
    }
    closeFishModal();
    emit('fish:changed');
  } catch (e) {
    toast('Failed to save the fish catch: ' + e.message);
  }
}

export function bindFish() {
  $('#fish-modal-close').addEventListener('click', closeFishModal);
  $('#fish-modal').querySelector('.modal-backdrop').addEventListener('click', closeFishModal);
  $('#fish-modal-save').addEventListener('click', saveFishModal);
  $('#fish-modal-delete').addEventListener('click', async () => {
    if (!editingId) return;
    if (!confirmAction('Delete this fish catch?')) return;
    try {
      await api.deleteFish(editingId);
      toast('Fish catch deleted');
      closeFishModal();
      emit('fish:changed');
    } catch (e) {
      toast('Failed to delete: ' + e.message);
    }
  });
  $('#fish-btn').addEventListener('click', () => {
    startTracking();
    openFishModal();
  });
}
