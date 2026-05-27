-- MIGRATION COMPLETE: This file has been run in D1 and is kept for reference only.
-- MANUAL STEP: Run this migration in the Cloudflare D1 Dashboard Console.
-- Before running, ensure no active users are on the platform.
-- This drops parts_library and load_builder_skus after creating the unified parts table.

CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY,
  part_number TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  customer TEXT NOT NULL DEFAULT '',
  density_material TEXT NOT NULL DEFAULT '',
  length_in REAL NOT NULL,
  width_in REAL NOT NULL,
  height_in REAL NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#D97706',
  allow_rotation INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT '',
  parent_group TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_part_number ON parts(part_number);
CREATE INDEX IF NOT EXISTS idx_parts_category ON parts(category);

DROP TABLE IF EXISTS parts_library;
DROP TABLE IF EXISTS load_builder_skus;
