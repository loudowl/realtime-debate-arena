const { EventEmitter } = require('events');
const crypto = require('crypto');

function errText(err) {
  if (!err) return 'unknown error';
  // PG connection failures (and AggregateErrors on multi-address hosts) often
  // carry an empty message; fall back to code/address so the log is actionable.
  const parts = [err.message, err.code, err.address && `${err.address}:${err.port || ''}`]
    .filter(Boolean);
  return parts.length ? parts.join(' ') : String(err);
}

let pgPool = null;
let dbReady = false;

try {
  const { Pool } = require('pg');
  if (process.env.DATABASE_URL) {
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
    pgPool.on('error', (err) => {
      console.warn('[sessionStore] PG pool error, falling back to memory:', errText(err));
      dbReady = false;
    });
    dbReady = true;
  }
} catch (err) {
  console.warn('[sessionStore] pg unavailable, using in-memory store only:', err.message);
}

/**
 * In-process registry + pub/sub bus for Observer Mode sessions.
 *
 * This is the Phase 1 stand-in for the Redis-backed job/event tier described in
 * docs/OBSERVER_MODE.md. The public surface (sessions + emit/subscribe) is kept
 * deliberately small so it can be swapped for Redis pub/sub + BullMQ without
 * touching routes, the worker, or the WebSocket layer.
 */
class SessionStore {
  constructor() {
    this.sessions = new Map();
    this.segments = new Map();
    // Model-tagged live events (fact_check/commentary/score_update/report) kept
    // for replay so a late WebSocket subscriber is caught up across all models.
    this.modelEvents = new Map(); // sessionId -> [{ type, data }]
    this.reports = new Map(); // sessionId -> Map<modelId, report>
    this.identities = new Map(); // sessionId -> Map<label, { name, confidence, evidence }>
    this.bus = new EventEmitter();
    this.bus.setMaxListeners(0);
  }

  detectPlatform(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      if (/youtu\.?be/.test(host)) return 'youtube';
      if (/twitch\.tv/.test(host)) return 'twitch';
      if (/(x\.com|twitter\.com)/.test(host)) return 'x';
      if (/\.m3u8($|\?)/.test(url)) return 'hls';
      return host;
    } catch (err) {
      return 'unknown';
    }
  }

  async createSession(url, options = {}) {
    const id = crypto.randomUUID();
    const session = {
      id,
      sourceUrl: url,
      platform: this.detectPlatform(url),
      status: 'queued',
      models: Array.isArray(options.models) ? options.models : [],
      declareWinner: options.declareWinner !== false,
      identify: options.identify === 'descriptor' ? 'descriptor' : 'auto',
      mode: null, // 'simulation' | 'real', set by the worker once ingestion starts
      error: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
    };
    this.sessions.set(id, session);
    this.segments.set(id, []);
    this.modelEvents.set(id, []);
    this.reports.set(id, new Map());
    this.identities.set(id, new Map());

    if (dbReady) {
      try {
        await pgPool.query(
          `INSERT INTO stream_sessions (id, source_url, platform, status)
           VALUES ($1, $2, $3, $4)`,
          [id, url, session.platform, session.status]
        );
      } catch (err) {
        console.warn('[sessionStore] persist session failed:', errText(err));
      }
    }
    return session;
  }

  getSession(id) {
    return this.sessions.get(id) || null;
  }

  listSessions() {
    return Array.from(this.sessions.values()).sort(
      (a, b) => new Date(b.startedAt) - new Date(a.startedAt)
    );
  }

  getSegments(id) {
    return this.segments.get(id) || [];
  }

  async updateStatus(id, status, extra = {}) {
    const session = this.sessions.get(id);
    if (!session) return;
    session.status = status;
    if (extra.error !== undefined) session.error = extra.error;
    if (status === 'completed' || status === 'stopped' || status === 'failed') {
      session.endedAt = new Date().toISOString();
    }
    this.emit(id, 'session', session);

    if (dbReady) {
      try {
        await pgPool.query(
          `UPDATE stream_sessions
             SET status = $2, error = $3, ended_at = $4
           WHERE id = $1`,
          [id, status, session.error, session.endedAt]
        );
      } catch (err) {
        console.warn('[sessionStore] update status failed:', errText(err));
      }
    }
  }

  async addSegment(id, segment) {
    const segmentId = crypto.randomUUID();
    const record = {
      id: segmentId,
      speaker: segment.speaker || 'Unknown',
      text: segment.text,
      startTs: segment.startTs,
      endTs: segment.endTs,
    };
    const list = this.segments.get(id);
    if (list) list.push(record);
    this.emit(id, 'transcript', record);

    if (dbReady) {
      try {
        await pgPool.query(
          `INSERT INTO transcript_segments
             (id, session_id, speaker_label, text, start_ts, end_ts)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [segmentId, id, record.speaker, record.text, record.startTs, record.endTs]
        );
      } catch (err) {
        console.warn('[sessionStore] persist segment failed:', errText(err));
      }
    }
    return record;
  }

  // --- moderator model events + reports ---

  /** Emit and retain a model-tagged live event for later replay. */
  emitModelEvent(id, event) {
    const list = this.modelEvents.get(id);
    if (list) list.push(event);
    this.bus.emit(id, event);
  }

  getModelEvents(id) {
    return this.modelEvents.get(id) || [];
  }

  saveReport(id, modelId, report) {
    const map = this.reports.get(id) || new Map();
    map.set(modelId, report);
    this.reports.set(id, map);
  }

  getReport(id, modelId) {
    const map = this.reports.get(id);
    return map ? map.get(modelId) || null : null;
  }

  getReports(id) {
    const map = this.reports.get(id);
    return map ? Array.from(map.values()) : [];
  }

  // --- speaker identities ---

  /** Returns true when `label` has a name (optionally at/above minConfidence). */
  hasIdentity(id, label, minConfidence = 0) {
    const map = this.identities.get(id);
    const info = map && map.get(label);
    return Boolean(info && info.confidence >= minConfidence);
  }

  /**
   * Set/replace a speaker's resolved identity record. The resolver recomputes a
   * full record each turn, so we emit when the user-visible `display` changes or
   * confidence improves. Retains an `identity` event for WebSocket replay.
   */
  setIdentity(id, label, info) {
    const map = this.identities.get(id) || new Map();
    const prev = map.get(label);
    const changed = !prev || prev.display !== info.display || (info.confidence || 0) > (prev.confidence || 0);
    map.set(label, info);
    this.identities.set(id, map);
    if (changed) {
      const event = { type: 'identity', data: { label, ...info } };
      const list = this.modelEvents.get(id);
      if (list) list.push(event);
      this.bus.emit(id, event);
    }
    return changed;
  }

  /** Plain { label: display } map of resolved identities for a session. */
  getIdentities(id) {
    const map = this.identities.get(id);
    const out = {};
    if (map) for (const [label, info] of map.entries()) out[label] = info.display || info.name;
    return out;
  }

  // --- pub/sub bus ---

  emit(id, type, data) {
    this.bus.emit(id, { type, data });
  }

  subscribe(id, handler) {
    this.bus.on(id, handler);
    return () => this.bus.off(id, handler);
  }
}

module.exports = new SessionStore();
