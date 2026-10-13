// Every server call lives here. Each helper throws on a transport error or an
// { ok: false } body so callers can simply try/catch.
async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`${method} ${url} returned a non-JSON response`);
  }
  if (data.offline) throw new Error('offline');
  if (!res.ok || !data.ok) throw new Error(data.error || `${method} ${url} failed`);
  return data;
}

export const listProjects = () => request('GET', '/api/projects').then(d => d.projects);
export const createProject = (name) => request('POST', '/api/projects', { name }).then(d => d.project);
export const deleteProject = (id) => request('DELETE', `/api/projects/${id}`);
export const setProjectOffset = (id, waterLevelOffset) =>
  request('PATCH', `/api/projects/${id}`, { waterLevelOffset });

export const getReadings = (projectId) =>
  request('GET', `/api/projects/${projectId}/readings`).then(d => d.readings);
export const syncReadings = (projectId, readings) =>
  request('POST', `/api/projects/${projectId}/sync`, { readings });
export const clearReadings = (projectId) =>
  request('DELETE', `/api/projects/${projectId}/readings`).then(d => d.deleted);
export const patchReading = (id, fields) => request('PATCH', `/api/readings/${id}`, fields);
export const deleteReading = (id) => request('DELETE', `/api/readings/${id}`);
export const getShore = (projectId) =>
  request('GET', `/api/projects/${projectId}/shore`).then(d => d.shores);
export const importReadings = (projectId, readings) =>
  request('POST', `/api/projects/${projectId}/import`, { readings });

export const getFish = (projectId) =>
  request('GET', `/api/projects/${projectId}/fish`).then(d => d.catches);
export const addFish = (projectId, fields) => request('POST', `/api/projects/${projectId}/fish`, fields);
export const patchFish = (id, fields) => request('PATCH', `/api/fish/${id}`, fields);
export const deleteFish = (id) => request('DELETE', `/api/fish/${id}`);
