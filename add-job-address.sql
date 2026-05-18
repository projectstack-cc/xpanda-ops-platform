-- MANUAL STEP: Run this migration in the Cloudflare D1 Dashboard Console.

ALTER TABLE jobs ADD COLUMN ship_to_company TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN ship_to_attention TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN ship_to_street TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN ship_to_street2 TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN ship_to_city TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN ship_to_state TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN ship_to_zip TEXT NOT NULL DEFAULT '';
