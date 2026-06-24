import { jsPDF } from 'jspdf';

const METRIC_LABELS = {
  facticity: 'Facticity',
  evidence: 'Evidence',
  persuasiveness: 'Persuasiveness',
  responsiveness: 'Responsiveness',
  coherence: 'Coherence',
  composure: 'Composure',
};

/**
 * Memorialize a single moderator's analysis as a PDF: header, source/session
 * metadata, declared winner, the weighted scorecard, the narrative conclusion,
 * and the fact-check log.
 */
export function exportReportPDF(report, session) {
  const nameMap = report.speakerNames || {};
  const named = (label) => nameMap[label] || label;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 48;
  const width = doc.internal.pageSize.getWidth();
  const maxWidth = width - margin * 2;
  let y = margin;

  const line = (text, opts = {}) => {
    const { size = 11, style = 'normal', color = [20, 20, 20], gap = 4 } = opts;
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(text), maxWidth);
    lines.forEach((l) => {
      if (y > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(l, margin, y);
      y += size + gap;
    });
  };

  const rule = () => {
    y += 4;
    doc.setDrawColor(210);
    doc.line(margin, y, width - margin, y);
    y += 14;
  };

  line('Realtime Debate Arena', { size: 12, color: [120, 120, 120] });
  line('Moderator Analysis Report', { size: 22, style: 'bold' });
  y += 6;
  line(`Moderator: ${report.modelLabel || report.model}`, { size: 13, style: 'bold', color: [60, 60, 120] });
  if (session?.sourceUrl) line(`Source: ${session.sourceUrl}`, { size: 10, color: [90, 90, 90] });
  line(`Generated: ${new Date(report.generatedAt || Date.now()).toLocaleString()}`, { size: 10, color: [90, 90, 90] });
  rule();

  // Conclusion / winner.
  line('Conclusion', { size: 15, style: 'bold' });
  const winnerText = report.winner
    ? (report.winner === 'Draw' ? 'No decisive winner (Draw)' : `Winner: ${named(report.winner)}`)
    : 'No winner declared';
  line(winnerText, { size: 13, style: 'bold', color: [20, 110, 70] });
  y += 2;
  line(report.summary || '', { size: 11 });
  rule();

  // Scorecard.
  line('Weighted Scorecard', { size: 15, style: 'bold' });
  const metrics = report.metrics || Object.keys(METRIC_LABELS);
  const speakers = Object.keys(report.scorecard || {});
  speakers.forEach((sp) => {
    const card = report.scorecard[sp];
    const heading = named(sp) === sp ? sp : `${named(sp)} (${sp})`;
    line(`${heading} — total ${fmt(card.total)}`, { size: 12, style: 'bold' });
    const row = metrics.map((m) => `${METRIC_LABELS[m] || m}: ${fmt(card[m])}`).join('   ');
    line(row, { size: 10, color: [70, 70, 70] });
    y += 2;
  });
  rule();

  // Fact-check log.
  line('Fact-Check Log', { size: 15, style: 'bold' });
  const fcs = report.factChecks || [];
  if (!fcs.length) {
    line('No check-worthy claims were flagged.', { size: 10, color: [120, 120, 120] });
  } else {
    fcs.forEach((fc, i) => {
      line(`${i + 1}. [${fc.verdict.toUpperCase()} · ${Math.round((fc.confidence || 0) * 100)}%] ${named(fc.speaker)}`, {
        size: 10,
        style: 'bold',
        color: verdictColor(fc.verdict),
      });
      line(`“${fc.claim}”`, { size: 10, color: [60, 60, 60] });
      if (fc.explanation) line(fc.explanation, { size: 9, color: [110, 110, 110] });
      y += 2;
    });
  }

  const safe = (report.modelLabel || report.model || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  doc.save(`debate-analysis-${safe}.pdf`);
}

function fmt(n) {
  return typeof n === 'number' ? n.toFixed(2) : '—';
}

function verdictColor(verdict) {
  return {
    true: [20, 110, 70],
    misleading: [180, 120, 0],
    unverifiable: [110, 110, 110],
    false: [170, 40, 40],
  }[verdict] || [20, 20, 20];
}
