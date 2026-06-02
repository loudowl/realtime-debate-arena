const { spawn } = require('child_process');

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2; // s16le

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
function createIngestion(session, onWindow) {
  const winSecs = windowSeconds();

  if (isSimulation()) {
    return startSimulated(onWindow, winSecs);
  }
  return startReal(session, onWindow, winSecs);
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

function buildSourceProcess(session) {
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
    ytdlp.stdout.pipe(ffmpeg.stdin);
    ytdlp.on('error', (err) => ffmpeg.emit('error', err));
    return { primary: ffmpeg, helpers: [ytdlp] };
  }

  // Direct HLS / media URL: ffmpeg can read it itself.
  const directArgs = ['-loglevel', 'error', '-i', session.sourceUrl,
    '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'];
  const ffmpeg = spawn(ffmpegPath, directArgs);
  return { primary: ffmpeg, helpers: [] };
}

function startReal(session, onWindow, winSecs) {
  const windowBytes = SAMPLE_RATE * BYTES_PER_SAMPLE * winSecs;
  let buffered = Buffer.alloc(0);
  let index = 0;
  let stopped = false;

  let proc;
  let helpers = [];
  try {
    const built = buildSourceProcess(session);
    proc = built.primary;
    helpers = built.helpers;
  } catch (err) {
    console.warn('[ingestion:real] failed to spawn, falling back to simulation:', err.message);
    return startSimulated(onWindow, winSecs);
  }

  proc.on('error', (err) => {
    console.warn('[ingestion:real] process error:', err.message);
  });

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
      try { proc.kill('SIGKILL'); } catch (_) { /* noop */ }
      helpers.forEach((h) => { try { h.kill('SIGKILL'); } catch (_) { /* noop */ } });
    },
  };
}

module.exports = { createIngestion, SAMPLE_RATE, BYTES_PER_SAMPLE };
