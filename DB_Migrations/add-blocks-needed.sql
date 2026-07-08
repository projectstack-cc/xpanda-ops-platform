-- add-blocks-needed.sql
-- P228: materials figure from the block calculator. blocks_needed = ceil(qty / parts-per-block),
-- max across primary + secondary parts. cut_plans, block_l/w/h, kerf, snapshot are from P225.
-- MANUAL STEP: run in the Cloudflare D1 Dashboard Console BEFORE deploying the worker.
ALTER TABLE cut_plans ADD COLUMN blocks_needed INTEGER;
