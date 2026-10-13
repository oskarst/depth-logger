import * as api from './api.js';
import { getProject, setOffset } from './state.js';
import { emit } from './events.js';
import { $, toast } from './ui.js';

async function open() {
  const project = getProject();
  if (!project) {
    toast('Select a project first');
    return;
  }

  $('#water-level-offset').value = project.waterLevelOffset || 0;

  const info = $('#shore-readings-info');
  try {
    const shores = await api.getShore(project.id);
    info.textContent = shores.length
      ? `${shores.length} shore point(s). Latest: ${new Date(shores[0].createdAt).toLocaleDateString()}`
      : 'No shore points recorded yet.';
  } catch {
    info.textContent = '';
  }

  $('#water-level-modal').classList.remove('hidden');
}

function close() {
  $('#water-level-modal').classList.add('hidden');
}

async function save() {
  const project = getProject();
  if (!project) return;
  const offset = parseFloat($('#water-level-offset').value) || 0;
  try {
    await api.setProjectOffset(project.id, offset);
    setOffset(offset);
    toast(offset ? `Depths now shown with a ${offset > 0 ? '+' : ''}${offset}m offset` : 'Offset cleared');
    close();
    emit('project:changed', getProject());
  } catch (e) {
    toast('Failed to save: ' + e.message);
  }
}

// Shown in the top bar whenever readings are not displayed as measured.
export function renderOffsetBadge() {
  const badge = $('#offset-badge');
  if (!badge) return;
  const offset = getProject()?.waterLevelOffset || 0;
  badge.textContent = offset ? `offset ${offset > 0 ? '+' : ''}${offset}m` : '';
  badge.classList.toggle('hidden', !offset);
}

export function bindWaterLevel() {
  $('#water-level-btn').addEventListener('click', () => {
    $('#settings-menu').classList.add('hidden');
    open();
  });
  $('#water-level-modal-close').addEventListener('click', close);
  $('#water-level-modal').querySelector('.modal-backdrop').addEventListener('click', close);
  $('#water-level-modal-save').addEventListener('click', save);
}
