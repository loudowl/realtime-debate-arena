const store = require('./sessionStore');
const mod = require('./moderators');

/**
 * Speaker identity resolver (one per session, shared across all moderators).
 *
 * Diarization gives us anonymous labels ("Speaker A"). This service produces a
 * best-effort *display* for each label using a confidence-tiered approach:
 *
 *   1. NAME (only when well-supported):
 *        - self-introduction ("I'm Dr. Lena Ortiz")              → high
 *        - the SAME name addressed to the speaker repeatedly      → medium
 *        - optional end-of-debate LLM pass over the transcript    → medium
 *      A name is only *surfaced* above NAME_THRESHOLD; a single weak cue is not
 *      enough to assert an identity (this avoids confidently-wrong guesses).
 *
 *   2. DESCRIPTOR (always available, never a guess about who someone *is*):
 *        - role: "Moderator" vs "Debater"
 *        - stance: "Proponent" / "Opponent" (from the host's framing)
 *        - spoken title: "The Governor", "President", "Senator" (only titles
 *          actually said in the transcript)
 *        - else "Debater 1/2"
 *
 * `identify: 'descriptor'` disables names entirely and always shows descriptors.
 * `identify: 'auto'` (default) shows a name when confident, otherwise the
 * descriptor. Either way the result is more informative than "Speaker A".
 */

const NAME_THRESHOLD = 0.8;

const TITLE_WORD = '(?:Dr|Mr|Mrs|Ms|Miss|Prof|Professor|Sen|Senator|Gov|Governor|Rep|Representative|President|Justice|Judge|Mayor|Secretary|Ambassador|Chairman|Chairwoman|Congressman|Congresswoman)\\.?';
const NAME_TOKEN = "[A-Z][a-z.'\\-]+";
const NAME = `(?:${TITLE_WORD}\\s+)?${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){0,2}`;

const SELF_INTRO_RE = new RegExp(`(?:I'?m|I am|[Mm]y name is|[Tt]his is)\\s+(${NAME})`);
const ADDRESS_RE = new RegExp(
  `(${NAME})\\s*,?\\s+(?:your (?:opening|rebuttal|response|closing|turn)|the floor|please respond|please proceed|go ahead|you have the floor)`,
  'i'
);
const TITLE_RE = /\b(Governor|President|Senator|Congress(?:man|woman)|Representative|Mayor|Secretary|Justice|Judge|Doctor|Dr\.?|Professor|Prof\.?|Ambassador|Chair(?:man|woman))\b/;
const MOD_CONTENT_RE = /\b(your (?:opening|rebuttal|response|closing|turn)|the floor is yours|welcome to tonight|let's begin|we'll begin|first question|next question|two minutes|thirty seconds|time is up)\b/i;

const TITLE_NORMALIZE = {
  gov: 'Governor', governor: 'Governor', sen: 'Senator', senator: 'Senator',
  president: 'President', rep: 'Representative', representative: 'Representative',
  dr: 'Doctor', doctor: 'Doctor', prof: 'Professor', professor: 'Professor',
  mayor: 'Mayor', secretary: 'Secretary', justice: 'Justice', judge: 'Judge',
  ambassador: 'Ambassador',
};

function isModeratorLabel(label) {
  return /^moderator$|^host$/i.test(label || '');
}

function normalizeTitle(raw) {
  const key = raw.replace(/\.$/, '').toLowerCase();
  return TITLE_NORMALIZE[key] || (raw[0].toUpperCase() + raw.slice(1).replace(/\.$/, ''));
}

function cleanName(raw) {
  if (!raw) return null;
  let n = raw.trim().replace(/[\s,.;:]+$/, '');
  n = n.replace(/\s+(and|or|the|a|an)$/i, '');
  if (!/[A-Z][a-z]/.test(n)) return null;
  return n;
}

/** Strip a leading honorific; returns { title, bareName }. */
function splitTitle(name) {
  const m = TITLE_RE.exec(name || '');
  let title = m ? normalizeTitle(m[1]) : null;
  // Is the "name" only a title/honorific (e.g. "Mr. President")? Then it's not
  // a personal name — treat it purely as a title.
  const stripped = (name || '').replace(new RegExp(TITLE_WORD, 'gi'), '').replace(/[^A-Za-z]/g, '').trim();
  const bareName = stripped.length >= 2 ? name : null;
  // "Mr. President" → President is the meaningful title.
  if (!title && /president/i.test(name || '')) title = 'President';
  return { title, bareName };
}

function lastToken(name) {
  return (name || '').trim().split(/\s+/).pop();
}

function extractStanceRoster(text) {
  const roster = [];
  const favor = new RegExp(`(?:in favor|for the motion|supporting|arguing for|on the pro)\\b[^.;]*?\\b(${NAME})`);
  const against = new RegExp(`(?:against|opposed|opposing|arguing against|on the con)\\b[^.;]*?\\b(${NAME})`);
  let m;
  if ((m = favor.exec(text))) { const n = cleanName(m[1]); if (n) roster.push({ name: n, stance: 'Proponent' }); }
  if ((m = against.exec(text))) { const n = cleanName(m[1]); if (n) roster.push({ name: n, stance: 'Opponent' }); }
  return roster;
}

