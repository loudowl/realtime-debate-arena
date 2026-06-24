const store = require('./sessionStore');
const { createIngestion } = require('./streamIngestion');
const { transcribeWindow } = require('./transcription');
const { createAnalyzer } = require('./moderatorEngine');
const { createIdentityResolver } = require('./speakerIdentity');

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

  // Spin up one analyzer per selected moderator model; they run in parallel
  // against the same transcript so their conclusions can be compared.
  const analyzers = (session.models || [])
    .map((modelId) => {
      try {
        return createAnalyzer(session, modelId, { declareWinner: session.declareWinner });
      } catch (err) {
        console.warn(`[worker] skipping analyzer ${modelId}:`, err.message);
        return null;
      }
    })
    .filter(Boolean);

  // One identity resolver per session, shared across all moderators.
  const resolver = createIdentityResolver(session);

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
    const record = await store.addSegment(session.id, segment);
    // Resolve speaker names from this turn before/alongside moderation.
    try { resolver.observe(record); } catch (err) {
      console.warn('[worker] identity observe error:', err.message);
    }
    // Feed every moderator the new segment (fire-and-forget, isolated failures).
    await Promise.all(
      analyzers.map((a) => a.observe(record).catch((err) =>
        console.warn(`[worker] analyzer ${a.modelId} observe error:`, err.message)
      ))
    );
  };

  const onIngestError = (err) => failWith(session.id, err.message);
  const ingestion = createIngestion(session, onWindow, onIngestError);
  activeJobs.set(session.id, { ingestion, analyzers, resolver, stopping: false });

  // Surface whether we're ingesting real audio or running the built-in sample,
  // so the UI can make that unmistakable to the user.
  session.mode = ingestion.mode;
  store.emit(session.id, 'session', session);

  console.log(`[worker] session ${session.id} started (${ingestion.mode}) for ${session.sourceUrl} with [${analyzers.map((a) => a.modelId).join(', ') || 'no models'}]`);
}

function finish(sessionId, status) {
  const job = activeJobs.get(sessionId);
  if (!job || job.stopping) return;
  job.stopping = true;
  try { job.ingestion.stop(); } catch (_) { /* noop */ }
  const analyzers = job.analyzers || [];
  const resolver = job.resolver;
  activeJobs.delete(sessionId);

  // Resolve final speaker names first (so reports carry them), then compile each
  // moderator's final report, then mark the session done.
  const finalizeAll = async () => {
    if (resolver) {
      try { await resolver.finalize(); } catch (err) {
        console.warn('[worker] identity finalize error:', err.message);
      }
    }
    await Promise.all(
      analyzers.map((a) => a.finalize().catch((err) =>
        console.warn(`[worker] analyzer ${a.modelId} finalize error:`, err.message)
      ))
    );
  };

  finalizeAll().finally(() => {
    store.updateStatus(sessionId, status);
    console.log(`[worker] session ${sessionId} ${status}`);
  });
}

function stop(sessionId) {
  finish(sessionId, 'stopped');
}

/**
 * Abort a session with a user-facing reason (e.g. missing ffmpeg/yt-dlp). Tears
 * down ingestion and marks the session 'failed' so the UI can show the cause,
 * rather than leaving it hanging in 'live' with no transcript.
 */
function failWith(sessionId, reason) {
  const job = activeJobs.get(sessionId);
  if (job) {
    if (job.stopping) return;
    job.stopping = true;
    try { job.ingestion.stop(); } catch (_) { /* noop */ }
    activeJobs.delete(sessionId);
  }
  store.updateStatus(sessionId, 'failed', { error: reason });
  console.warn(`[worker] session ${sessionId} failed: ${reason}`);
}

module.exports = { start, stop };
