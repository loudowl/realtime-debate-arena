const { SAMPLE_RATE, BYTES_PER_SAMPLE } = require('./streamIngestion');

let openaiClient = null;
function getOpenAI() {
  if (openaiClient) return openaiClient;
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openaiClient;
  } catch (err) {
    console.warn('[transcription] openai sdk unavailable:', err.message);
    return null;
  }
}

/**
 * Synthetic two-speaker debate used when no real audio/ASR is available.
 * Each line maps to one ingestion window so the live pipeline is demonstrable
 * with zero external dependencies.
 */
const SIMULATED_SCRIPT = [
  { speaker: 'Moderator', text: "Welcome. Tonight's resolution: nuclear power is essential to decarbonizing the grid. Speaker A, your opening." },
  { speaker: 'Speaker A', text: 'Nuclear provides reliable baseload power with near-zero operational carbon, and modern reactors have an exceptional safety record.' },
  { speaker: 'Speaker B', text: 'But nuclear is the most expensive source per megawatt-hour, and new plants routinely run a decade behind schedule.' },
  { speaker: 'Speaker A', text: 'France generates about seventy percent of its electricity from nuclear and has some of the lowest-carbon power in Europe.' },
  { speaker: 'Speaker B', text: 'Renewables plus storage are now cheaper and can be deployed far faster than any new reactor.' },
  { speaker: 'Moderator', text: 'Speaker A, how do you respond to the cost objection?' },
  { speaker: 'Speaker A', text: 'Levelized cost ignores the system value of firm, dispatchable power that does not depend on weather.' },
  { speaker: 'Speaker B', text: 'Waste storage remains unsolved after seventy years, and that is a cost we keep pushing onto future generations.' },
  { speaker: 'Speaker A', text: 'Spent fuel is a small, well-contained volume, and advanced reactors can actually consume existing waste.' },
  { speaker: 'Speaker B', text: 'Even granting that, the capital risk alone makes private investors walk away without massive public subsidy.' },
];

function pcmToWav(pcm) {
  const dataLength = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28); // byte rate
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32); // block align
  header.writeUInt16LE(8 * BYTES_PER_SAMPLE, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Transcribe a single audio window into a transcript segment.
 *
 * Returns { speaker, text, startTs, endTs } or null when the window yields no
 * usable speech. Diarization is a Phase 1.5 concern; the real path currently
 * assigns a placeholder speaker, while simulation carries explicit labels.
 */
async function transcribeWindow(window) {
  const { pcm, startTs, endTs, index } = window;

  if (pcm === null) {
    const line = SIMULATED_SCRIPT[index];
    if (!line) return null; // script exhausted -> signals end of stream
    return { speaker: line.speaker, text: line.text, startTs, endTs };
  }

  const client = getOpenAI();
  if (!client) {
    return { speaker: 'Speaker', text: '[audio received; no transcription provider configured]', startTs, endTs };
  }

  try {
    const wav = pcmToWav(pcm);
    const file = await OpenAIFile(client, wav, `window-${index}.wav`);
    const result = await client.audio.transcriptions.create({
      file,
      model: process.env.TRANSCRIPTION_MODEL || 'whisper-1',
    });
    const text = (result.text || '').trim();
    if (!text) return null;
    return { speaker: 'Speaker', text, startTs, endTs };
  } catch (err) {
    console.warn('[transcription] OpenAI transcription failed:', err.message);
    return null;
  }
}

async function OpenAIFile(client, buffer, filename) {
  // openai>=4 ships a `toFile` helper for turning buffers into uploadable files.
  const { toFile } = require('openai');
  return toFile(buffer, filename, { type: 'audio/wav' });
}

function simulatedScriptLength() {
  return SIMULATED_SCRIPT.length;
}

module.exports = { transcribeWindow, simulatedScriptLength };
