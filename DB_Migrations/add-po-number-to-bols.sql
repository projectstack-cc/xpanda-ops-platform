-- Adds the PO / purchase-order column to bols.
-- D1/SQLite has no "ADD COLUMN IF NOT EXISTS" — run once, manually, in the
-- Cloudflare D1 Dashboard Console. Run BEFORE deploying the P138 worker change
-- (the INSERT/UPDATE below reference po_number and will error if the column is absent).
ALTER TABLE bols ADD COLUMN po_number TEXT;
