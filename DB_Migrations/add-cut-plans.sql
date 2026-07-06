-- add-cut-plans.sql
-- Job-linked BOM cut plan for the v2 cutting board (INSTANCE table; per job).
-- Persists the block→chunk→part decomposition target so cutting_lines.qty_target and the
-- Parts sidebar can show real per-line targets. saved_combos remain reusable TEMPLATES and
-- are intentionally NOT referenced by a FK here (kept decoupled).
-- P225 populates part-line targets only (Main Line / Blue Line / Laminate). Chunk-line targets
-- (Cross Cutter / Hole Cutter) + block dims + snapshot/detail are step-2 (columns reserved).
-- MANUAL STEP: run each statement in the Cloudflare D1 Dashboard Console BEFORE deploying the worker.

CREATE TABLE IF NOT EXISTS cut_plans (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'auto',   
  combo_id    TEXT DEFAULT NULL,              
  block_l     REAL DEFAULT NULL,              
  block_w     REAL DEFAULT NULL,              
  block_h     REAL DEFAULT NULL,              
  kerf        REAL DEFAULT NULL,              
  snapshot    TEXT DEFAULT NULL,              
  created_by  TEXT DEFAULT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cut_plans_job ON cut_plans(job_id);

CREATE TABLE IF NOT EXISTS cut_plan_lines (
  id          TEXT PRIMARY KEY,
  cut_plan_id TEXT NOT NULL,
  job_id      TEXT NOT NULL,
  line        TEXT NOT NULL,                  
  unit        TEXT NOT NULL DEFAULT 'part',   
  qty_target  INTEGER DEFAULT NULL,          
  taper_pair  INTEGER NOT NULL DEFAULT 0,     
  detail      TEXT DEFAULT NULL,              
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cut_plan_lines_job_line ON cut_plan_lines(job_id, line);
CREATE INDEX IF NOT EXISTS idx_cut_plan_lines_plan ON cut_plan_lines(cut_plan_id);
