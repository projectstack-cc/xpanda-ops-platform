-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.
-- Adds R2 storage key column to jobs (F4d).
-- New uploads set packing_slip_key and null packing_slip_pdf.
-- The serve path prefers packing_slip_key, falls back to packing_slip_pdf for
-- un-backfilled rows. Drop packing_slip_pdf only AFTER verifying backfill complete.
ALTER TABLE jobs ADD COLUMN packing_slip_key TEXT;
