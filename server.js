const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 4567;

// Initialize database
const db = new Database(path.join(__dirname, 'lake-logger.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
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
    created_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id)
  )
`);

// Migration: add has_weeds column if missing and migrate data from has_fish
try {
  const cols = db.pragma('table_info(readings)').map(c => c.name);
  if (!cols.includes('has_weeds')) {
    db.exec(`ALTER TABLE readings ADD COLUMN has_weeds INTEGER DEFAULT 0`);
    // Migrate existing has_fish data to has_weeds (old fish was actually weeds)
    db.exec(`UPDATE readings SET has_weeds = has_fish, has_fish = 0`);
  }
  // Add is_shore column for shore line markers
  if (!cols.includes('is_shore')) {
    db.exec(`ALTER TABLE readings ADD COLUMN is_shore INTEGER DEFAULT 0`);
  }
} catch (e) {
  console.log('Migration check:', e.message);
}

// Migration: add water_level_offset to projects
try {
  const projCols = db.pragma('table_info(projects)').map(c => c.name);
  if (!projCols.includes('water_level_offset')) {
    db.exec(`ALTER TABLE projects ADD COLUMN water_level_offset REAL DEFAULT 0`);
  }
} catch (e) {
  console.log('Projects migration check:', e.message);
}

// Fish catches table
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

db.exec(`CREATE INDEX IF NOT EXISTS idx_project_id ON readings(project_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_created ON readings(created_at)`);

// Prepared statements - Projects
const insertProject = db.prepare(`INSERT INTO projects (name, created_at) VALUES (?, ?)`);
const deleteProject = db.prepare(`DELETE FROM projects WHERE id = ?`);
const deleteProjectReadings = db.prepare(`DELETE FROM readings WHERE project_id = ?`);
const getAllProjects = db.prepare(`SELECT id, name, created_at as createdAt, water_level_offset as waterLevelOffset FROM projects ORDER BY name`);
const getProjectById = db.prepare(`SELECT id, name, water_level_offset as waterLevelOffset FROM projects WHERE id = ?`);
const updateProjectOffset = db.prepare(`UPDATE projects SET water_level_offset = ? WHERE id = ?`);

// Prepared statements - Readings
const insertReading = db.prepare(`
  INSERT INTO readings (project_id, depth, latitude, longitude, accuracy, has_weeds, has_fish, is_shore, created_at)
  VALUES (@projectId, @depth, @latitude, @longitude, @accuracy, @hasWeeds, @hasFish, @isShore, @createdAt)
`);

const insertMany = db.transaction((readings, projectId) => {
  for (const r of readings) {
    insertReading.run({
      projectId,
      depth: r.depth,
      latitude: r.coords?.latitude || null,
      longitude: r.coords?.longitude || null,
      accuracy: r.coords?.accuracy || null,
      hasWeeds: r.hasWeeds ? 1 : 0,
      hasFish: r.hasFish ? 1 : 0,
      isShore: r.isShore ? 1 : 0,
      createdAt: r.createdAt
    });
  }
});

const getReadings = db.prepare(`
  SELECT id, depth, latitude, longitude, accuracy, has_weeds as hasWeeds, has_fish as hasFish, is_shore as isShore, created_at as createdAt
  FROM readings WHERE project_id = ? ORDER BY created_at DESC
`);

const getShoreReadings = db.prepare(`
  SELECT id, depth, latitude, longitude, created_at as createdAt
  FROM readings WHERE project_id = ? AND is_shore = 1 ORDER BY created_at DESC
`);

const getReadingsCount = db.prepare(`SELECT COUNT(*) as count FROM readings WHERE project_id = ?`);

const deleteProjectWithReadings = db.transaction((projectId) => {
  deleteProjectReadings.run(projectId);
  deleteProjectFishCatches.run(projectId);
  deleteProject.run(projectId);
});

const clearProjectReadings = db.prepare(`DELETE FROM readings WHERE project_id = ?`);
const deleteReading = db.prepare(`DELETE FROM readings WHERE id = ?`);
const updateReading = db.prepare(`UPDATE readings SET depth = ?, has_weeds = ?, has_fish = ?, is_shore = ?, latitude = ?, longitude = ? WHERE id = ?`);
const checkDuplicateCoords = db.prepare(`SELECT COUNT(*) as count FROM readings WHERE project_id = ? AND latitude = ? AND longitude = ?`);

// Prepared statements - Fish catches
const insertFishCatch = db.prepare(`
  INSERT INTO fish_catches (project_id, fish_type, weight, length, notes, latitude, longitude, accuracy, created_at)
  VALUES (@projectId, @fishType, @weight, @length, @notes, @latitude, @longitude, @accuracy, @createdAt)
`);
const getFishCatches = db.prepare(`
  SELECT id, fish_type as fishType, weight, length, notes, latitude, longitude, accuracy, created_at as createdAt
  FROM fish_catches WHERE project_id = ? ORDER BY created_at DESC
`);
const getFishCatchesCount = db.prepare(`SELECT COUNT(*) as count FROM fish_catches WHERE project_id = ?`);
const updateFishCatch = db.prepare(`UPDATE fish_catches SET fish_type = ?, weight = ?, length = ?, notes = ?, latitude = ?, longitude = ? WHERE id = ?`);
const deleteFishCatch = db.prepare(`DELETE FROM fish_catches WHERE id = ?`);
const deleteProjectFishCatches = db.prepare(`DELETE FROM fish_catches WHERE project_id = ?`);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// === Project endpoints ===

// List all projects
app.get('/api/projects', (req, res) => {
  try {
    const projects = getAllProjects.all().map(p => ({
      ...p,
      readingsCount: getReadingsCount.get(p.id).count
    }));
    res.json({ ok: true, projects });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Create project
app.post('/api/projects', (req, res) => {
  const name = req.body?.name?.trim();
  if (!name) {
    return res.status(400).json({ ok: false, error: 'Project name required' });
  }
  try {
    const result = insertProject.run(name, Date.now());
    res.json({ ok: true, id: result.lastInsertRowid, name });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ ok: false, error: 'Project name already exists' });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Delete project
app.delete('/api/projects/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }
  try {
    deleteProjectWithReadings(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === Readings endpoints ===

// Sync readings from client
app.post('/api/projects/:id/sync', (req, res) => {
  const projectId = parseInt(req.params.id);
  const readings = req.body?.readings || [];
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }
  if (!readings.length) {
    return res.json({ ok: true, saved: 0 });
  }
  try {
    insertMany(readings, projectId);
    res.json({ ok: true, saved: readings.length });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get readings for a project
app.get('/api/projects/:id/readings', (req, res) => {
  const projectId = parseInt(req.params.id);
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }
  try {
    const rows = getReadings.all(projectId);
    res.json({ ok: true, readings: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Clear all readings for a project
app.delete('/api/projects/:id/readings', (req, res) => {
  const projectId = parseInt(req.params.id);
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }
  try {
    const result = clearProjectReadings.run(projectId);
    res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Delete single reading
app.delete('/api/readings/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid reading id' });
  }
  try {
    deleteReading.run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Update single reading
app.patch('/api/readings/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { depth, hasWeeds, hasFish, isShore, latitude, longitude } = req.body;
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid reading id' });
  }
  try {
    updateReading.run(depth, hasWeeds ? 1 : 0, hasFish ? 1 : 0, isShore ? 1 : 0, latitude || null, longitude || null, id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Update project water level offset
app.patch('/api/projects/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { waterLevelOffset } = req.body;
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }
  try {
    updateProjectOffset.run(waterLevelOffset || 0, id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get shore line readings for a project
app.get('/api/projects/:id/shore', (req, res) => {
  const projectId = parseInt(req.params.id);
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }
  try {
    const rows = getShoreReadings.all(projectId);
    res.json({ ok: true, shores: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === Fish catches endpoints ===

// Get fish catches for a project
app.get('/api/projects/:id/fish', (req, res) => {
  const projectId = parseInt(req.params.id);
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }
  try {
    const rows = getFishCatches.all(projectId);
    res.json({ ok: true, catches: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Add fish catch
app.post('/api/projects/:id/fish', (req, res) => {
  const projectId = parseInt(req.params.id);
  const { fishType, weight, length, notes, latitude, longitude, accuracy } = req.body;
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }
  try {
    const result = insertFishCatch.run({
      projectId,
      fishType: fishType || null,
      weight: weight || null,
      length: length || null,
      notes: notes || null,
      latitude: latitude || null,
      longitude: longitude || null,
      accuracy: accuracy || null,
      createdAt: Date.now()
    });
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Update fish catch
app.patch('/api/fish/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { fishType, weight, length, notes, latitude, longitude } = req.body;
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid fish catch id' });
  }
  try {
    updateFishCatch.run(fishType || null, weight || null, length || null, notes || null, latitude || null, longitude || null, id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Delete fish catch
app.delete('/api/fish/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid fish catch id' });
  }
  try {
    deleteFishCatch.run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Import JSON data to a project
app.post('/api/projects/:id/import', (req, res) => {
  const projectId = parseInt(req.params.id);
  const readings = req.body?.readings || req.body;

  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }

  // Handle both array and {readings: [...]} format
  const data = Array.isArray(readings) ? readings : [];
  if (!data.length) {
    return res.status(400).json({ ok: false, error: 'No readings provided' });
  }

  try {
    // Transform data to match expected format
    const normalized = data.map(r => ({
      depth: r.depth,
      coords: r.coords || { latitude: r.latitude, longitude: r.longitude, accuracy: r.accuracy },
      hasWeeds: r.hasWeeds || r.has_weeds || r.hasFish || r.has_fish || false, // legacy: hasFish → hasWeeds
      hasFish: false, // Reset on import, caught fish handled separately
      createdAt: r.createdAt || r.created_at || Date.now()
    }));

    // Filter out duplicates (same coordinates already exist)
    const unique = normalized.filter(r => {
      if (!r.coords?.latitude || !r.coords?.longitude) return true; // Allow points without coords
      const exists = checkDuplicateCoords.get(projectId, r.coords.latitude, r.coords.longitude);
      return exists.count === 0;
    });

    const skipped = normalized.length - unique.length;
    if (unique.length > 0) {
      insertMany(unique, projectId);
    }
    res.json({ ok: true, imported: unique.length, skipped });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log('Lake Logger running on http://localhost:' + PORT));
