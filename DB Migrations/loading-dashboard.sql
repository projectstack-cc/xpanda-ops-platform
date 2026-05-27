-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.

-- Bays: physical loading bays at the facility
CREATE TABLE IF NOT EXISTS loading_bays (
  id TEXT PRIMARY KEY,
  bay_number INTEGER NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  trailer_number TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed bays 20-30
INSERT OR IGNORE INTO loading_bays (id, bay_number, label, is_active) VALUES
  ('bay-20', 20, 'Bay 20', 1),
  ('bay-21', 21, 'Bay 21', 1),
  ('bay-22', 22, 'Bay 22', 1),
  ('bay-23', 23, 'Bay 23', 1),
  ('bay-24', 24, 'Bay 24', 1),
  ('bay-25', 25, 'Bay 25', 1),
  ('bay-26', 26, 'Bay 26', 1),
  ('bay-27', 27, 'Bay 27', 1),
  ('bay-28', 28, 'Bay 28', 1),
  ('bay-29', 29, 'Bay 29', 1),
  ('bay-30', 30, 'Bay 30', 1);

-- Loading assignments: links jobs to bays with loading status
CREATE TABLE IF NOT EXISTS loading_assignments (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  bay_id TEXT DEFAULT NULL,
  trailer_number TEXT NOT NULL DEFAULT '',
  loading_status TEXT NOT NULL DEFAULT 'awaiting',
  assigned_by TEXT DEFAULT NULL,
  started_at TEXT DEFAULT NULL,
  loaded_at TEXT DEFAULT NULL,
  in_transit_at TEXT DEFAULT NULL,
  delivered_at TEXT DEFAULT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (bay_id) REFERENCES loading_bays(id)
);

CREATE INDEX IF NOT EXISTS idx_loading_assignments_job ON loading_assignments(job_id);
CREATE INDEX IF NOT EXISTS idx_loading_assignments_bay ON loading_assignments(bay_id);
CREATE INDEX IF NOT EXISTS idx_loading_assignments_status ON loading_assignments(loading_status);

-- Update Staff role to include loading view+edit but not manage
UPDATE roles SET permissions = json_set(permissions,
  '$.logistics.loading', json('{"view":true,"edit":true}'),
  '$."logistics.loading.manage"', json('{"view":false,"edit":false}')
) WHERE id = 'role-staff';

-- Update Administrator role for completeness
UPDATE roles SET permissions = json_set(permissions,
  '$.logistics.loading', json('{"view":true,"edit":true}'),
  '$."logistics.loading.manage"', json('{"view":true,"edit":true}')
) WHERE id = 'role-administrator';
