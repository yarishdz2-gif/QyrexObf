const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.disable('x-powered-by');

// Static UI
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true
}));

// Health (Render checks)
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'SuperObf Pro' });
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('SuperObf Pro listening on 0.0.0.0:' + PORT);
});
