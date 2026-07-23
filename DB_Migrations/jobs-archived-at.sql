ALTER TABLE jobs ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_archived_at ON jobs (archived_at);

UPDATE jobs
SET archived_at = COALESCE(updated_at, created_at, datetime('now'))
WHERE status = 'archived' AND archived_at IS NULL;
