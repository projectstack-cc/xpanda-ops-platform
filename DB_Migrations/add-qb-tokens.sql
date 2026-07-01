-- QB2: QuickBooks OAuth token storage
-- Run once in Cloudflare D1 Dashboard Console before deploying QB2.
-- Also add these env secrets in Cloudflare Workers → Settings → Variables & Secrets:
--   QB_CLIENT_ID     — from Intuit developer portal (app → Keys & OAuth)
--   QB_CLIENT_SECRET — from Intuit developer portal (app → Keys & OAuth)
--   QB_REALM_ID      — your QBO company realm ID (shown in Playground after auth)
--   QB_SANDBOX       — set to "1" for sandbox, omit or set to "0" for production

CREATE TABLE IF NOT EXISTS qb_connections (
  id TEXT PRIMARY KEY,
  realm_id TEXT NOT NULL UNIQUE,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