function matchStance(name, roster) {
  if (!name) return null;
  const lt = lastToken(name).toLowerCase();
  const hit = roster.find((r) => lastToken(r.name).toLowerCase() === lt || r.name.toLowerCase().includes(name.toLowerCase()));
  return hit ? hit.stance : null;
}

function buildDescriptor({ role, stance, title, order }) {
  if (role === 'moderator') return 'Moderator';
  if (title && stance) return `${title} (${stance.toLowerCase()})`;
  if (title) return `The ${title}`;
  if (stance) return stance;
  return order ? `Debater ${order}` : 'Debater';
}

function createIdentityResolver(session) {
  const sessionId = session.id;
  const mode = session.identify === 'descriptor' ? 'descriptor' : 'auto';
  const roster = [];
  const state = new Map(); // label -> accumulation
  let pending = null; // { name, title } the moderator just addressed
  let debaterCount = 0;

  function ensure(label) {
    if (!state.has(label)) {
      state.set(label, {
        role: isModeratorLabel(label) ? 'moderator' : null,
        order: null,
        selfName: null,
        llmName: null,
        addr: new Map(), // name -> count
        titles: new Map(), // title -> count
      });
    }
    return state.get(label);
  }

  function topEntry(map) {
    let best = null;
    for (const [k, v] of map.entries()) if (!best || v > best.count) best = { value: k, count: v };
    return best;
  }

  function recompute(label) {
    const st = ensure(label);

    // Resolve a candidate name + confidence.
    let name = null;
    let confidence = 0.4;
    let basis = null;
    if (st.selfName) {
      name = st.selfName; confidence = 0.92; basis = 'self-introduction';
    } else if (st.llmName) {
      name = st.llmName; confidence = 0.85; basis = 'transcript analysis';
    } else {
      const top = topEntry(st.addr);
      if (top) {
        name = top.value;
        confidence = Math.min(0.85, 0.5 + 0.18 * top.count); // 1→0.68, 2→0.86
        basis = `addressed by name ×${top.count}`;
      }
    }

    const topTitle = topEntry(st.titles);
    const title = topTitle ? topTitle.value : null;
    const stance = matchStance(name, roster);
    const role = st.role || 'debater';

    const descriptor = buildDescriptor({ role, stance, title, order: st.order });
    const surfaceName = mode !== 'descriptor' && name && confidence >= NAME_THRESHOLD;
    const display = surfaceName ? name : descriptor;

    store.setIdentity(sessionId, label, {
      display,
      descriptor,
      name: surfaceName ? name : null,
      candidateName: name,
      role,
      stance,
      title,
      confidence: surfaceName ? confidence : Math.max(confidence, role === 'moderator' ? 0.8 : 0.5),
      basis: surfaceName ? basis : (stance || title ? 'contextual descriptor' : 'role'),
    });
  }

  function observe(segment) {
    const label = segment.speaker || 'Unknown';
    const text = segment.text || '';
    const st = ensure(label);

    const moderator = isModeratorLabel(label) || (!st.role && MOD_CONTENT_RE.test(text) && /\?$/.test(text.trim()));
    if (moderator) {
      st.role = 'moderator';
      extractStanceRoster(text).forEach((r) => roster.push(r));
      const m = ADDRESS_RE.exec(text);
      if (m) {
        const addressed = cleanName(m[1]);
        const { title, bareName } = splitTitle(addressed || '');
        pending = { name: bareName, title };
      }
      recompute(label);
      return;
    }

    // Debater turn.
    if (st.role !== 'debater') st.role = 'debater';
    if (!st.order) st.order = ++debaterCount;

    const self = SELF_INTRO_RE.exec(text);
    if (self) {
      const n = cleanName(self[1]);
      if (n) st.selfName = n;
    }

    if (pending) {
      if (pending.name) st.addr.set(pending.name, (st.addr.get(pending.name) || 0) + 1);
      if (pending.title) st.titles.set(pending.title, (st.titles.get(pending.title) || 0) + 1);
      pending = null;
    }

    recompute(label);
  }

  /**
   * Optional end-of-debate refinement: ask a model to map labels → names from
   * the full transcript. Only used in `auto` mode with a provider key, and only
   * fills labels that don't already have a confident name.
   */
  async function finalize() {
    if (mode === 'descriptor') return;
    if (!mod.moderationEnabled()) return;
    const segments = store.getSegments(sessionId);
    if (!segments.length) return;
    const labels = [...new Set(segments.map((s) => s.speaker))];
    const transcript = segments.map((s) => `${s.speaker}: ${s.text}`).join('\n').slice(0, 8000);
    const system =
      'You identify debate participants by name from a transcript using self-introductions, host introductions, and direct address. Only assign a name when the transcript clearly supports it; otherwise return null.';
    const user = `Speaker labels: ${JSON.stringify(labels)}\n\nTranscript:\n${transcript}\n\nReturn JSON: { "names": { "<label>": "<full name or null>" } }.`;
    const json = await mod.callModelJSON('openai', system, user);
    const names = json && json.names;
    if (!names) return;
    for (const [label, name] of Object.entries(names)) {
      if (name && typeof name === 'string' && !store.hasIdentity(sessionId, label, NAME_THRESHOLD)) {
        const st = ensure(label);
        if (!st.selfName) st.llmName = cleanName(name);
        recompute(label);
      }
    }
  }

  return { observe, finalize };
}

module.exports = { createIdentityResolver };
