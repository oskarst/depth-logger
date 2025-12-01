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
    has_fish INTEGER DEFAULT 0,
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
const getAllProjects = db.prepare(`SELECT id, name, created_at as createdAt FROM projects ORDER BY name`);
const getProjectById = db.prepare(`SELECT id, name FROM projects WHERE id = ?`);

// Prepared statements - Readings
const insertReading = db.prepare(`
  INSERT INTO readings (project_id, depth, latitude, longitude, accuracy, has_fish, created_at)
  VALUES (@projectId, @depth, @latitude, @longitude, @accuracy, @hasFish, @createdAt)
`);

const insertMany = db.transaction((readings, projectId) => {
  for (const r of readings) {
    insertReading.run({
      projectId,
      depth: r.depth,
      latitude: r.coords?.latitude || null,
      longitude: r.coords?.longitude || null,
      accuracy: r.coords?.accuracy || null,
      hasFish: r.hasFish ? 1 : 0,
      createdAt: r.createdAt
    });
  }
});

const getReadings = db.prepare(`
  SELECT id, depth, latitude, longitude, accuracy, has_fish as hasFish, created_at as createdAt
  FROM readings WHERE project_id = ? ORDER BY created_at DESC
`);

const getReadingsCount = db.prepare(`SELECT COUNT(*) as count FROM readings WHERE project_id = ?`);

const deleteProjectWithReadings = db.transaction((projectId) => {
  deleteProjectReadings.run(projectId);
  deleteProject.run(projectId);
});

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
      hasFish: r.hasFish || r.has_fish || false,
      createdAt: r.createdAt || r.created_at || Date.now()
    }));

    insertMany(normalized, projectId);
    res.json({ ok: true, imported: normalized.length });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log('Lake Logger running on http://localhost:' + PORT));
