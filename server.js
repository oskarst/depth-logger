const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 4567;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/sync', (req, res) => {
  res.json({ ok: true, received: (req.body && req.body.readings || []).length });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log('Lake Logger running on http://localhost:' + PORT));
