-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.

-- 1. Migrate existing 'scheduled' shipments to 'awaiting'
UPDATE shipments SET status = 'awaiting' WHERE status = 'scheduled';

-- 2. Drop delivery_date column
-- SQLite doesn't support DROP COLUMN before 3.35.0.
-- D1 uses a recent SQLite, so this should work:
ALTER TABLE shipments DROP COLUMN delivery_date;

-- Fallback if DROP COLUMN is not supported:
-- Leave the column in place. The code will simply stop reading/writing it.
-- It will be harmless dead data.
