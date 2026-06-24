const store = require('./sessionStore');
const mod = require('./moderators');

/**
 * Per-(session, model) analyzer.
 *
 * Driven by the stream worker: `observe(segment)` is called for each transcript
 * segment as it arrives, and `finalize()` is called when the debate ends. The
 * analyzer emits model-tagged live events (fact_check, commentary, score_update)
 * onto the session bus and stores a compiled final report.
 *
 * Each analyzer represents ONE moderator model. Running several in parallel for
 * the same session is how we compare how their biases diverge.
 */
function createAnalyzer(session, modelId, opts = {}) {
  const model = mod.getModel(modelId);
  if (!model) throw new Error(`Unknown moderator model: ${modelId}`);
  const declareWinner = opts.declareWinner !== false;

  // Rolling per-speaker accumulation of metric scores.
  const speakers = new Map(); // speaker -> { count, sums:{metric:total} }
  const factChecks = [];
  const commentary = [];
  let segmentCount = 0;

  function ensureSpeaker(name) {
    if (!speakers.has(name)) {
      const sums = {};
      mod.METRICS.forEach((m) => { sums[m] = 0; });
      speakers.set(name, { count: 0, sums });
    }
    return speakers.get(name);
  }

  function currentScorecard() {
    const card = {};
    for (const [name, acc] of speakers.entries()) {
      const metrics = {};
      mod.METRICS.forEach((m) => {
        metrics[m] = acc.count ? Math.round((acc.sums[m] / acc.count) * 100) / 100 : 0;
      });
      metrics.total = Math.round(mod.weightedTotal(model, metrics, name) * 100) / 100;
      card[name] = metrics;
    }
    return card;
  }

  async function observe(segment) {
    const speaker = segment.speaker || 'Unknown';
    // Skip the human moderator/host turns; we score the debaters only.
    if (/^moderator$|^host$/i.test(speaker)) return;

    segmentCount += 1;
    const acc = ensureSpeaker(speaker);
    const utter = mod.scoreUtterance(segment.text);
    mod.METRICS.forEach((m) => { acc.sums[m] += utter[m]; });
    acc.count += 1;

    // Fact-check check-worthy claims.
    if (mod.isCheckworthy(segment.text)) {
      const { verdict, confidence } = mod.simulateVerdict(model, segment.text, segmentCount / 50);
      const fc = {
        model: model.id,
        speaker,
        claim: segment.text,
        verdict,
        confidence,
        explanation: explmain(verdict, model),
        ts: segment.startTs,
      };
      factChecks.push(fc);
      store.emitModelEvent(session.id, { type: 'fact_check', data: fc });
    }

    // Occasional commentary (fallacy / rhetoric notes), persona-flavored.
    if (segmentCount % 3 === 0) {
      const note = {
        model: model.id,
        speaker,
        type: utter.responsiveness > 0.7 ? 'rebuttal' : 'assertion',
        text: commentFor(model, utter),
        ts: segment.startTs,
      };
      commentary.push(note);
      store.emitModelEvent(session.id, { type: 'commentary', data: note });
    }

    // Push a rolling scoreboard update.
    store.emitModelEvent(session.id, {
      type: 'score_update',
      data: { model: model.id, scores: currentScorecard() },
    });
  }

  async function finalize() {
    const scorecard = currentScorecard();
    const report = await buildReport({
      model,
      scorecard,
      factChecks,
      declareWinner,
      segments: store.getSegments(session.id),
      speakerNames: store.getIdentities(session.id),
    });
    store.saveReport(session.id, model.id, report);
    store.emitModelEvent(session.id, { type: 'report', data: report });
    return report;
  }

  return { modelId: model.id, observe, finalize };
}

// Persona-aware fact-check rationale.
function explmain(verdict, model) {
  const base = {
    true: 'Claim is consistent with available evidence.',
    misleading: 'Claim is partially accurate but omits material context.',
    unverifiable: 'Insufficient public evidence to confirm or refute.',
    false: 'Claim contradicts the available evidence.',
  }[verdict] || '';
  if (model.id === 'grok' && verdict === 'true') return `${base} (Still, worth pressure-testing the consensus.)`;
  if (model.id === 'anthropic') return `${base} Confidence is bounded; treat with appropriate uncertainty.`;
  return base;
}

