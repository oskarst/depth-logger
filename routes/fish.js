const express = require('express');
const { insertFishCatch, getFishCatches, updateFishCatch, deleteFishCatch } = require('../db');

// Mounted at /api
const router = express.Router();

router.get('/projects/:id/fish', (req, res) => {
  const projectId = parseInt(req.params.id);
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }
  try {
    res.json({ ok: true, catches: getFishCatches.all(projectId) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/projects/:id/fish', (req, res) => {
  const projectId = parseInt(req.params.id);
  const { fishType, weight, length, notes, latitude, longitude, accuracy } = req.body;
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }
  try {
    const result = insertFishCatch.run({
      projectId,
      fishType: fishType || null,
      weight: weight ?? null,
      length: length ?? null,
      notes: notes || null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      accuracy: accuracy ?? null,
      createdAt: Date.now()
    });
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch('/fish/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { fishType, weight, length, notes, latitude, longitude } = req.body;
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid fish catch id' });
  }
  try {
    const result = updateFishCatch.run(
      fishType || null,
      weight ?? null,
      length ?? null,
      notes || null,
      latitude ?? null,
      longitude ?? null,
      id
    );
    if (!result.changes) {
      return res.status(404).json({ ok: false, error: 'Fish catch not found' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/fish/:id', (req, res) => {
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

module.exports = router;
