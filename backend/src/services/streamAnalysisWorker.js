const store = require('./sessionStore');
const { createIngestion } = require('./streamIngestion');
const { transcribeWindow } = require('./transcription');

/**
 * Orchestrates a single Observer Mode session:
 *   ingest audio windows -> transcribe -> persist segment -> publish event.
 *
 * Phase 1 runs in-process. The same module can later be invoked by a BullMQ
 * worker process without changing its interface.
 */
const activeJobs = new Map();

function start(session) {
  if (activeJobs.has(session.id)) return;

  store.updateStatus(session.id, 'live');

  const onWindow = async (window) => {
    const job = activeJobs.get(session.id);
    if (!job || job.stopping) return;

    const segment = await transcribeWindow(window);

    // In simulation, a null result on a silent (pcm===null) window means the
    // scripted debate is over -> complete the session.
    if (!segment) {
      if (window.pcm === null) {
        finish(session.id, 'completed');
      }
      return;
    }
    await store.addSegment(session.id, segment);
  };

  const ingestion = createIngestion(session, onWindow);
  activeJobs.set(session.id, { ingestion, stopping: false });
  console.log(`[worker] session ${session.id} started (${ingestion.mode}) for ${session.sourceUrl}`);
}

function finish(sessionId, status) {
  const job = activeJobs.get(sessionId);
  if (!job || job.stopping) return;
  job.stopping = true;
  try { job.ingestion.stop(); } catch (_) { /* noop */ }
  activeJobs.delete(sessionId);
  store.updateStatus(sessionId, status);
  console.log(`[worker] session ${sessionId} ${status}`);
}

function stop(sessionId) {
  finish(sessionId, 'stopped');
}

module.exports = { start, stop };
