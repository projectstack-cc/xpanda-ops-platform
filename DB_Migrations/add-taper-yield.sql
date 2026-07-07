-- add-taper-yield.sql
-- P227: per-job taper yield-per-chunk. Drives Cross Cutter's chunk target for taper orders
-- (chunks = ceil(taper parts / yield)). NULL ⇒ engine default (12). cut_plans is from P225.
-- MANUAL STEP: run in the Cloudflare D1 Dashboard Console BEFORE deploying the worker.
ALTER TABLE cut_plans ADD COLUMN taper_yield INTEGER;
