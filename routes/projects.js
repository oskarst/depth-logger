const express = require('express');
const {
  insertProject,
  getAllProjects,
  getProjectById,
  updateProjectOffset,
  deleteProjectWithReadings,
  getReadingsCount
} = require('../db');

const router = express.Router();

// List all projects
router.get('/', (req, res) => {
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
router.post('/', (req, res) => {
  const name = req.body?.name?.trim();
  if (!name) {
    return res.status(400).json({ ok: false, error: 'Project name required' });
  }
  try {
    const result = insertProject.run(name, Date.now());
    const project = getProjectById.get(result.lastInsertRowid);
    res.json({ ok: true, id: project.id, name: project.name, project: { ...project, readingsCount: 0 } });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ ok: false, error: 'Project name already exists' });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Update project water level offset
router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { waterLevelOffset } = req.body;
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid project id' });
  }
  const offset = Number(waterLevelOffset);
  if (!Number.isFinite(offset)) {
    return res.status(400).json({ ok: false, error: 'Invalid water level offset' });
  }
  try {
    updateProjectOffset.run(offset, id);
    res.json({ ok: true, waterLevelOffset: offset });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Delete project with all its readings and fish catches
router.delete('/:id', (req, res) => {
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

module.exports = router;
