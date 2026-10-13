// Current project and screen, persisted so a reload lands where you left off.
const KEY_ID = 'currentProjectId';
const KEY_NAME = 'currentProjectName';
const KEY_OFFSET = 'currentProjectOffset';

let project = null;
let screen = 'logger';

function persist() {
  if (!project) {
    localStorage.removeItem(KEY_ID);
    localStorage.removeItem(KEY_NAME);
    localStorage.removeItem(KEY_OFFSET);
    return;
  }
  localStorage.setItem(KEY_ID, String(project.id));
  localStorage.setItem(KEY_NAME, project.name);
  localStorage.setItem(KEY_OFFSET, String(project.waterLevelOffset));
}

export function getProject() {
  return project;
}

export function getProjectId() {
  return project ? project.id : null;
}

export function setProject(next) {
  project = next
    ? { id: Number(next.id), name: next.name, waterLevelOffset: Number(next.waterLevelOffset) || 0 }
    : null;
  persist();
}

export function clearProject() {
  setProject(null);
}

export function getOffset() {
  return project ? project.waterLevelOffset : 0;
}

export function setOffset(value) {
  if (!project) return;
  project.waterLevelOffset = Number(value) || 0;
  persist();
}

export function restoreProject() {
  const id = localStorage.getItem(KEY_ID);
  const name = localStorage.getItem(KEY_NAME);
  if (!id || !name) return null;
  setProject({ id, name, waterLevelOffset: localStorage.getItem(KEY_OFFSET) });
  return project;
}

export function getScreen() {
  return screen;
}

export function setScreen(next) {
  screen = next;
}
