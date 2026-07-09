-- add-cut-plan-setups.sql
-- P230: multi-part cut plans. One row per part/block configuration in a job's cut list.
-- cut_plans stays one-per-job (taper_yield + AGGREGATE blocks_needed = SUM of setups); the queue
-- route is unchanged. MANUAL: run in the Cloudflare D1 Dashboard Console BEFORE deploying the worker.
CREATE TABLE IF NOT EXISTS cut_plan_setups (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL,
  label         TEXT DEFAULT NULL,
  block_l       REAL NOT NULL,
  block_w       REAL NOT NULL,
  block_h       REAL NOT NULL,
  kerf          REAL NOT NULL DEFAULT 0.079,
  mode          TEXT NOT NULL DEFAULT 'auto',
  part_l        REAL NOT NULL,
  part_w        REAL NOT NULL,
  part_h        REAL NOT NULL,
  qty           INTEGER DEFAULT NULL,
  per_block     INTEGER DEFAULT NULL,
  blocks_needed INTEGER DEFAULT NULL,
  util_pct      REAL DEFAULT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cut_plan_setups_job ON cut_plan_setups(job_id);
