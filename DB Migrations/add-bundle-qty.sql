-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.
ALTER TABLE parts ADD COLUMN bundle_qty INTEGER NOT NULL DEFAULT 0;
