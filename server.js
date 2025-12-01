const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 4567;

// Initialize database
const db = new Database(path.join(__dirname, 'lake-logger.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT DEFAULT 'default',
    depth REAL NOT NULL,
    latitude REAL,
    longitude REAL,
    accuracy REAL,
    has_fish INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_project ON readings(project)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_created ON readings(created_at)`);

// Prepared statements
const insertReading = db.prepare(`
  INSERT INTO readings (project, depth, latitude, longitude, accuracy, has_fish, created_at)
  VALUES (@project, @depth, @latitude, @longitude, @accuracy, @hasFish, @createdAt)
`);

const insertMany = db.transaction((readings, project) => {
  for (const r of readings) {
    insertReading.run({
      project,
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
  FROM readings WHERE project = ? ORDER BY created_at DESC
`);

const getProjects = db.prepare(`SELECT DISTINCT project FROM readings ORDER BY project`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sync readings from client
app.post('/api/sync', (req, res) => {
  const readings = req.body?.readings || [];
  const project = req.body?.project || 'default';
  if (!readings.length) {
    return res.json({ ok: true, saved: 0 });
  }
  try {
    insertMany(readings, project);
    res.json({ ok: true, saved: readings.length });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get readings for a project
app.get('/api/readings', (req, res) => {
  const project = req.query.project || 'default';
  try {
    const rows = getReadings.all(project);
    res.json({ ok: true, readings: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// List projects
app.get('/api/projects', (req, res) => {
  try {
    const rows = getProjects.all();
    res.json({ ok: true, projects: rows.map(r => r.project) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log('Lake Logger running on http://localhost:' + PORT));
