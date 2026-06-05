-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.

-- Add load_number column to loading_assignments
ALTER TABLE loading_assignments ADD COLUMN load_number INTEGER NOT NULL DEFAULT 1;
