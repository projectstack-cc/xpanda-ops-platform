-- add-cutting-session-photo.sql
-- Optional cut-list photo captured at clock-out; stored in R2, key recorded here.
-- MANUAL STEP: run in the Cloudflare D1 Dashboard Console before deploying the worker.
ALTER TABLE cutting_sessions ADD COLUMN photo_key TEXT DEFAULT NULL;
