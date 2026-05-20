-- Roles & Permissions migration
-- Run: wrangler d1 execute DB --remote --file ./roles-permissions.sql

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '{}',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_name ON roles(name);

-- Add role_id FK to users table
ALTER TABLE users ADD COLUMN role_id TEXT DEFAULT NULL;

-- Seed the three default roles

-- Administrator: bypasses all checks (permissions JSON is irrelevant but included for completeness)
INSERT OR IGNORE INTO roles (id, name, description, permissions, is_system) VALUES (
  'role-administrator',
  'Administrator',
  'Full unrestricted access to all platform features',
  '{"jobs":{"view":true,"edit":true},"logistics.dashboard":{"view":true,"edit":true},"logistics.bol":{"view":true,"edit":true},"logistics.load-builder":{"view":true,"edit":true},"production.calculators":{"view":true,"edit":true},"production.inventory":{"view":true,"edit":true},"qc":{"view":true,"edit":true},"safety":{"view":true,"edit":true},"reports":{"view":true,"edit":true},"admin":{"view":true,"edit":true}}',
  1
);

-- Staff: can view and edit most things, no admin
INSERT OR IGNORE INTO roles (id, name, description, permissions, is_system) VALUES (
  'role-staff',
  'Staff',
  'Standard access — view and edit production modules',
  '{"jobs":{"view":true,"edit":true},"logistics.dashboard":{"view":true,"edit":true},"logistics.bol":{"view":true,"edit":false},"logistics.load-builder":{"view":true,"edit":false},"production.calculators":{"view":true,"edit":true},"production.inventory":{"view":true,"edit":true},"qc":{"view":true,"edit":true},"safety":{"view":true,"edit":false},"reports":{"view":true,"edit":false},"admin":{"view":false,"edit":false}}',
  1
);

-- Readonly: view only, no edits anywhere
INSERT OR IGNORE INTO roles (id, name, description, permissions, is_system) VALUES (
  'role-readonly',
  'Read Only',
  'View-only access — cannot create, edit, or delete anything',
  '{"jobs":{"view":true,"edit":false},"logistics.dashboard":{"view":true,"edit":false},"logistics.bol":{"view":true,"edit":false},"logistics.load-builder":{"view":true,"edit":false},"production.calculators":{"view":true,"edit":false},"production.inventory":{"view":true,"edit":false},"qc":{"view":true,"edit":false},"safety":{"view":true,"edit":false},"reports":{"view":true,"edit":false},"admin":{"view":false,"edit":false}}',
  1
);

-- Migrate existing users to role_id based on their current role text
UPDATE users SET role_id = 'role-administrator' WHERE role = 'admin' AND role_id IS NULL;
UPDATE users SET role_id = 'role-staff' WHERE role = 'staff' AND role_id IS NULL;
UPDATE users SET role_id = 'role-readonly' WHERE role = 'readonly' AND role_id IS NULL;
