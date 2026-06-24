const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

client.connect();

// Create tables
client.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100),
    email VARCHAR(100) UNIQUE,
    password VARCHAR(100)
  );
  CREATE TABLE IF NOT EXISTS debates (
    id SERIAL PRIMARY KEY,
    topic VARCHAR(255),
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Observer Mode (livestream fact-checking) — Phase 1
  CREATE TABLE IF NOT EXISTS stream_sessions (
    id UUID PRIMARY KEY,
    source_url TEXT NOT NULL,
    platform VARCHAR(50),
    status VARCHAR(50) DEFAULT 'queued',
    error TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS transcript_segments (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES stream_sessions(id) ON DELETE CASCADE,
    speaker_label VARCHAR(100),
    text TEXT NOT NULL,
    start_ts DOUBLE PRECISION,
    end_ts DOUBLE PRECISION,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_transcript_segments_session
    ON transcript_segments(session_id, start_ts);

  -- Multi-model moderator final reports (one row per session+model)
  CREATE TABLE IF NOT EXISTS moderator_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES stream_sessions(id) ON DELETE CASCADE,
    model VARCHAR(50) NOT NULL,
    winner VARCHAR(100),
    summary TEXT,
    scorecard JSONB,
    fact_checks JSONB,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (session_id, model)
  );
  CREATE INDEX IF NOT EXISTS idx_moderator_reports_session
    ON moderator_reports(session_id);
`, (err) => {
  if (err) throw err;
  console.log('Database setup complete.');
  client.end();
});
