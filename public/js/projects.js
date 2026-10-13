import * as api from './api.js';
import { getProject, setProject, clearProject } from './state.js';
import { emit } from './events.js';
import { $, toast, el, confirmAction } from './ui.js';
import { pushQueue, queuedCount } from './sync.js';

export async function loadProjects() {
  try {
    renderProjectsList(await api.listProjects());
  } catch (e) {
    const list = $('#projects-list');
    if (list) {
      list.innerHTML = '';
      list.appendChild(el('div', 'projects-empty', 'Could not reach the server. Pick a project once you are back online.'));
    }
    console.error('Failed to load projects', e);
  }
}

function renderProjectsList(projects) {
  const list = $('#projects-list');
  if (!list) return;
  list.innerHTML = '';

  if (!projects.length) {
    list.appendChild(el('div', 'projects-empty', 'No projects yet. Create one below.'));
    return;
  }

  for (const project of projects) {
    const row = el('div', 'project-item');
    const info = el('div');
    info.append(
      el('div', 'project-name', project.name),
      el('div', 'project-count', `${project.readingsCount} readings`)
    );

    const remove = el('button', 'project-delete', '✕');
    remove.title = 'Delete project';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteProject(project);
    });

    row.append(info, remove);
    row.addEventListener('click', () => selectProject(project));
    list.appendChild(row);
  }
}

export async function selectProject(project) {
  // Flush whatever the previous project still had queued before switching.
  await pushQueue();
  setProject(project);
  $('#bottombar-project').textContent = project.name;
  emit('project:changed', getProject());
  emit('screen:request', 'logger');
}

async function createProject(name) {
  try {
    const project = await api.createProject(name);
    toast(`Created project: ${name}`);
    $('#new-project-input').value = '';
    await loadProjects();
    return project;
  } catch (e) {
    toast(e.message || 'Failed to create project');
    return null;
  }
}

async function deleteProject(project) {
  if (!confirmAction(`Delete "${project.name}" and all its readings?`)) return;
  try {
    await api.deleteProject(project.id);
    toast(`Deleted: ${project.name}`);
    if (getProject()?.id === project.id) {
      clearProject();
      $('#bottombar-project').textContent = 'No project';
      emit('project:changed', null);
    }
    await loadProjects();
  } catch (e) {
    toast('Failed to delete: ' + e.message);
  }
}

async function handleImport(file) {
  const project = getProject();
  if (!project || !file) {
    toast('Select a project first');
    return;
  }
  try {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast('Invalid JSON file');
      return;
    }

    const readings = Array.isArray(data) ? data : data.readings || [];
    if (!readings.length) {
      toast('No readings found in that file');
      return;
    }

    const result = await api.importReadings(project.id, readings);
    const skipped = result.skipped ? ` (${result.skipped} duplicates skipped)` : '';
    toast(`Imported ${result.imported} readings${skipped}`);
    emit('readings:changed');
  } catch (e) {
    console.error('Import error', e);
    toast('Import failed: ' + e.message);
  } finally {
    $('#import-file-input').value = '';
  }
}

// localStorage only holds what this device last saw. On startup, re-read the
// project from the server so an offset or rename saved elsewhere takes effect.
export async function refreshCurrentProject() {
  const current = getProject();
  if (!current) return;
  try {
    const fresh = (await api.listProjects()).find(p => p.id === current.id);
    if (!fresh) {
      clearProject();
      $('#bottombar-project').textContent = 'No project';
      toast('That project no longer exists on the server');
      emit('project:changed', null);
      emit('screen:request', 'projects');
      return;
    }
    const changed =
      fresh.name !== current.name ||
      Number(fresh.waterLevelOffset) !== Number(current.waterLevelOffset);
    if (changed) {
      setProject(fresh);
      $('#bottombar-project').textContent = fresh.name;
      emit('project:changed', getProject());
    }
  } catch {
    // Offline: the cached copy is the best we have.
  }
}

export async function updateQueuedBadge() {
  const badge = $('#offline-badge');
  if (!badge) return;
  const queued = await queuedCount();
  badge.textContent = queued ? `${queued} queued` : 'All synced';
  badge.classList.toggle('warn', queued > 0);
}

export function bindProjects() {
  $('#add-project-btn').addEventListener('click', () => {
    const name = $('#new-project-input').value.trim();
    if (name) createProject(name);
  });
  $('#new-project-input').addEventListener('keypress', (e) => {
    if (e.key !== 'Enter') return;
    const name = $('#new-project-input').value.trim();
    if (name) createProject(name);
  });
  $('#import-btn').addEventListener('click', () => {
    $('#settings-menu').classList.add('hidden');
    $('#import-file-input').click();
  });
  $('#import-file-input').addEventListener('change', (e) => {
    if (e.target.files[0]) handleImport(e.target.files[0]);
  });
}