function commentFor(model, utter) {
  if (utter.evidence > 0.75) return 'Strong, quantified evidence in this turn.';
  if (utter.responsiveness > 0.7) return 'Directly engages the opponent’s prior point.';
  if (utter.persuasiveness > 0.7) return 'Rhetorically effective but light on hard data.';
  if (model.id === 'anthropic') return 'Reasonable claim; note the residual uncertainty.';
  return 'General assertion; limited new evidence.';
}

/**
 * Compile the final analysis. Tries a real summarizing model call first; on any
 * failure falls back to a deterministic, persona-specific summary so a report is
 * always produced.
 */
async function buildReport({ model, scorecard, factChecks, declareWinner, segments, speakerNames }) {
  const names = Object.keys(scorecard);
  const ranked = names
    .map((n) => ({ name: n, total: scorecard[n].total }))
    .sort((a, b) => b.total - a.total);

  let winner = null;
  if (declareWinner && ranked.length >= 2) {
    const margin = ranked[0].total - ranked[1].total;
    winner = margin < model.drawMargin ? 'Draw' : ranked[0].name;
  } else if (declareWinner && ranked.length === 1) {
    winner = ranked[0].name;
  }

  const verdictCounts = factChecks.reduce((acc, fc) => {
    acc[fc.verdict] = (acc[fc.verdict] || 0) + 1;
    return acc;
  }, {});

  // Attempt a real LLM summary.
  const real = await tryRealSummary({ model, scorecard, factChecks, segments, declareWinner });

  const summary = real?.summary || deterministicSummary({ model, ranked, winner, verdictCounts, declareWinner });

  return {
    model: model.id,
    modelLabel: model.label,
    persona: model.persona,
    winner: real?.winner ?? winner,
    summary,
    scorecard,
    speakerNames: speakerNames || {},
    weights: model.weights,
    factCheckSummary: verdictCounts,
    factChecks,
    metrics: mod.METRICS,
    generatedAt: new Date().toISOString(),
  };
}

async function tryRealSummary({ model, scorecard, factChecks, segments, declareWinner }) {
  if (!mod.moderationEnabled()) return null;
  const transcript = segments.map((s) => `${s.speaker}: ${s.text}`).join('\n').slice(0, 8000);
  const system = `${model.persona} You are scoring a debate. ${declareWinner ? 'Declare a winner or "Draw".' : 'Do NOT declare a winner.'}`;
  const user = `Transcript:\n${transcript}\n\nRolling scorecard: ${JSON.stringify(scorecard)}\nFact-check verdicts: ${JSON.stringify(factChecks.map((f) => f.verdict))}\n\nReturn JSON: { "winner": string|null, "summary": string (3-5 sentence final analysis and conclusion) }`;
  const json = await mod.callModelJSON(model.id, system, user);
  if (json && typeof json.summary === 'string') {
    return { summary: json.summary, winner: declareWinner ? (json.winner ?? null) : null };
  }
  return null;
}

function deterministicSummary({ model, ranked, winner, verdictCounts, declareWinner }) {
  const lead = ranked[0];
  const trail = ranked[1];
  const parts = [];
  parts.push(`Through a ${describeLens(model)} lens, this analysis weighed ${Object.entries(model.weights).filter(([, w]) => w >= 1.2).map(([m]) => m).join(' and ') || 'all metrics evenly'} most heavily.`);
  if (lead && trail) {
    parts.push(`${lead.name} scored ${lead.total.toFixed(2)} against ${trail.name}'s ${trail.total.toFixed(2)} on the weighted rubric.`);
  } else if (lead) {
    parts.push(`${lead.name} scored ${lead.total.toFixed(2)} on the weighted rubric.`);
  }
  const fcTotal = Object.values(verdictCounts).reduce((a, b) => a + b, 0);
  if (fcTotal) {
    parts.push(`Of ${fcTotal} check-worthy claims, verdicts broke down as ${Object.entries(verdictCounts).map(([k, v]) => `${v} ${k}`).join(', ')}.`);
  }
  if (declareWinner) {
    parts.push(winner === 'Draw'
      ? 'The margin fell inside this moderator’s draw threshold, so no decisive winner is declared.'
      : `Conclusion: ${winner} is judged the stronger debater under this rubric.`);
  } else {
    parts.push('Per configuration, no winner is declared — only the comparative breakdown above.');
  }
  return parts.join(' ');
}

function describeLens(model) {
  return {
    openai: 'balanced, evidence-first',
    anthropic: 'cautious, uncertainty-aware',
    grok: 'contrarian, status-quo-challenging',
    gemini: 'structured, data-driven',
  }[model.id] || 'analytical';
}

module.exports = { createAnalyzer };
