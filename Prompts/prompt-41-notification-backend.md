# Prompt 41 — Notification System: Backend

## Goal

Create the notification infrastructure: a `notifications` table for in-app notifications, push subscription storage, VAPID key setup, and event-triggered notification dispatch from the Loading Dashboard API handlers.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

**Prerequisites:** Prompts 37 (multi-role), 38 (loading schema/API) must be completed.

---

## Step 1 — Database migration

Create `notifications.sql` at the project root:

```sql
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
-- This uses the existing roles table. Add a notification_types JSON column.
ALTER TABLE roles ADD COLUMN notification_types TEXT NOT NULL DEFAULT '[]';

-- Seed notification types for Administrator role
UPDATE roles SET notification_types = '["loading.assigned","loading.started","loading.loaded","loading.in_transit","loading.delivered"]'
WHERE id = 'role-administrator';
```

### Notification types:
- `loading.assigned` — job assigned to a trailer/bay
- `loading.started` — trailer loading has begun
- `loading.loaded` — trailer is fully loaded
- `loading.in_transit` — trailer has departed
- `loading.delivered` — delivery confirmed

---

## Step 2 — VAPID key setup

Web Push requires VAPID (Voluntary Application Server Identification) keys. Generate a key pair.

Add a one-time setup note in the migration file:

```sql
-- VAPID SETUP (manual step):
-- Generate VAPID keys: npx web-push generate-vapid-keys
-- Add to Cloudflare Workers environment variables:
--   VAPID_PUBLIC_KEY = (the public key)
--   VAPID_PRIVATE_KEY = (the private key)
--   VAPID_SUBJECT = mailto:steve@xpandafoam.com
```

In `_worker.js`, add a public endpoint to retrieve the VAPID public key (needed by the service worker):

```javascript
// Route (add to auth routes section — no session required for the public key)
if (url.pathname === "/api/push/vapid-public-key") {
  return json({ ok: true, key: env.VAPID_PUBLIC_KEY || '' });
}
```

---

## Step 3 — Notifications API

Add `handleApiNotifications` in `_worker.js`:

**GET `/api/notifications`** — List the current user's notifications (most recent first, max 50):

```javascript
const userId = request.headers.get('X-User-Id');
const unreadOnly = url.searchParams.get('unread') === '1';

let query = "SELECT * FROM notifications WHERE user_id = ?";
const binds = [userId];
if (unreadOnly) { query += " AND is_read = 0"; }
query += " ORDER BY created_at DESC LIMIT 50";

const rows = await db.prepare(query).bind(...binds).all();

// Also get unread count
const countRow = await db.prepare(
  "SELECT COUNT(*) as unread_count FROM notifications WHERE user_id = ? AND is_read = 0"
).bind(userId).first();

return json({ ok: true, notifications: rows.results || [], unreadCount: countRow?.unread_count || 0 });
```

**PUT `/api/notifications/read`** — Mark notifications as read. Accept `{ ids: [...] }` or `{ all: true }`:

```javascript
const userId = request.headers.get('X-User-Id');
if (payload.all) {
  await db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").bind(userId).run();
} else if (Array.isArray(payload.ids)) {
  for (const nid of payload.ids) {
    await db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?").bind(nid, userId).run();
  }
}
return json({ ok: true });
```

Wire the route:
```javascript
if (url.pathname.startsWith("/api/notifications")) {
  return handleApiNotifications(request, env);
}
```

---

## Step 4 — Push subscription API

Add `handleApiPushSubscription`:

**POST `/api/push/subscribe`** — Store a push subscription:

```javascript
const userId = request.headers.get('X-User-Id');
const { endpoint, keys } = payload;

const id = crypto.randomUUID();
await db.prepare(
  "INSERT OR REPLACE INTO push_subscriptions (id, user_id, endpoint, p256dh, auth_key) VALUES (?, ?, ?, ?, ?)"
).bind(id, userId, endpoint, keys?.p256dh || '', keys?.auth || '').run();

return json({ ok: true });
```

