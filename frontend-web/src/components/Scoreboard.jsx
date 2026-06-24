const METRIC_LABELS = {
  facticity: 'Facticity',
  evidence: 'Evidence',
  persuasiveness: 'Persuasion',
  responsiveness: 'Responsiveness',
  coherence: 'Coherence',
  composure: 'Composure',
};

/** Compact per-speaker scoreboard with metric bars. */
export default function Scoreboard({ scores, names = {} }) {
  if (!scores) return <p className="muted small">Scoring will appear as the debate progresses…</p>;
  const speakers = Object.keys(scores);
  const metrics = Object.keys(METRIC_LABELS);
  const leader = speakers.reduce(
    (best, sp) => (scores[sp].total > (scores[best]?.total ?? -1) ? sp : best),
    speakers[0]
  );

  return (
    <div className="scoreboard">
      {speakers.map((sp) => (
        <div className={`score-card ${sp === leader ? 'leading' : ''}`} key={sp}>
          <div className="score-head">
            <span className="score-name">{names[sp] || sp}</span>
            <span className="score-total">{scores[sp].total?.toFixed(2)}</span>
          </div>
          <div className="metric-rows">
            {metrics.map((m) => (
              <div className="metric-row" key={m}>
                <span className="metric-name">{METRIC_LABELS[m]}</span>
                <span className="metric-bar">
                  <span className="metric-fill" style={{ width: `${(scores[sp][m] || 0) * 100}%` }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
