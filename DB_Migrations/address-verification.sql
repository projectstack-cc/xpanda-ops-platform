-- Ship-to address verification (Lob). Run once in D1 console BEFORE deploying the worker.
ALTER TABLE jobs ADD COLUMN ship_to_verified     TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE jobs ADD COLUMN ship_to_standardized TEXT;
ALTER TABLE jobs ADD COLUMN ship_to_verified_at  TEXT;
