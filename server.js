const express = require('express');
const path = require('path');

const projectsRouter = require('./routes/projects');
const readingsRouter = require('./routes/readings');
const fishRouter = require('./routes/fish');

const app = express();
const PORT = process.env.PORT || 4567;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/projects', projectsRouter);
app.use('/api', readingsRouter);
app.use('/api', fishRouter);

app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Unknown endpoint' }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => console.log('Lake Logger running on http://localhost:' + PORT));
}

module.exports = app;
