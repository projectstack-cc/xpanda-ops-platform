-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console BEFORE deploying the worker.

CREATE TABLE IF NOT EXISTS cutting_steps (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  process_name TEXT NOT NULL,           -- 'Cross Cutter' | 'Hole Cutter' | 'Main Line' | 'Blue Line' | 'Laminate'
  step_status TEXT NOT NULL DEFAULT 'queued',  -- queued | in_progress | completed
  operator TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  started_at TEXT DEFAULT NULL,
  completed_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_cutting_steps_job    ON cutting_steps(job_id);
CREATE INDEX IF NOT EXISTS idx_cutting_steps_status ON cutting_steps(step_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cutting_steps_job_process ON cutting_steps(job_id, process_name);
