-- add-cutting-line-progress.sql
-- Per (job, cutting line, part line-item) checklist progress for the v2 cutting board.
-- Each cutting line tracks its own completion of each part on the order.
-- MANUAL STEP: run in the Cloudflare D1 Dashboard Console before deploying the worker.
CREATE TABLE IF NOT EXISTS cutting_line_progress (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL,
  line          TEXT NOT NULL,
  line_item_id  TEXT NOT NULL,
  completed     INTEGER NOT NULL DEFAULT 0,
  completed_qty INTEGER,
  updated_by    TEXT,
  updated_at    TEXT,
  UNIQUE (job_id, line, line_item_id)
);
CREATE INDEX IF NOT EXISTS idx_clp_job ON cutting_line_progress (job_id);
