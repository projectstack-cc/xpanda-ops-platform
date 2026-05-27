-- MANUAL STEP: Run this migration in the Cloudflare D1 Dashboard Console.

ALTER TABLE sessions ADD COLUMN simulating_role_id TEXT DEFAULT NULL;
