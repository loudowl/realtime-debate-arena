const express = require('express');
const router = express.Router();
const store = require('../services/sessionStore');
const worker = require('../services/streamAnalysisWorker');
const { listModels, getModel } = require('../services/moderators');

// Catalogue of selectable moderator models (for the frontend picker).
router.get('/models', (req, res) => {
  res.json({ models: listModels() });
});

// Create a session from a livestream URL and start analysis.
router.post('/', async (req, res) => {
  const { url, models, declareWinner, identify } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A livestream "url" string is required.' });
  }
  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  // Validate requested moderator models; default to all if none provided.
  const requested = Array.isArray(models) && models.length
    ? models
    : ['openai', 'anthropic', 'grok', 'gemini'];
  const valid = requested.filter((m) => getModel(m));
  if (!valid.length) {
    return res.status(400).json({ error: 'No valid moderator models selected.' });
  }

  const session = await store.createSession(url, {
    models: valid,
    declareWinner: declareWinner !== false,
    identify: identify === 'descriptor' ? 'descriptor' : 'auto',
  });
  worker.start(session);
  res.status(201).json({ session });
});

// List sessions.
router.get('/', (req, res) => {
  res.json({ sessions: store.listSessions() });
});

// Session status + metadata.
router.get('/:id', (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  res.json({ session });
});

// Stored transcript segments.
router.get('/:id/transcript', (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  res.json({ sessionId: session.id, segments: store.getSegments(session.id) });
});

// Compiled final reports (all models, or one via ?model=).
router.get('/:id/report', (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  if (req.query.model) {
    const report = store.getReport(session.id, req.query.model);
    if (!report) return res.status(404).json({ error: 'Report not ready for this model.' });
    return res.json({ report });
  }
  res.json({ sessionId: session.id, reports: store.getReports(session.id) });
});

// Stop analysis.
router.post('/:id/stop', (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  worker.stop(session.id);
  res.json({ session: store.getSession(session.id) });
});

module.exports = router;
