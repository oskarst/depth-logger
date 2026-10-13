// Local IndexedDB queue. Readings are written here first so logging works with
// no signal, then pushed to the server by sync.js.
//
// Every row carries a projectId. Version 1 did not, which is why the original
// app showed one project's unpushed points inside another and why Clear wiped
// the whole store; the v2 upgrade stamps legacy rows with the last project the
// app had open, the only project they could have been logged under.
const DB_NAME = 'lakeLogger';
const DB_VERSION = 2;

let db;

// Minted once per reading, when it is created, and kept with it. A retry after
// a dropped response must re-send the same id or the server cannot tell the
// retry from a second sounding.
export function newClientId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const upgrading = e.target.result;
      const tx = e.target.transaction;

      let store;
      if (!upgrading.objectStoreNames.contains('readings')) {
        store = upgrading.createObjectStore('readings', { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_synced', 'synced');
        store.createIndex('by_time', 'createdAt');
      } else {
        store = tx.objectStore('readings');
      }

      if (!store.indexNames.contains('by_project')) {
        store.createIndex('by_project', 'projectId');
      }

      if (e.oldVersion < 2) {
        const fallbackId = Number(localStorage.getItem('currentProjectId')) || null;
        store.openCursor().onsuccess = (cursorEvent) => {
          const cursor = cursorEvent.target.result;
          if (!cursor) return;
          const row = cursor.value;
          if (row.projectId == null && fallbackId != null) {
            cursor.update({ ...row, projectId: fallbackId });
          }
          cursor.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('tx aborted'));
  });
}

async function withStore(mode, fn) {
  if (!db) db = await openDB();
  const tx = db.transaction('readings', mode);
  const store = tx.objectStore('readings');
  const out = await fn(store, reqToPromise);
  await txDone(tx);
  return out;
}

export async function initStore() {
  if (!db) db = await openDB();
  return db;
}

// Rows for one project only. A null projectId means "every row", used by the
// export, which deliberately dumps the whole local queue.
export async function getAllLocal(projectId = null) {
  const rows = await withStore('readonly', (store, rp) => rp(store.getAll()));
  if (projectId == null) return rows;
  return rows.filter(r => Number(r.projectId) === Number(projectId));
}

export async function getUnsynced(projectId) {
  const rows = await getAllLocal(projectId);
  return rows.filter(r => !r.synced);
}

export async function countUnsynced(projectId) {
  return (await getUnsynced(projectId)).length;
}

export const addLocal = (reading) => withStore('readwrite', (store, rp) => rp(store.add(reading)));
export const putLocal = (reading) => withStore('readwrite', (store, rp) => rp(store.put(reading)));
export const deleteLocal = (id) => withStore('readwrite', (store, rp) => rp(store.delete(id)));

// Drops only the rows of one project, so clearing a project cannot destroy
// another project's unpushed readings.
export async function clearLocalProject(projectId) {
  const rows = await getAllLocal(projectId);
  await withStore('readwrite', (store, rp) => Promise.all(rows.map(r => rp(store.delete(r.id)))));
  return rows.length;
}

export async function markSynced(readings) {
  if (!readings.length) return;
  await withStore('readwrite', (store, rp) =>
    Promise.all(readings.map(r => rp(store.put({ ...r, synced: true }))))
  );
}
