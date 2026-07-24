ALTER TABLE jobs ADD COLUMN trailer_group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_trailer_group_id ON jobs (trailer_group_id);
