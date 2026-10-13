const express = require('express');
const {
  insertMany,
  getReadings,
  getShoreReadings,
  deleteProjectReadings,
  deleteReading,
  updateReading,
  checkDuplicateCoords
} = require('../db');

// Mounted at /api — paths below are absolute within that prefix.
const router = express.Router();

// Push queued readings from a client. Idempotent via each reading's clientId:
// re-sending a batch whose response was lost inserts nothing new.
router.post('/projects/:id/sync', (req, res) => {
  const projectId = parseInt(req.params.id);
  const readings = req.body?.readings || [];
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }
  if (!readings.length) {
    return res.json({ ok: true, saved: 0, duplicates: 0 });
  }
  try {
    const saved = insertMany(readings, projectId);
    res.json({ ok: true, saved, duplicates: readings.length - saved });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Readings for a project
router.get('/projects/:id/readings', (req, res) => {
  const projectId = parseInt(req.params.id);
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }
  try {
    res.json({ ok: true, readings: getReadings.all(projectId) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Clear every reading of one project
router.delete('/projects/:id/readings', (req, res) => {
  const projectId = parseInt(req.params.id);
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }
  try {
    const result = deleteProjectReadings.run(projectId);
    res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Shore-line readings of a project
router.get('/projects/:id/shore', (req, res) => {
  const projectId = parseInt(req.params.id);
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }
  try {
    res.json({ ok: true, shores: getShoreReadings.all(projectId) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Import a JSON export into a project, skipping coordinates already present
router.post('/projects/:id/import', (req, res) => {
  const projectId = parseInt(req.params.id);
  const payload = req.body?.readings || req.body;

  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }

  const data = Array.isArray(payload) ? payload : [];
  if (!data.length) {
    return res.status(400).json({ ok: false, error: 'No readings provided' });
  }

  try {
    const normalized = data.map(r => ({
      depth: r.depth,
      coords: r.coords || { latitude: r.latitude, longitude: r.longitude, accuracy: r.accuracy },
      // Legacy exports stored weeds in hasFish.
      hasWeeds: Boolean(r.hasWeeds || r.has_weeds || r.hasFish || r.has_fish),
      hasFish: false,
      isShore: Boolean(r.isShore || r.is_shore),
      createdAt: r.createdAt || r.created_at || Date.now()
    }));

    const unique = normalized.filter(r => {
      if (!r.coords?.latitude || !r.coords?.longitude) return true;
      return checkDuplicateCoords.get(projectId, r.coords.latitude, r.coords.longitude).count === 0;
    });

    const imported = unique.length ? insertMany(unique, projectId) : 0;
    res.json({ ok: true, imported, skipped: normalized.length - imported });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Update one reading
router.patch('/readings/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { depth, hasWeeds, hasFish, isShore, latitude, longitude } = req.body;
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid reading id' });
  }
  const depthValue = Number(depth);
  if (!Number.isFinite(depthValue)) {
    return res.status(400).json({ ok: false, error: 'Invalid depth' });
  }
  try {
    const result = updateReading.run(
      depthValue,
      hasWeeds ? 1 : 0,
      hasFish ? 1 : 0,
      isShore ? 1 : 0,
      latitude ?? null,
      longitude ?? null,
      id
    );
    if (!result.changes) {
      return res.status(404).json({ ok: false, error: 'Reading not found' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Delete one reading
router.delete('/readings/:id', (req, res) => {
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

module.exports = router;
