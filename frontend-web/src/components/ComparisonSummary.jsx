/**
 * Cross-model comparison: shows each moderator's current call (final winner if
 * the report is in, otherwise the live leader) and flags when they disagree —
 * the whole point of running several biases in parallel.
 */
export default function ComparisonSummary({ models, modelState, modelLabel, names = {} }) {
  const calls = models.map((id) => {
    const st = modelState[id] || {};
    const report = st.report;
    const scores = report ? report.scorecard : st.scores;
    const nameMap = { ...names, ...(report?.speakerNames || {}) };
    const call = report ? report.winner : liveLeader(scores);
    return {
      id,
      label: modelLabel[id] || id,
      final: Boolean(report),
      call,
      callName: call && call !== 'Draw' ? (nameMap[call] || call) : call,
    };
  });

  const decided = calls.filter((c) => c.call && c.call !== 'Draw');
  const unique = [...new Set(decided.map((c) => c.call))];
  const verdict = !decided.length
    ? 'Awaiting scores…'
    : unique.length === 1
      ? `Consensus so far: ${decided[0].callName}`
      : 'Moderators disagree';

  return (
    <div className={`comparison ${unique.length > 1 ? 'split' : ''}`}>
      <div className="comparison-head">
        <span className="comparison-title">Model comparison</span>
        <span className={`comparison-verdict ${unique.length > 1 ? 'disagree' : 'agree'}`}>{verdict}</span>
      </div>
      <div className="comparison-row">
        {calls.map((c) => (
          <div className="comparison-cell" key={c.id}>
            <span className="model-chip-dot" data-model={c.id} />
            <span className="comparison-model">{c.label}</span>
            <span className={`comparison-call ${callClass(c.call)}`}>
              {c.callName || '—'}{c.final ? '' : ' (live)'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function liveLeader(scores) {
  if (!scores) return null;
  const names = Object.keys(scores);
  if (!names.length) return null;
  const sorted = names.sort((a, b) => (scores[b].total || 0) - (scores[a].total || 0));
  if (sorted.length >= 2 && Math.abs(scores[sorted[0]].total - scores[sorted[1]].total) < 0.02) return 'Draw';
  return sorted[0];
}

function callClass(call) {
  if (!call) return '';
  if (call === 'Draw') return 'call-draw';
  return 'call-win';
}
