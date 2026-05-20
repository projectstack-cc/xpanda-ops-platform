-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.
-- Drops and recreates the index as non-unique.

DROP INDEX IF EXISTS idx_bols_bol_number;
DROP INDEX IF EXISTS idx_bols_number_unique;
CREATE INDEX IF NOT EXISTS idx_bols_number ON bols(bol_number);
