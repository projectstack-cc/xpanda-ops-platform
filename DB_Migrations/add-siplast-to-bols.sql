-- Siplast flag on BOLs. When set, the SKU in each commodity line is prefixed
-- "Siplast" at render. SQLite ALTER ADD COLUMN is not idempotent — run once.
-- Run in the Cloudflare D1 Dashboard Console BEFORE deploying the worker.
ALTER TABLE bols ADD COLUMN siplast INTEGER DEFAULT 0;
