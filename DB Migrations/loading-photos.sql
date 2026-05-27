-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.

-- 1. Add ready_checklist column to loading_assignments
ALTER TABLE loading_assignments ADD COLUMN ready_checklist TEXT DEFAULT NULL;

-- 2. Create loading_photos table
CREATE TABLE IF NOT EXISTS loading_photos (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  photo_data TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (assignment_id) REFERENCES loading_assignments(id),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_loading_photos_assignment ON loading_photos(assignment_id);
CREATE INDEX IF NOT EXISTS idx_loading_photos_job ON loading_photos(job_id);
