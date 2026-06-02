-- BOL tracking: per-BOL access token for the driver QR code (P82).
-- 32 hex chars (128 bits entropy). NULL on legacy rows; auto-filled on next save.
ALTER TABLE bols ADD COLUMN access_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bols_access_token ON bols(access_token) WHERE access_token IS NOT NULL;
