-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.

-- In-app notifications
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

-- Push subscriptions (Web Push API)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL DEFAULT '',
  auth_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

-- Notification roles: which roles receive which notification types
-- NOTE: ALTER TABLE does not support IF NOT EXISTS — run once only.
ALTER TABLE roles ADD COLUMN notification_types TEXT NOT NULL DEFAULT '[]';

-- Seed notification types for Administrator role
UPDATE roles SET notification_types = '["loading.assigned","loading.started","loading.loaded","loading.in_transit","loading.delivered"]'
WHERE id = 'role-administrator';

-- VAPID SETUP (manual step):
-- Generate VAPID keys: npx web-push generate-vapid-keys
-- Add to Cloudflare Workers environment variables:
--   VAPID_PUBLIC_KEY = (the public key)
--   VAPID_PRIVATE_KEY = (the private key)
--   VAPID_SUBJECT = mailto:steve@xpandafoam.com
