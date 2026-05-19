-- MANUAL STEP: Run this migration in the Cloudflare D1 Dashboard Console.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'staff',
  is_active INTEGER NOT NULL DEFAULT 1,
  first_login INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Seed the admin account. Password is 'admin' — MUST be changed on first login.
INSERT OR IGNORE INTO users (id, username, display_name, password, role, is_active, first_login)
VALUES ('admin-seed-001', 'admin', 'Administrator', 'admin', 'admin', 1, 1);

-- Add user tracking to activity log.
-- NOTE: SQLite has no "ADD COLUMN IF NOT EXISTS" — run this only once.
ALTER TABLE activity_log ADD COLUMN user_id TEXT DEFAULT NULL;
