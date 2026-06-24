/**
 * Moderator model registry + provider adapters.
 *
 * The product goal is to swap AI "moderators" (OpenAI, Anthropic, Grok, Gemini)
 * and run them in parallel against the same debate to compare how their biases
 * differ. This module exposes:
 *
 *   - MODELS:        the catalogue of selectable moderators
 *   - callModelJSON: best-effort structured call to a real provider
 *   - simulate*:     deterministic, provider-specific fallback analysis
 *
 * Every real call falls back to simulation on missing keys or any error, so the
 * full pipeline runs end-to-end with zero external dependencies (matching the
 * Observer Mode simulation philosophy in docs/OBSERVER_MODE.md).
 */

const METRICS = [
  'facticity',
  'evidence',
  'persuasiveness',
  'responsiveness',
  'coherence',
  'composure',
];

/**
 * Each moderator has a distinct "lens" — both a real system-prompt persona and
 * a simulation bias profile (metric weights + a per-speaker tilt + how skeptical
 * it is when issuing fact-check verdicts). The tilts are intentionally different
 * so the comparison view shows divergent conclusions out of the box.
 */
const MODELS = {
  openai: {
    id: 'openai',
    label: 'OpenAI GPT-4o',
    provider: 'openai',
    defaultModel: 'gpt-4o',
    envKey: 'OPENAI_API_KEY',
    persona:
      'You are a balanced, evidence-first debate analyst. You weigh verifiable claims and data above rhetoric and avoid partisan framing.',
    weights: { facticity: 1.2, evidence: 1.2, persuasiveness: 1, responsiveness: 1, coherence: 1, composure: 0.9 },
    tilt: { 'Speaker A': 0, 'Speaker B': 0 },
    skepticism: 0.5,
    drawMargin: 0.04,
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    provider: 'anthropic',
    defaultModel: 'claude-3-5-sonnet-latest',
    envKey: 'ANTHROPIC_API_KEY',
    persona:
      'You are a careful, harm-aware debate analyst. You foreground uncertainty, reward intellectual honesty and composure, and are reluctant to declare a decisive winner when the margin is small.',
    weights: { facticity: 1.1, evidence: 1, persuasiveness: 0.9, responsiveness: 1, coherence: 1.2, composure: 1.2 },
    tilt: { 'Speaker A': 0, 'Speaker B': 0.02 },
    skepticism: 0.65,
    drawMargin: 0.09,
  },
  grok: {
    id: 'grok',
    label: 'xAI Grok',
    provider: 'grok',
    defaultModel: 'grok-2-latest',
    envKey: 'XAI_API_KEY',
    persona:
      'You are a contrarian, anti-establishment debate analyst. You are skeptical of received wisdom and institutional consensus, and you reward the side that challenges the status quo with punchy, persuasive arguments.',
    weights: { facticity: 0.9, evidence: 0.9, persuasiveness: 1.3, responsiveness: 1.1, coherence: 1, composure: 0.8 },
    tilt: { 'Speaker A': 0, 'Speaker B': 0.06 },
    skepticism: 0.75,
    drawMargin: 0.03,
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    provider: 'gemini',
    defaultModel: 'gemini-1.5-pro',
    envKey: 'GOOGLE_API_KEY',
    persona:
      'You are a structured, data-driven debate analyst. You reward well-organized arguments backed by concrete figures, sources, and quantified reasoning.',
    weights: { facticity: 1.3, evidence: 1.3, persuasiveness: 1, responsiveness: 0.9, coherence: 1.1, composure: 1 },
    tilt: { 'Speaker A': 0.05, 'Speaker B': 0 },
    skepticism: 0.4,
    drawMargin: 0.04,
  },
};

function listModels() {
  return Object.values(MODELS).map((m) => ({
    id: m.id,
    label: m.label,
    provider: m.provider,
    persona: m.persona,
    hasKey: Boolean(process.env[m.envKey]),
  }));
}

function getModel(id) {
  return MODELS[id] || null;
}

function moderationEnabled() {
  // When false (default), always use the deterministic simulation personas.
  return process.env.MODERATOR_SIMULATION === 'false';
}

// --- text heuristics shared by the simulation path -------------------------

const DIGIT_RE = /\b\d+(?:\.\d+)?\b/;
// Spelled-out numbers + quantitative units, since transcripts (and our
// simulated debate) often phrase figures as words ("seventy percent", "a decade").
const NUMBER_WORD_RE = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion)\b/i;
const UNIT_RE = /\b(percent|%|gigawatt|megawatt|terawatt|watt|megawatt-hour|kwh|mwh|decades?|years?|tons?|dollars?|times)\b/i;
const NAMED_ENTITY_RE = /\b([A-Z][a-z]+(?: [A-Z][a-z]+)*)\b/;
const REBUTTAL_RE = /\b(but|however|even granting|that said|respond|contrary|in fact|actually|wrong)\b/i;
const HEDGE_RE = /\b(maybe|might|could|possibly|seems|arguably)\b/i;

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/** True when an utterance contains a checkable quantity, figure, or unit. */
function hasQuantity(text) {
  const t = text || '';
  return DIGIT_RE.test(t) || NUMBER_WORD_RE.test(t) || UNIT_RE.test(t);
}

