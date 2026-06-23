-- add-cutting-sessions.sql
-- Cutting Dashboard React pilot — SESSION model (supersedes cutting_steps step model).
-- MANUAL STEP: run each statement separately in the Cloudflare D1 Dashboard Console.
-- Does NOT drop cutting_steps — legacy vanilla dashboard stays live until React replaces it.

-- ── cutting_lines: "what needs to run" — one row per (job, required line) ──────────
CREATE TABLE IF NOT EXISTS cutting_lines (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL,
  line         TEXT NOT NULL,                              
  line_status  TEXT NOT NULL DEFAULT 'not_started',        
  qty_target   INTEGER DEFAULT NULL,                        
  qty_done     INTEGER DEFAULT NULL,                        
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cutting_lines_job ON cutting_lines(job_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cutting_lines_job_line ON cutting_lines(job_id, line);

-- ── cutting_sessions: clock-in events = the handoff record itself ──────────────────
CREATE TABLE IF NOT EXISTS cutting_sessions (
  id             TEXT PRIMARY KEY,
  job_id         TEXT NOT NULL,
  line           TEXT NOT NULL,
  operator_id    TEXT NOT NULL,
  operator_name  TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'open',             
  started_at     TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at       TEXT DEFAULT NULL,
  handoff_note   TEXT NOT NULL DEFAULT '',                 
  qty_done_delta INTEGER DEFAULT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cutting_sessions_job ON cutting_sessions(job_id);

CREATE INDEX IF NOT EXISTS idx_cutting_sessions_open ON cutting_sessions(job_id, line, status);
