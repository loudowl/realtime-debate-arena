const { spawn } = require('child_process');

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2; // s16le

function errText(err) {
  if (!err) return 'unknown error';
  return err.message || err.code || String(err);
}

// When a child fails to spawn (ENOENT) or dies, Node destroys its stdio streams
// with that error. Any stream with listeners but no 'error' handler would then
// throw and crash the process, so attach noop handlers to every stdio stream.
function silenceStdioErrors(child) {
  [child.stdin, child.stdout, child.stderr].forEach((stream) => {
    if (stream) stream.on('error', () => {});
  });
}

function isSimulation() {
  // Default to simulation unless explicitly disabled, so the pipeline runs
  // end-to-end with zero external binaries or API keys.
  return process.env.OBSERVER_SIMULATION !== 'false';
}

function windowSeconds() {
  const n = parseInt(process.env.OBSERVER_WINDOW_SECONDS || '5', 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/**
 * Drive a livestream into fixed-length audio windows.
 *
 * onWindow receives { pcm, startTs, endTs, index }. In simulation mode `pcm`
 * is null (the transcription layer produces synthetic text). On the real path
 * `pcm` is a raw 16kHz mono s16le Buffer.
 *
 * Returns a handle with stop().
 */
function createIngestion(session, onWindow, onError) {
  const winSecs = windowSeconds();

  if (isSimulation()) {
    return startSimulated(onWindow, winSecs);
  }
  return startReal(session, onWindow, winSecs, onError);
}

function startSimulated(onWindow, winSecs) {
  let index = 0;
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) return;
    const startTs = index * winSecs;
    onWindow({
      pcm: null,
      startTs,
      endTs: startTs + winSecs,
      index,
    }).catch((err) => console.warn('[ingestion:sim] onWindow error:', err.message));
    index += 1;
  }, winSecs * 1000);

  return {
    mode: 'simulation',
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

function buildSourceProcess(session, onSpawnError) {
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
  const ffmpegArgs = [
    '-loglevel', 'error',
    '-i', 'pipe:0',
    '-vn',
    '-ac', '1',
    '-ar', String(SAMPLE_RATE),
    '-f', 's16le',
    'pipe:1',
  ];

  // Platforms that need yt-dlp to resolve the actual media stream.
  const needsYtdlp = ['youtube', 'twitch', 'x'].includes(session.platform);

  if (needsYtdlp) {
    const ytdlp = spawn(ytdlpPath, ['-q', '-o', '-', session.sourceUrl]);
    const ffmpeg = spawn(ffmpegPath, ffmpegArgs);
    // Swallow stdio stream errors on both children (a missing/dead binary tears
    // down its pipes) so the failure surfaces once via the 'error' event below
    // instead of crashing the process with an unhandled stream error.
    silenceStdioErrors(ytdlp);
    silenceStdioErrors(ffmpeg);
    ytdlp.stdout.pipe(ffmpeg.stdin);
    ytdlp.on('error', (err) => onSpawnError('yt-dlp', err));
    ffmpeg.on('error', (err) => onSpawnError('ffmpeg', err));
    return { primary: ffmpeg, helpers: [ytdlp] };
  }

  // Direct HLS / media URL: ffmpeg can read it itself.
  const directArgs = ['-loglevel', 'error', '-i', session.sourceUrl,
    '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'];
  const ffmpeg = spawn(ffmpegPath, directArgs);
  silenceStdioErrors(ffmpeg);
  ffmpeg.on('error', (err) => onSpawnError('ffmpeg', err));
  return { primary: ffmpeg, helpers: [] };
}

function startReal(session, onWindow, winSecs, onError) {
  const windowBytes = SAMPLE_RATE * BYTES_PER_SAMPLE * winSecs;
  let buffered = Buffer.alloc(0);
  let index = 0;
  let stopped = false;
  let failed = false;

  // Spawn failures (ENOENT) and runtime crashes arrive asynchronously on the
  // child 'error' event, so we report them through onError rather than throwing.
  const handleSpawnError = (binary, err) => {
    if (failed || stopped) return;
    failed = true;
    const reason = err && err.code === 'ENOENT'
      ? `Cannot start real ingestion: "${binary}" is not installed or not on PATH. `
        + 'Install ffmpeg and yt-dlp (e.g. "brew install ffmpeg yt-dlp"), set FFMPEG_PATH/YTDLP_PATH, '
        + 'or run with OBSERVER_SIMULATION=true.'
      : `Real ingestion failed in "${binary}": ${errText(err)}`;
    console.warn('[ingestion:real]', reason);
    if (typeof onError === 'function') onError(new Error(reason));
  };

  let proc;
  let helpers = [];
  try {
    const built = buildSourceProcess(session, handleSpawnError);
    proc = built.primary;
    helpers = built.helpers;
  } catch (err) {
    handleSpawnError('ffmpeg', err);
    return { mode: 'real', stop() { stopped = true; } };
  }

  proc.stdout.on('data', (chunk) => {
    if (stopped) return;
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= windowBytes) {
      const pcm = buffered.subarray(0, windowBytes);
      buffered = buffered.subarray(windowBytes);
      const startTs = index * winSecs;
      onWindow({ pcm, startTs, endTs: startTs + winSecs, index })
        .catch((err) => console.warn('[ingestion:real] onWindow error:', err.message));
      index += 1;
    }
  });

  return {
    mode: 'real',
    stop() {
      stopped = true;
      // Only signal children that actually spawned. Killing a child whose spawn
      // failed (pid === undefined) can signal the whole process group and take
      // the server down with it.
      [proc, ...helpers].forEach((child) => {
        try {
          if (child && child.pid && !child.killed) child.kill('SIGKILL');
        } catch (_) { /* noop */ }
      });
    },
  };
}

module.exports = { createIngestion, SAMPLE_RATE, BYTES_PER_SAMPLE };
