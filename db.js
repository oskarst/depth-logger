const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'lake-logger.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    water_level_offset REAL DEFAULT 0,
    created_at INTEGER NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    depth REAL NOT NULL,
    latitude REAL,
    longitude REAL,
    accuracy REAL,
    has_weeds INTEGER DEFAULT 0,
    has_fish INTEGER DEFAULT 0,
    is_shore INTEGER DEFAULT 0,
    client_id TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS fish_catches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    fish_type TEXT,
    weight REAL,
    length REAL,
    notes TEXT,
    latitude REAL,
    longitude REAL,
    accuracy REAL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id)
  )
`);

// Schema migrations for databases created by earlier versions.
function addColumn(table, column, definition) {
  const cols = db.pragma(`table_info(${table})`).map(c => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
  }
  return false;
}

try {
  // The original schema called this column has_fish; it always meant weeds.
  if (addColumn('readings', 'has_weeds', 'INTEGER DEFAULT 0')) {
    db.exec(`UPDATE readings SET has_weeds = has_fish, has_fish = 0`);
  }
  addColumn('readings', 'is_shore', 'INTEGER DEFAULT 0');
  // client_id makes a sync push idempotent: a retry after a dropped response
  // re-sends the same rows and they are ignored instead of duplicated.
  addColumn('readings', 'client_id', 'TEXT');
  addColumn('projects', 'water_level_offset', 'REAL DEFAULT 0');
} catch (e) {
  console.error('Migration failed:', e.message);
  throw e;
}

db.exec(`CREATE INDEX IF NOT EXISTS idx_project_id ON readings(project_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_created ON readings(created_at)`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_readings_client_id ON readings(client_id) WHERE client_id IS NOT NULL`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_fish_project_id ON fish_catches(project_id)`);

// === Projects ===
const insertProject = db.prepare(`INSERT INTO projects (name, water_level_offset, created_at) VALUES (?, 0, ?)`);
const deleteProject = db.prepare(`DELETE FROM projects WHERE id = ?`);
const getAllProjects = db.prepare(`
  SELECT id, name, created_at as createdAt, water_level_offset as waterLevelOffset
  FROM projects ORDER BY name
`);
const getProjectById = db.prepare(`
  SELECT id, name, created_at as createdAt, water_level_offset as waterLevelOffset
  FROM projects WHERE id = ?
`);
const updateProjectOffset = db.prepare(`UPDATE projects SET water_level_offset = ? WHERE id = ?`);

// === Readings ===
const insertReading = db.prepare(`
  INSERT OR IGNORE INTO readings
    (project_id, depth, latitude, longitude, accuracy, has_weeds, has_fish, is_shore, client_id, created_at)
  VALUES (@projectId, @depth, @latitude, @longitude, @accuracy, @hasWeeds, @hasFish, @isShore, @clientId, @createdAt)
`);

const getReadings = db.prepare(`
  SELECT id, depth, latitude, longitude, accuracy, has_weeds as hasWeeds, has_fish as hasFish,
         is_shore as isShore, client_id as clientId, created_at as createdAt
  FROM readings WHERE project_id = ? ORDER BY created_at DESC
`);

const getShoreReadings = db.prepare(`
  SELECT id, depth, latitude, longitude, created_at as createdAt
  FROM readings WHERE project_id = ? AND is_shore = 1 ORDER BY created_at DESC
`);

const getReadingsCount = db.prepare(`SELECT COUNT(*) as count FROM readings WHERE project_id = ?`);
const deleteProjectReadings = db.prepare(`DELETE FROM readings WHERE project_id = ?`);
const deleteReading = db.prepare(`DELETE FROM readings WHERE id = ?`);
const updateReading = db.prepare(`
  UPDATE readings SET depth = ?, has_weeds = ?, has_fish = ?, is_shore = ?, latitude = ?, longitude = ?
  WHERE id = ?
`);
const checkDuplicateCoords = db.prepare(`
  SELECT COUNT(*) as count FROM readings WHERE project_id = ? AND latitude = ? AND longitude = ?
`);

// === Fish catches ===
const insertFishCatch = db.prepare(`
  INSERT INTO fish_catches (project_id, fish_type, weight, length, notes, latitude, longitude, accuracy, created_at)
  VALUES (@projectId, @fishType, @weight, @length, @notes, @latitude, @longitude, @accuracy, @createdAt)
`);
const getFishCatches = db.prepare(`
  SELECT id, fish_type as fishType, weight, length, notes, latitude, longitude, accuracy, created_at as createdAt
  FROM fish_catches WHERE project_id = ? ORDER BY created_at DESC
`);
const updateFishCatch = db.prepare(`
  UPDATE fish_catches SET fish_type = ?, weight = ?, length = ?, notes = ?, latitude = ?, longitude = ?
  WHERE id = ?
`);
const deleteFishCatch = db.prepare(`DELETE FROM fish_catches WHERE id = ?`);
const deleteProjectFishCatches = db.prepare(`DELETE FROM fish_catches WHERE project_id = ?`);

// === Transactions (declared after every statement they close over) ===
const insertMany = db.transaction((readings, projectId) => {
  let saved = 0;
  for (const r of readings) {
    const info = insertReading.run({
      projectId,
      depth: r.depth,
      latitude: r.coords?.latitude ?? r.latitude ?? null,
      longitude: r.coords?.longitude ?? r.longitude ?? null,
      accuracy: r.coords?.accuracy ?? r.accuracy ?? null,
      hasWeeds: r.hasWeeds ? 1 : 0,
      hasFish: r.hasFish ? 1 : 0,
      isShore: r.isShore ? 1 : 0,
      clientId: r.clientId || null,
      createdAt: r.createdAt
    });
    saved += info.changes;
  }
  return saved;
});

const deleteProjectWithReadings = db.transaction((projectId) => {
  deleteProjectReadings.run(projectId);
  deleteProjectFishCatches.run(projectId);
  deleteProject.run(projectId);
});

module.exports = {
  db,
  DB_PATH,
  insertProject,
  getAllProjects,
  getProjectById,
  updateProjectOffset,
  deleteProjectWithReadings,
  insertMany,
  getReadings,
  getShoreReadings,
  getReadingsCount,
  deleteProjectReadings,
  deleteReading,
  updateReading,
  checkDuplicateCoords,
  insertFishCatch,
  getFishCatches,
  updateFishCatch,
  deleteFishCatch
};
