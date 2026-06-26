import { jsPDF } from 'jspdf';

const METRIC_LABELS = {
  facticity: 'Facticity',
  evidence: 'Evidence',
  persuasiveness: 'Persuasiveness',
  responsiveness: 'Responsiveness',
  coherence: 'Coherence',
  composure: 'Composure',
};

const VERDICT_LABELS = {
  true: 'True',
  misleading: 'Misleading',
  unverifiable: 'Unverifiable',
  false: 'False',
};

/**
 * Memorialize a single moderator's analysis as a PDF. Beyond the headline
 * verdict, this lays out the full reasoning trail so the decision is auditable:
 * the decision rationale (ranking + margin vs. draw threshold), the scoring
 * methodology (lens + metric weights), the weighted scorecard, a fact-check
 * summary and detailed log, and the analyst's running commentary.
 */
export function exportReportPDF(report, session) {
  const nameMap = report.speakerNames || {};
  const named = (label) => nameMap[label] || label;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 48;
  const width = doc.internal.pageSize.getWidth();
  const maxWidth = width - margin * 2;
  let y = margin;

  const ensureSpace = (needed = 0) => {
    if (y + needed > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const line = (text, opts = {}) => {
    const { size = 11, style = 'normal', color = [20, 20, 20], gap = 4, indent = 0 } = opts;
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(text), maxWidth - indent);
    lines.forEach((l) => {
      ensureSpace(size + gap);
      doc.text(l, margin + indent, y);
      y += size + gap;
    });
  };

  const heading = (text) => {
    ensureSpace(28);
    line(text, { size: 15, style: 'bold', color: [30, 30, 40] });
  };

  const rule = () => {
    y += 4;
    ensureSpace(18);
    doc.setDrawColor(210);
    doc.line(margin, y, width - margin, y);
    y += 14;
  };

  // --- Title / metadata -----------------------------------------------------
  line('Realtime Debate Arena', { size: 12, color: [120, 120, 120] });
  line('Moderator Analysis Report', { size: 22, style: 'bold' });
  y += 6;
  line(`Moderator: ${report.modelLabel || report.model}`, { size: 13, style: 'bold', color: [60, 60, 120] });
  if (report.lens) line(`Analytical lens: ${report.lens}`, { size: 10, color: [90, 90, 90] });
  if (session?.sourceUrl) line(`Source: ${session.sourceUrl}`, { size: 10, color: [90, 90, 90] });
  if (session?.platform) line(`Platform: ${session.platform}${session.mode ? ` · ${session.mode} mode` : ''}`, { size: 10, color: [90, 90, 90] });
  line(`Generated: ${new Date(report.generatedAt || Date.now()).toLocaleString()}`, { size: 10, color: [90, 90, 90] });
  rule();

  // --- Conclusion -----------------------------------------------------------
  heading('Conclusion');
  const winnerText = report.winner
    ? (report.winner === 'Draw' ? 'No decisive winner (Draw)' : `Winner: ${named(report.winner)}`)
    : 'No winner declared';
  line(winnerText, { size: 13, style: 'bold', color: [20, 110, 70] });
  y += 2;
  line(report.summary || '', { size: 11 });
  rule();

  // --- Decision rationale ---------------------------------------------------
  heading('Decision Rationale');
  line('The verdict is derived from each debater\u2019s weighted-rubric total. Speakers are ranked below; when a winner is declared, the margin between the top two is tested against this moderator\u2019s draw threshold.', {
    size: 10, color: [80, 80, 80],
  });
  y += 4;
  const ranking = report.ranking || deriveRanking(report.scorecard);
  ranking.forEach((r, i) => {
    line(`${i + 1}. ${named(r.name)} \u2014 ${fmt(r.total)}`, {
      size: 11,
      style: i === 0 ? 'bold' : 'normal',
      color: i === 0 ? [20, 90, 60] : [40, 40, 40],
    });
  });
  y += 4;
  if (report.declareWinner === false) {
    line('Winner declaration was disabled for this run \u2014 only the comparative breakdown is reported.', { size: 10, color: [110, 110, 110] });
  } else if (report.margin != null && report.drawMargin != null && ranking.length >= 2) {
    const cleared = report.margin >= report.drawMargin;
    line(`Top-two margin: ${fmt(report.margin)}   |   Draw threshold: ${fmt(report.drawMargin)}`, { size: 10, color: [80, 80, 80] });
    line(
      cleared
        ? `Margin clears the threshold \u2192 ${named(ranking[0].name)} is declared the winner.`
        : 'Margin falls within the draw threshold \u2192 the result is scored a Draw.',
      { size: 10, style: 'bold', color: cleared ? [20, 110, 70] : [150, 110, 0] },
    );
  }
  rule();

  // --- Scoring methodology --------------------------------------------------
  heading('Scoring Methodology');
  if (report.persona) line(report.persona, { size: 10, color: [80, 80, 80] });
  if (typeof report.segmentCount === 'number' && report.segmentCount > 0) {
    line(`Scored utterances analyzed: ${report.segmentCount}`, { size: 10, color: [110, 110, 110] });
  }
  y += 4;
  const weights = report.weights || {};
  const weightMetrics = report.metricsAnalyzed || Object.keys(METRIC_LABELS);
  if (Object.keys(weights).length) {
    line('Metric weights (how strongly each dimension influenced the total):', { size: 10, style: 'bold', color: [60, 60, 60] });
    weightMetrics.forEach((m) => {
      const w = weights[m];
      if (w == null) return;
      const emphasis = w >= 1.2 ? '  (emphasized)' : w < 1 ? '  (de-emphasized)' : '';
      line(`\u2022 ${METRIC_LABELS[m] || m}: \u00d7${fmt(w)}${emphasis}`, {
        size: 10,
        color: w >= 1.2 ? [40, 90, 60] : w < 1 ? [140, 90, 60] : [70, 70, 70],
        indent: 8,
        gap: 2,
      });
    });
  }
  rule();

  // --- Weighted scorecard ---------------------------------------------------
  heading('Weighted Scorecard');
  const metrics = report.metrics || Object.keys(METRIC_LABELS);
  const speakers = Object.keys(report.scorecard || {});
  if (!speakers.length) {
    line('No scored debaters.', { size: 10, color: [120, 120, 120] });
  }
  speakers.forEach((sp) => {
    const card = report.scorecard[sp];
    const head = named(sp) === sp ? sp : `${named(sp)} (${sp})`;
    line(`${head} \u2014 total ${fmt(card.total)}`, { size: 12, style: 'bold' });
    metrics.forEach((m) => {
      line(`\u2022 ${METRIC_LABELS[m] || m}: ${fmt(card[m])}`, { size: 10, color: [70, 70, 70], indent: 8, gap: 2 });
    });
    y += 4;
  });
  rule();

  // --- Fact-check summary ---------------------------------------------------
  heading('Fact-Check Summary');
  const fcSummary = report.factCheckSummary || {};
  const fcs = report.factChecks || [];
  const summaryEntries = Object.keys(VERDICT_LABELS).filter((v) => fcSummary[v]);
  if (!fcs.length) {
    line('No check-worthy claims were flagged during this debate.', { size: 10, color: [120, 120, 120] });
  } else {
    line(`${fcs.length} check-worthy claim${fcs.length === 1 ? '' : 's'} evaluated:`, { size: 10, color: [80, 80, 80] });
    summaryEntries.forEach((v) => {
      line(`\u2022 ${VERDICT_LABELS[v]}: ${fcSummary[v]}`, { size: 10, style: 'bold', color: verdictColor(v), indent: 8, gap: 2 });
    });
  }
  rule();

  // --- Fact-check log (detailed) -------------------------------------------
  heading('Fact-Check Log');
  if (!fcs.length) {
    line('No check-worthy claims were flagged.', { size: 10, color: [120, 120, 120] });
  } else {
    fcs.forEach((fc, i) => {
      line(`${i + 1}. [${(VERDICT_LABELS[fc.verdict] || fc.verdict).toUpperCase()} \u00b7 ${Math.round((fc.confidence || 0) * 100)}% confidence] ${named(fc.speaker)}`, {
        size: 10,
        style: 'bold',
        color: verdictColor(fc.verdict),
      });
      line(`\u201c${fc.claim}\u201d`, { size: 10, color: [60, 60, 60], indent: 8 });
      if (fc.explanation) line(`Rationale: ${fc.explanation}`, { size: 9, color: [110, 110, 110], indent: 8 });
      y += 3;
    });
  }
  rule();

  // --- Analyst commentary ---------------------------------------------------
  heading('Analyst Commentary');
  const commentary = report.commentary || [];
  if (!commentary.length) {
    line('No rhetorical or fallacy notes were recorded.', { size: 10, color: [120, 120, 120] });
  } else {
    line('Running notes on rhetoric, rebuttals, and argument quality that informed the scoring:', { size: 10, color: [80, 80, 80] });
    y += 2;
    commentary.forEach((c, i) => {
      const tag = c.type ? `[${c.type}] ` : '';
      line(`${i + 1}. ${tag}${named(c.speaker)}`, { size: 10, style: 'bold', color: [60, 60, 90] });
      line(c.text, { size: 10, color: [70, 70, 70], indent: 8 });
      y += 2;
    });
  }

  const safe = (report.modelLabel || report.model || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  doc.save(`debate-analysis-${safe}.pdf`);
}

function deriveRanking(scorecard = {}) {
  return Object.keys(scorecard)
    .map((name) => ({ name, total: scorecard[name].total }))
    .sort((a, b) => (b.total || 0) - (a.total || 0));
}

function fmt(n) {
  return typeof n === 'number' ? n.toFixed(2) : '\u2014';
}

function verdictColor(verdict) {
  return {
    true: [20, 110, 70],
    misleading: [180, 120, 0],
    unverifiable: [110, 110, 110],
    false: [170, 40, 40],
  }[verdict] || [20, 20, 20];
}