/** Score a single utterance into 0..1 metric contributions. */
function scoreUtterance(text) {
  const t = text || '';
  const hasNumber = hasQuantity(t);
  const hasEntity = NAMED_ENTITY_RE.test(t.replace(/^\W+/, ''));
  const rebuts = REBUTTAL_RE.test(t);
  const hedges = HEDGE_RE.test(t);
  const words = t.split(/\s+/).filter(Boolean).length;

  return {
    facticity: clamp01(0.45 + (hasNumber ? 0.35 : 0) + (hasEntity ? 0.12 : 0) - (hedges ? 0.1 : 0)),
    evidence: clamp01(0.4 + (hasNumber ? 0.4 : 0) + (hasEntity ? 0.15 : 0)),
    persuasiveness: clamp01(0.45 + Math.min(0.35, words / 60) + (rebuts ? 0.08 : 0)),
    responsiveness: clamp01(0.4 + (rebuts ? 0.4 : 0.05)),
    coherence: clamp01(0.72 - (hedges ? 0.08 : 0) + Math.min(0.15, words / 80)),
    composure: clamp01(0.8 - (/[!?]{2,}|\b(stupid|liar|idiot|ridiculous)\b/i.test(t) ? 0.4 : 0)),
  };
}

function isCheckworthy(text) {
  return hasQuantity(text);
}

/**
 * Produce a provider-specific fact-check verdict for a check-worthy claim.
 * More skeptical models lean toward "misleading"/"unverifiable".
 */
function simulateVerdict(model, claimText, seed) {
  const r = ((hashString(claimText) % 100) / 100 + seed) % 1;
  const s = model.skepticism;
  let verdict;
  let confidence;
  if (r > 0.55 + (s - 0.5)) {
    verdict = 'true';
    confidence = 0.7 + r * 0.25;
  } else if (r > 0.3) {
    verdict = 'misleading';
    confidence = 0.55 + r * 0.3;
  } else if (r > 0.12) {
    verdict = 'unverifiable';
    confidence = 0.4 + r * 0.3;
  } else {
    verdict = 'false';
    confidence = 0.6 + r * 0.3;
  }
  return { verdict, confidence: Math.round(clamp01(confidence) * 100) / 100 };
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < (str || '').length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function weightedTotal(model, metrics, speaker) {
  let sum = 0;
  let wsum = 0;
  for (const m of METRICS) {
    const w = model.weights[m] ?? 1;
    sum += (metrics[m] ?? 0) * w;
    wsum += w;
  }
  const base = wsum ? sum / wsum : 0;
  return clamp01(base + (model.tilt[speaker] || 0));
}

// --- real provider call (best effort, JSON out) ----------------------------

/**
 * Ask a real model to return strict JSON. Returns the parsed object or null on
 * any failure (missing key, network, parse) so callers can fall back to sim.
 */
async function callModelJSON(modelId, systemPrompt, userPrompt) {
  const model = getModel(modelId);
  if (!model || !moderationEnabled()) return null;
  const key = process.env[model.envKey];
  if (!key) return null;

  try {
    if (model.provider === 'openai' || model.provider === 'grok') {
      return await callOpenAICompatible(model, key, systemPrompt, userPrompt);
    }
    if (model.provider === 'anthropic') {
      return await callAnthropic(model, key, systemPrompt, userPrompt);
    }
    if (model.provider === 'gemini') {
      return await callGemini(model, key, systemPrompt, userPrompt);
    }
  } catch (err) {
    console.warn(`[moderators] ${modelId} call failed, using simulation:`, err.message);
  }
  return null;
}

function extractJSON(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (_) {
    return null;
  }
}

async function callOpenAICompatible(model, key, systemPrompt, userPrompt) {
  const OpenAI = require('openai');
  const baseURL = model.provider === 'grok' ? (process.env.XAI_BASE_URL || 'https://api.x.ai/v1') : undefined;
  const client = new OpenAI({ apiKey: key, baseURL });
  const res = await client.chat.completions.create({
    model: process.env[`${model.id.toUpperCase()}_MODEL`] || model.defaultModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.4,
    response_format: { type: 'json_object' },
  });
  return extractJSON(res.choices?.[0]?.message?.content);
}

async function callAnthropic(model, key, systemPrompt, userPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || model.defaultModel,
      max_tokens: 1024,
      system: `${systemPrompt}\nRespond ONLY with a single JSON object.`,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = await res.json();
  return extractJSON(data.content?.[0]?.text);
}

async function callGemini(model, key, systemPrompt, userPrompt) {
  const name = process.env.GEMINI_MODEL || model.defaultModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${systemPrompt}\nRespond ONLY with a single JSON object.` }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const data = await res.json();
  return extractJSON(data.candidates?.[0]?.content?.parts?.[0]?.text);
}

module.exports = {
  METRICS,
  MODELS,
  listModels,
  getModel,
  moderationEnabled,
  scoreUtterance,
  isCheckworthy,
  simulateVerdict,
  weightedTotal,
  clamp01,
  hashString,
  callModelJSON,
};
