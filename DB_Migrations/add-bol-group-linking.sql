-- Multi-load BOL linking: a shared group id plus per-record load sequence, so the
-- BOLs that make up one multi-trailer shipment can be queried/displayed as a set.
-- SQLite ALTER ADD COLUMN is not idempotent — run this migration exactly once.
-- Run in the Cloudflare D1 Dashboard Console BEFORE deploying the worker.
ALTER TABLE bols ADD COLUMN bol_group_id TEXT;
ALTER TABLE bols ADD COLUMN load_number INTEGER;
ALTER TABLE bols ADD COLUMN load_count INTEGER;
CREATE INDEX IF NOT EXISTS idx_bols_group ON bols (bol_group_id);
