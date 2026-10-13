const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// db.js reads DB_PATH when it is first required, so set it before loading the app.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lake-logger-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const app = require('../server');

let base;
let server;

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function api(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

const reading = (overrides = {}) => ({
  clientId: 'c-' + Math.random().toString(36).slice(2),
  depth: 3.5,
  coords: { latitude: 41.7, longitude: 44.8, accuracy: 8 },
  hasWeeds: false,
  hasFish: false,
  isShore: false,
  createdAt: Date.now(),
  ...overrides
});

async function newProject(name) {
  const res = await api('POST', '/api/projects', { name });
  assert.equal(res.body.ok, true, 'project create failed: ' + JSON.stringify(res.body));
  return res.body.id;
}

test('creates a project and lists it with a reading count', async () => {
  const id = await newProject('Lisi');
  const { body } = await api('GET', '/api/projects');
  const found = body.projects.find(p => p.id === id);
  assert.equal(found.name, 'Lisi');
  assert.equal(found.readingsCount, 0);
  assert.equal(found.waterLevelOffset, 0);
});

test('rejects a project without a name and a duplicate name', async () => {
  assert.equal((await api('POST', '/api/projects', { name: '  ' })).status, 400);
  await newProject('Turtle Lake');
  assert.equal((await api('POST', '/api/projects', { name: 'Turtle Lake' })).status, 400);
});

test('sync stores readings and is idempotent per clientId', async () => {
  const id = await newProject('Sync lake');
  const batch = [reading({ clientId: 'a' }), reading({ clientId: 'b' })];

  const first = await api('POST', `/api/projects/${id}/sync`, { readings: batch });
  assert.equal(first.body.saved, 2);

  // A retry after a lost response must not duplicate rows.
  const retry = await api('POST', `/api/projects/${id}/sync`, { readings: batch });
  assert.equal(retry.body.saved, 0);
  assert.equal(retry.body.duplicates, 2);

  const { body } = await api('GET', `/api/projects/${id}/readings`);
  assert.equal(body.readings.length, 2);
});

test('clearing readings affects only the named project', async () => {
  const a = await newProject('Clear A');
  const b = await newProject('Clear B');
  await api('POST', `/api/projects/${a}/sync`, { readings: [reading()] });
  await api('POST', `/api/projects/${b}/sync`, { readings: [reading(), reading()] });

  const cleared = await api('DELETE', `/api/projects/${a}/readings`);
  assert.equal(cleared.body.deleted, 1);

  assert.equal((await api('GET', `/api/projects/${a}/readings`)).body.readings.length, 0);
  assert.equal((await api('GET', `/api/projects/${b}/readings`)).body.readings.length, 2);
});

test('updates and deletes a single reading', async () => {
  const id = await newProject('Edit lake');
  await api('POST', `/api/projects/${id}/sync`, { readings: [reading({ depth: 2 })] });
  const [row] = (await api('GET', `/api/projects/${id}/readings`)).body.readings;

  const patched = await api('PATCH', `/api/readings/${row.id}`, {
    depth: 4.2, hasWeeds: true, isShore: false, latitude: 41.1, longitude: 44.1
  });
  assert.equal(patched.body.ok, true);

  const [updated] = (await api('GET', `/api/projects/${id}/readings`)).body.readings;
  assert.equal(updated.depth, 4.2);
  assert.equal(updated.hasWeeds, 1);

  assert.equal((await api('PATCH', `/api/readings/${row.id}`, { depth: 'deep' })).status, 400);
  assert.equal((await api('PATCH', '/api/readings/999999', { depth: 1 })).status, 404);

  await api('DELETE', `/api/readings/${row.id}`);
  assert.equal((await api('GET', `/api/projects/${id}/readings`)).body.readings.length, 0);
});

test('stores a water level offset and returns it with the project', async () => {
  const id = await newProject('Offset lake');
  const saved = await api('PATCH', `/api/projects/${id}`, { waterLevelOffset: -0.3 });
  assert.equal(saved.body.waterLevelOffset, -0.3);

  const { body } = await api('GET', '/api/projects');
  assert.equal(body.projects.find(p => p.id === id).waterLevelOffset, -0.3);

  assert.equal((await api('PATCH', `/api/projects/${id}`, { waterLevelOffset: 'low' })).status, 400);
});

test('reports shore readings separately', async () => {
  const id = await newProject('Shore lake');
  await api('POST', `/api/projects/${id}/sync`, {
    readings: [reading({ depth: 0, isShore: true }), reading({ depth: 5 })]
  });
  const { body } = await api('GET', `/api/projects/${id}/shore`);
  assert.equal(body.shores.length, 1);
  assert.equal(body.shores[0].depth, 0);
});

test('import skips readings whose coordinates already exist', async () => {
  const id = await newProject('Import lake');
  const payload = [
    { depth: 1.5, latitude: 41.71, longitude: 44.81, accuracy: 5, createdAt: 1700000000000 },
    { depth: 2.5, latitude: 41.72, longitude: 44.82, accuracy: 5, createdAt: 1700000001000 }
  ];
  const first = await api('POST', `/api/projects/${id}/import`, { readings: payload });
  assert.equal(first.body.imported, 2);

  const second = await api('POST', `/api/projects/${id}/import`, { readings: payload });
  assert.equal(second.body.imported, 0);
  assert.equal(second.body.skipped, 2);

  assert.equal((await api('POST', `/api/projects/${id}/import`, { readings: [] })).status, 400);
});

test('import maps the legacy hasFish flag onto weeds', async () => {
  const id = await newProject('Legacy lake');
  await api('POST', `/api/projects/${id}/import`, {
    readings: [{ depth: 3, latitude: 42.1, longitude: 45.1, hasFish: true, createdAt: 1700000002000 }]
  });
  const [row] = (await api('GET', `/api/projects/${id}/readings`)).body.readings;
  assert.equal(row.hasWeeds, 1);
  assert.equal(row.hasFish, 0);
});

test('fish catches round-trip and update', async () => {
  const id = await newProject('Fish lake');
  const created = await api('POST', `/api/projects/${id}/fish`, {
    fishType: 'Pike', weight: 2.4, length: 61, notes: 'spinner', latitude: 41.7, longitude: 44.8
  });
  assert.equal(created.body.ok, true);

  await api('PATCH', `/api/fish/${created.body.id}`, { fishType: 'Zander', weight: 3 });
  const { body } = await api('GET', `/api/projects/${id}/fish`);
  assert.equal(body.catches[0].fishType, 'Zander');
  assert.equal(body.catches[0].weight, 3);

  await api('DELETE', `/api/fish/${created.body.id}`);
  assert.equal((await api('GET', `/api/projects/${id}/fish`)).body.catches.length, 0);
});

test('deleting a project removes its readings and fish catches', async () => {
  const id = await newProject('Doomed lake');
  await api('POST', `/api/projects/${id}/sync`, { readings: [reading()] });
  await api('POST', `/api/projects/${id}/fish`, { fishType: 'Carp' });

  assert.equal((await api('DELETE', `/api/projects/${id}`)).body.ok, true);
  assert.equal((await api('GET', `/api/projects/${id}/readings`)).body.readings.length, 0);
  assert.equal((await api('GET', `/api/projects/${id}/fish`)).body.catches.length, 0);
  assert.equal((await api('GET', '/api/projects')).body.projects.some(p => p.id === id), false);
});

test('unknown api endpoints answer with json, not the app shell', async () => {
  const { status, body } = await api('GET', '/api/nope');
  assert.equal(status, 404);
  assert.equal(body.ok, false);
});
