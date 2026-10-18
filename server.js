/**
 * KrishiSathi — main server file
 * ---------------------------------------------------------------
 * Express is the ONLY framework used in this project (backend only).
 * What it does here: serves the static frontend (public/ folder) and
 * maps URL paths starting with /api/ to the route files in src/routes/.
 * Everything else in the project is plain vanilla Node.js / JavaScript.
 */
require('dotenv').config();

const path = require('path');
const express = require('express');

const app = express();

// Allow JSON bodies up to 8 MB (large enough for a base64-encoded photo)
app.use(express.json({ limit: '8mb' }));

// ── API routes ────────────────────────────────────────────────
app.use('/api/chat', require('./src/routes/chat'));
app.use('/api/diagnose', require('./src/routes/diagnose'));
app.use('/api/mandi', require('./src/routes/mandi'));
app.use('/api/weather', require('./src/routes/weather'));
app.use('/api/voice', require('./src/routes/voice'));
app.use('/api/summarise', require('./src/routes/summarise'));

// Health check — useful to confirm the server is running
app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'KrishiSathi API', time: new Date().toISOString() });
});

// ── Static frontend ───────────────────────────────────────────
// Serves public/index.html at http://localhost:3000
app.use(express.static(path.join(__dirname, 'public')));

// Any unknown non-API path → send the SPA (so refresh works)
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Central error handler — keeps the API from crashing on one bad request
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.publicMessage || 'Something went wrong. Please try again.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🌿 KrishiSathi backend running at http://localhost:${PORT}\n`);
  if (!process.env.GROQ_API_KEY) console.warn('⚠ GROQ_API_KEY not set — AI chat & diagnosis will not work yet. Copy .env.example to .env and fill it in.\n');
});
