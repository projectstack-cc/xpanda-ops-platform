# Prompt 84 — BOL Tracking (P3 of 3): Push Notification on Driver-Confirmed Delivery

## Agents to assume

**Read BOTH `AGENTS.md` AND `xpanda-ops-agents.md`.** Assume:
- **Lead: db-api-agent** — single hookup inside `_worker.js`.

Tiny prompt. Single file. Reuses existing `dispatchNotification` and `loading.delivered` notification type — no new type, no UI changes, no migration.

## Context

P82 + P83 shipped. Drivers can now scan, confirm pickup, and complete delivery (uploading signed BOL to R2). The P83 delivery handler ends with a `TODO(P84)` marker where push notifications should fire.

The existing `dispatchNotification(db, env, type, title, message, entityType, entityId)` helper already does the entire fan-out: finds roles subscribed to a type, inserts notification rows, sends web push to each subscribed user. The notification type `loading.delivered` already exists (catalog at `admin/roles.html` line 400) and is already dispatched when shipments are manually marked delivered from the logistics dashboard (`_worker.js` line ~4445).

**Decision baked in:** reuse the existing `loading.delivered` type rather than adding a new one. Both surfaces (manual mark-delivered and driver QR delivery) are the same business event from the notification recipient's perspective — "this shipment was delivered." A separate `bol.signed_uploaded` type would just produce a second notification for the same event. We tweak the message text to mention the signed BOL when the source is the QR flow, so recipients can tell at a glance.

---

## Part 1 — Wire dispatch at the `TODO(P84)` marker

In `handleApiPublicBolDelivery` (added in P83), find the line:

```javascript
  // TODO(P84): trigger push notification to subscribers of 'bol_delivered'.
```

It sits between the last DB UPDATE and the `return json({ ok: true, stage: 'delivered' });`. Replace it with:

```javascript
  // Push notification — reuse the existing 'loading.delivered' type.
  // Distinguish QR-flow deliveries in the message so recipients see the signed BOL is available.
  try {
    // Look up customer + invoice number for a useful message (mirrors the manual mark-delivered dispatch).
    const job = await db.prepare(
      "SELECT customer, invoice_number FROM jobs WHERE id = ?"
    ).bind(bol.job_id).first();
    const customerName = job?.customer || 'shipment';
    const invNum = job?.invoice_number || '';
    const title = 'Delivery completed';
    const message = `Delivery confirmed by driver — ${customerName}${invNum ? ' (INV# ' + invNum + ')' : ''}. Signed BOL is available to view.`;
    await dispatchNotification(db, env, 'loading.delivered', title, message, 'shipment', shipment.id);
  } catch (e) {
    // Notification failure must NOT break the delivery confirmation response.
    console.error('Push notification dispatch failed (delivery flow):', e);
  }
```

Notes:
- Catches and logs any dispatch failure rather than propagating — the driver's HTTP response must succeed even if push fails.
- Uses `customer` + `invoice_number` from the jobs table to match the existing message style at line ~4445.
- `entityType: 'shipment'` + `entityId: shipment.id` matches the existing convention so the in-app notification dropdown's click handler routes correctly.
- No new notification type means no admin UI change, no migration, no new opt-in toggles. Anyone subscribed to `loading.delivered` today gets notified by both surfaces.

---

## Part 2 — Routing tweak (one line)

In the existing `handleNotifClick` function at `jobs/jobs-header.js` (or wherever it lives — see line ~797 in `admin/roles.html` for the reference handler), notifications of type `loading.delivered` currently route to `/logistics/loading.html`. That destination is still correct — the user lands on the loading dashboard where they can click the shipment to see the signed BOL in the modal (P83 surface). **No change needed here.** Listed only so the implementer doesn't reflexively touch it thinking something's missing.

---

## Scope (strict)

- **One file:** `_worker.js`.
- One block replaces one TODO comment.
- No new notification type. No `NOTIFICATION_TYPE_LABELS` change in `admin/roles.html`. No migration. No new permission. No HTML touched.

## Verify

1. As a user whose role has `loading.delivered` enabled (check or enable via `/admin/roles.html`), and who has granted push notification permission in the browser (existing flow):
   - Open a fresh BOL with a QR code.
   - From a phone or another device, scan the QR, confirm pickup, complete delivery (with photo).
   - The desktop browser receives a push notification: title "Delivery completed", body "Delivery confirmed by driver — [customer] (INV# [num]). Signed BOL is available to view."
   - The in-app notification bell shows a new unread; clicking it navigates to `/logistics/loading.html`.
   - From there, open the shipment modal and confirm the Signed BOL section (from P83) shows the driver's uploaded photo.
2. If push subscription is missing or expired, the in-app notification still appears (delivered via DB row); the worker silently cleans up dead subscriptions as it already does.
3. The manual mark-delivered flow from the logistics dashboard still works and still sends its own notification — the two surfaces coexist with no duplicate notifications, because each delivery event happens through exactly one path.

## After this lands

The three-prompt BOL tracking feature is complete. End-to-end: BOL is printed with a QR → driver scans → confirms pickup → delivers → photographs signed BOL → uploads to R2 → shipment marked delivered → office gets push notification → signed BOL viewable from the shipment modal → token now inactive.

**Worth noting for the BACKLOG:** with P83's R2 integration shipped, F4a (R2 inventory pass) becomes much easier — the pattern is now proven. The next F4 phase (likely migrating `loading_photos.photo_data` from D1 base64 to R2 keys) follows the same shape: add `<blob>_key TEXT` column, swap `env.DB` writes/reads for `env.BOL_PHOTOS.put/get` (or a second bucket for clarity, e.g. `LOADING_PHOTOS`), update read paths, drop the base64 column.
