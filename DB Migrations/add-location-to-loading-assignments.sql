-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.
-- Adds a location flag to loading_assignments so trailers can be moved to the yard
-- without freeing their logical assignment. Values: 'bay' (default) | 'yard'.
ALTER TABLE loading_assignments ADD COLUMN location TEXT DEFAULT 'bay';
