import { useState } from 'react';
import Scoreboard from './Scoreboard.jsx';
import { exportReportPDF } from '../pdf.js';

const VERDICT_ICON = {
  true: '✓',
  misleading: '◑',
  unverifiable: '?',
  false: '✗',
};

/** One moderator's live + final analysis panel. */
export default function ModeratorColumn({ modelId, label, state, session, names = {}, status }) {
  const [tab, setTab] = useState('facts');
  const data = state || { factChecks: [], commentary: [], scores: null, report: null };
  const report = data.report;
  // Prefer names baked into the final report; fall back to live identities.
  const nameMap = { ...names, ...(report?.speakerNames || {}) };
  const display = (label2) => nameMap[label2] || label2;

  return (
    <div className="card moderator">
      <div className="moderator-head">
        <span className="model-chip-dot" data-model={modelId} />
        <h3>{label}</h3>
      </div>

      <Scoreboard scores={report ? report.scorecard : data.scores} names={nameMap} />

      {report && (
        <div className="final-report">
          <div className="verdict-banner">
            {report.winner
              ? (report.winner === 'Draw'
                ? <span className="verdict-draw">Draw</span>
                : <span className="verdict-win">Winner · {display(report.winner)}</span>)
              : <span className="verdict-none">No winner declared</span>}
          </div>
          <p className="report-summary">{report.summary}</p>
          <button className="btn btn-primary btn-sm" onClick={() => exportReportPDF(report, session)}>
            ⤓ Download PDF
          </button>
        </div>
      )}

      <div className="tabs">
        <button className={tab === 'facts' ? 'on' : ''} onClick={() => setTab('facts')}>
          Fact-checks ({data.factChecks.length})
        </button>
        <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>
          Commentary ({data.commentary.length})
        </button>
      </div>

      <div className="feed">
        {tab === 'facts' && (
          data.factChecks.length === 0
            ? <p className="muted small">{status === 'live' ? 'Listening for check-worthy claims…' : 'No claims flagged.'}</p>
            : [...data.factChecks].reverse().map((fc, i) => (
              <div className={`fact verdict-${fc.verdict}`} key={i}>
                <div className="fact-head">
                  <span className="fact-icon">{VERDICT_ICON[fc.verdict] || '•'}</span>
                  <span className="fact-verdict">{fc.verdict}</span>
                  <span className="fact-conf">{Math.round((fc.confidence || 0) * 100)}%</span>
                  <span className="fact-speaker">{display(fc.speaker)}</span>
                </div>
                <p className="fact-claim">“{fc.claim}”</p>
                {fc.explanation && <p className="fact-expl">{fc.explanation}</p>}
              </div>
            ))
        )}
        {tab === 'notes' && (
          data.commentary.length === 0
            ? <p className="muted small">No commentary yet.</p>
            : [...data.commentary].reverse().map((c, i) => (
              <div className="note" key={i}>
                <span className={`note-type note-${c.type}`}>{c.type}</span>
                <span className="note-speaker">{display(c.speaker)}</span>
                <p className="note-text">{c.text}</p>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
