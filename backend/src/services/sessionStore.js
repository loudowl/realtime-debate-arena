const { EventEmitter } = require('events');
const crypto = require('crypto');

let pgPool = null;
let dbReady = false;

try {
  const { Pool } = require('pg');
  if (process.env.DATABASE_URL) {
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
    pgPool.on('error', (err) => {
      console.warn('[sessionStore] PG pool error, falling back to memory:', err.message);
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

  async createSession(url) {
    const id = crypto.randomUUID();
    const session = {
      id,
      sourceUrl: url,
      platform: this.detectPlatform(url),
      status: 'queued',
      error: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
    };
    this.sessions.set(id, session);
    this.segments.set(id, []);

    if (dbReady) {
      try {
        await pgPool.query(
          `INSERT INTO stream_sessions (id, source_url, platform, status)
           VALUES ($1, $2, $3, $4)`,
          [id, url, session.platform, session.status]
        );
      } catch (err) {
        console.warn('[sessionStore] persist session failed:', err.message);
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
        console.warn('[sessionStore] update status failed:', err.message);
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
        console.warn('[sessionStore] persist segment failed:', err.message);
      }
    }
    return record;
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