**DELETE `/api/push/unsubscribe`** — Remove a subscription:

```javascript
const userId = request.headers.get('X-User-Id');
await db.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").bind(userId).run();
return json({ ok: true });
```

Wire routes:
```javascript
if (url.pathname === "/api/push/subscribe") { return handleApiPushSubscribe(request, env); }
if (url.pathname === "/api/push/unsubscribe") { return handleApiPushUnsubscribe(request, env); }
```

---

## Step 5 — Notification dispatch helper

Add a helper that creates in-app notifications and sends push notifications to users with the matching notification role:

```javascript
async function dispatchNotification(db, env, type, title, message, entityType, entityId) {
  try {
    // Find all roles that subscribe to this notification type
    const roles = await db.prepare(
      "SELECT id, notification_types FROM roles"
    ).all();

    const subscribedRoleIds = (roles.results || [])
      .filter(r => {
        try {
          const types = JSON.parse(r.notification_types || '[]');
          return types.includes(type);
        } catch { return false; }
      })
      .map(r => r.id);

    if (!subscribedRoleIds.length) return;

    // Find all users with any of these roles (via junction table)
    const placeholders = subscribedRoleIds.map(() => '?').join(',');
    const userRows = await db.prepare(
      `SELECT DISTINCT ur.user_id FROM user_roles ur WHERE ur.role_id IN (${placeholders})`
    ).bind(...subscribedRoleIds).all();

    const userIds = (userRows.results || []).map(r => r.user_id);
    if (!userIds.length) return;

    const now = new Date().toISOString();

    // Create in-app notifications for each user
    for (const userId of userIds) {
      const nid = crypto.randomUUID();
      await db.prepare(
        `INSERT INTO notifications (id, user_id, type, title, message, entity_type, entity_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(nid, userId, type, title, message, entityType, entityId, now).run();
    }

    // Send push notifications
    if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      for (const userId of userIds) {
        const subs = await db.prepare(
          "SELECT * FROM push_subscriptions WHERE user_id = ?"
        ).bind(userId).all();

        for (const sub of (subs.results || [])) {
          try {
            await sendPushNotification(env, sub, { title, body: message, type, entityType, entityId });
          } catch (e) {
            // If push fails (expired subscription), clean up
            if (e.statusCode === 410 || e.statusCode === 404) {
              await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('Notification dispatch failed:', e);
  }
}

async function sendPushNotification(env, subscription, payload) {
  // Web Push protocol implementation using VAPID
  // This requires the web-push library logic or manual JWT signing
  // For Cloudflare Workers, use the crypto API to sign the JWT

  const endpoint = subscription.endpoint;
  const body = JSON.stringify(payload);

  // Simplified push — in production, this needs proper VAPID JWT signing
  // For now, create the notification record (in-app) and log the push attempt
  // Full push implementation requires importing a web-push compatible library or
  // implementing the VAPID signing manually with crypto.subtle

  // NOTE FOR STEVE: Full Web Push VAPID signing in a Cloudflare Worker requires
  // either the 'web-push' npm package adapted for Workers or manual JWT implementation.
  // The in-app notification system works immediately. Push notifications can be
  // added as a follow-up once VAPID keys are configured.

  console.log('Push notification queued:', endpoint, body);
}
```

---

## Step 6 — Wire notifications into Loading Dashboard API

In `handleApiLoadingAssignments` (from Prompt 38), add `dispatchNotification` calls after each status transition:

### POST (job assigned to loading):
```javascript
// After successful INSERT:
const job = await db.prepare("SELECT customer, invoice_number FROM jobs WHERE id = ?").bind(payload.job_id).first();
const customerName = job?.customer || 'Unknown';
const invNum = job?.invoice_number || '';

await dispatchNotification(db, env, 'loading.assigned',
  'Job Assigned to Loading',
  `${customerName}${invNum ? ' (INV# ' + invNum + ')' : ''} assigned to ${payload.bay_id ? 'Bay' : 'awaiting queue'}`,
  'loading_assignment', id
);
```

### PUT (status transitions):
```javascript
// After successful UPDATE, if loading_status changed:
if (payload.loading_status && payload.loading_status !== existing.loading_status) {
  const job = await db.prepare("SELECT customer, invoice_number FROM jobs WHERE id = ?").bind(existing.job_id).first();
  const customerName = job?.customer || 'Unknown';
  const invNum = job?.invoice_number || '';
  const trailerNum = payload.trailer_number || existing.trailer_number || '';

  const typeMap = {
    loading: 'loading.started',
    loaded: 'loading.loaded',
    in_transit: 'loading.in_transit',
    delivered: 'loading.delivered',
  };

  const notifType = typeMap[payload.loading_status];
  if (notifType) {
    const messages = {
      'loading.started': `Trailer${trailerNum ? ' ' + trailerNum : ''} has begun loading — ${customerName}`,
      'loading.loaded': `Trailer${trailerNum ? ' ' + trailerNum : ''} is loaded — ${customerName}`,
      'loading.in_transit': `Trailer${trailerNum ? ' ' + trailerNum : ''} has departed — ${customerName}`,
      'loading.delivered': `Delivery confirmed — ${customerName}${invNum ? ' (INV# ' + invNum + ')' : ''}`,
    };

    await dispatchNotification(db, env, notifType,
      notifType.split('.')[1].charAt(0).toUpperCase() + notifType.split('.')[1].slice(1).replace('_', ' '),
      messages[notifType],
      'loading_assignment', id
    );
  }
}
```

---

## Step 7 — Update permission labels for notification config

In `admin/roles.html`, the notification types should be configurable per role. Add a section to the role editor that shows notification type checkboxes:

Add after the permission grid:

```javascript
// Notification type labels
const NOTIFICATION_TYPE_LABELS = {
  'loading.assigned':   'Job assigned to loading',
  'loading.started':    'Trailer loading started',
  'loading.loaded':     'Trailer loaded',
  'loading.in_transit': 'Trailer in transit',
  'loading.delivered':  'Delivery confirmed',
};
```

Render a "Notifications" section below the permission grid when editing a role:

```html
<h4>Notification Subscriptions</h4>
<p style="font-size:12px;color:#6b7280;">Users with this role will receive these notifications</p>
<!-- Checkboxes for each notification type -->
```

Save notification_types as JSON on the role via PUT `/api/roles`.

---

## What NOT to touch

- Do NOT modify the Loading Dashboard frontend (Prompt 39)
- Do NOT modify the job board
- Do NOT modify the BOL generator or load builder
- Do NOT modify the auth flow

---

## Completion checklist

- [ ] `notifications.sql` migration created with notifications, push_subscriptions tables, and notification_types column on roles
- [ ] `GET /api/notifications` returns user's notifications with unread count
- [ ] `PUT /api/notifications/read` marks notifications as read (individual or all)
- [ ] `POST /api/push/subscribe` stores push subscription
- [ ] `DELETE /api/push/unsubscribe` removes push subscription
- [ ] `GET /api/push/vapid-public-key` returns public key (no auth required)
- [ ] `dispatchNotification` helper creates in-app notifications for users with matching notification roles
- [ ] Notifications dispatched on: loading assigned, loading started, loaded, in transit, delivered
- [ ] Notification types configurable per role in admin/roles.html
- [ ] Administrator role seeded with all notification types
- [ ] Push notification sending stubbed (full VAPID signing is a follow-up)

**Notify Steve:** Run `notifications.sql` in D1 Dashboard Console. In-app notifications work immediately. For push notifications, generate VAPID keys (`npx web-push generate-vapid-keys`) and add them as environment variables in Cloudflare Workers settings: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
