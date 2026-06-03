-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.
-- Adds R2 storage key column to loading_photos (F4c).
-- The existing photo_data column is TEXT NOT NULL and cannot be altered in SQLite;
-- the write path stores photo_data = '' (empty sentinel) for new R2-backed rows,
-- and the backfill endpoint sets photo_data = '' after confirming the R2 put.
-- Drop photo_data only AFTER verifying backfill is complete (remaining = 0).
ALTER TABLE loading_photos ADD COLUMN photo_key TEXT;
