-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.

CREATE TABLE IF NOT EXISTS saved_loads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  job_id TEXT DEFAULT NULL,
  customer TEXT NOT NULL DEFAULT '',
  trailer_type TEXT NOT NULL DEFAULT '',
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+90 days'))
);

CREATE INDEX IF NOT EXISTS idx_saved_loads_expires ON saved_loads(expires_at);
CREATE INDEX IF NOT EXISTS idx_saved_loads_customer ON saved_loads(customer);
