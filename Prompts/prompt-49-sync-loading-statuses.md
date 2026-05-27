# Prompt 49 — Sync Loading Statuses to Shipments + Remove Delivery Date

## Goal

Two changes:

1. **Sync loading dashboard statuses to the shipments table.** When a loading assignment's `loading_status` changes, auto-update the linked shipment's `status` to match. The logistics dashboard should display these loading-aligned statuses instead of the old `scheduled` / `in_transit` / `delivered` / `cancelled` set.

2. **Remove `delivery_date`** from the shipments table and all UI. XPanda only ships regionally — delivery is always same-day as ship date, so the field is unnecessary.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Context

Currently the `shipments` table has its own `status` column with values: `scheduled`, `in_transit`, `delivered`, `cancelled`. The `loading_assignments` table has its own `loading_status` column with values: `awaiting`, `not_started`, `loading`, `loaded`, `in_transit`, `delivered`. These two are completely independent — changing one does not update the other.

The logistics supervisor wants the logistics dashboard to reflect the real-time loading status rather than a manually-managed shipment status that nobody updates. The loading team already drives status changes through the Loading Dashboard — the shipments table should follow automatically.

**New unified status set for shipments:**

| Status | Label | Meaning |
|---|---|---|
| `awaiting` | Awaiting | Job assigned to loading, no bay yet |
| `not_started` | Not Started | Assigned to bay, loading hasn't begun |
| `loading` | Loading | Actively being loaded |
| `loaded` | Loaded | Trailer fully loaded, not departed |
| `in_transit` | In Transit | Departed facility |
| `delivered` | Delivered | Confirmed delivered |
| `cancelled` | Cancelled | Cancelled (manual only, not synced from loading) |

---

## Step 1 — Migration SQL

Create `sync-loading-statuses.sql` at the project root:

```sql
-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.

-- 1. Migrate existing 'scheduled' shipments to 'awaiting'
UPDATE shipments SET status = 'awaiting' WHERE status = 'scheduled';

-- 2. Drop delivery_date column
-- SQLite doesn't support DROP COLUMN before 3.35.0.
-- D1 uses a recent SQLite, so this should work:
ALTER TABLE shipments DROP COLUMN delivery_date;
```

If `ALTER TABLE ... DROP COLUMN` fails in D1, provide a fallback note to Steve:
```sql
-- Fallback if DROP COLUMN is not supported:
-- Leave the column in place. The code will simply stop reading/writing it.
-- It will be harmless dead data.
```

---

## Step 2 — Worker: sync loading_status → shipment status

In `_worker.js`, find the `handleApiLoadingAssignments` PUT handler. After the loading_status is successfully updated (after the `UPDATE loading_assignments SET ...` runs and succeeds), add a sync block.

Find this section (after the successful UPDATE, around the activity log call):

```javascript
await db.prepare(`UPDATE loading_assignments SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
```

**After** that line and **before** the activity log call, add:

```javascript
// ── Sync loading status → linked shipment ────────────────────
if (payload.loading_status && payload.loading_status !== existing.loading_status) {
  try {
    // Find the shipment linked to this job
    const shipment = await db.prepare(
      "SELECT id FROM shipments WHERE job_id = ? AND direction = 'outbound' LIMIT 1"
    ).bind(existing.job_id).first();

    if (shipment) {
      await db.prepare(
        "UPDATE shipments SET status = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(payload.loading_status, shipment.id).run();
    }
  } catch (e) {
    // Non-fatal: log but don't fail the loading status update
    console.error('Shipment status sync failed:', e);
  }
}
```

This goes inside the existing `if (payload.loading_status)` block, after the UPDATE but within the try/catch.

---

## Step 3 — Worker: also sync on POST (new loading assignment)

In `handleApiLoadingAssignments` POST handler, after the successful INSERT, add the same sync:

Find the section after:
```javascript
await db.prepare(`INSERT INTO loading_assignments ...`).bind(...).run();
```

Add after it:

```javascript
// Sync initial loading status to linked shipment
try {
  const shipment = await db.prepare(
    "SELECT id FROM shipments WHERE job_id = ? AND direction = 'outbound' LIMIT 1"
  ).bind(payload.job_id).first();

  if (shipment) {
    await db.prepare(
      "UPDATE shipments SET status = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(loading_status, shipment.id).run();
  }
} catch (e) {
  console.error('Shipment status sync on assignment creation failed:', e);
}
```

---

## Step 4 — Worker: remove delivery_date from shipment handlers

### 4a. Shipment POST handler

In `handleApiShipments` POST handler, find where `delivery_date` is parsed and included in the INSERT:

```javascript
const delivery_date = String(payload.delivery_date || "").trim();
```

Remove this line.

In the INSERT statement, remove `delivery_date` from both the column list and the VALUES placeholders. Remove the corresponding `.bind()` parameter.

### 4b. Shipment PUT handler

In the `allowed` array for the PUT handler:

```javascript
const allowed = [
  "customer", "carrier", "method", "bol_number", "origin", "destination",
  "ship_date", "delivery_date", "status", "total_bdft", "load_count",
  "weight_lbs", "bead_type", "notes", "job_id", "trailer_number",
];
```

Remove `"delivery_date"` from this array.

### 4c. Auto-created shipment from job creation

In the job creation POST handler (around line 2002), find the auto-created shipment INSERT:

```javascript
INSERT INTO shipments
  (id, direction, job_id, customer, carrier, method, bol_number, origin,
   destination, ship_date, delivery_date, status, ...)
```

Remove `delivery_date` from the column list, VALUES, and the corresponding `.bind()` parameter.

Also change the default status from `'scheduled'` to `'awaiting'`:

```javascript
// BEFORE:
'scheduled',

// AFTER:
'awaiting',
```

---

## Step 5 — Logistics dashboard: update status options and badge rendering

### 5a. Status filter dropdowns

In `logistics/index.html`, update all three status filter `<select>` elements (outbound filter, inbound filter, and modal status field).

**Outbound status filter** (around line 67):
```html
<select class="logistics-filter-select" id="outbound-status-filter" onchange="loadOutbound()">
  <option value="">All Statuses</option>
  <option value="awaiting">Awaiting</option>
  <option value="not_started">Not Started</option>
  <option value="loading">Loading</option>
  <option value="loaded">Loaded</option>
  <option value="in_transit">In Transit</option>
  <option value="delivered">Delivered</option>
  <option value="cancelled">Cancelled</option>
</select>
```

**Inbound status filter** (around line 93): same options.

**Modal status field** (around line 150): same options.

### 5b. Default status on new shipment

In the `clearForm()` function, change the default:

```javascript
// BEFORE:
document.getElementById('f-status').value = 'scheduled';

// AFTER:
document.getElementById('f-status').value = 'awaiting';
```

### 5c. Status badge labels

Update the `statusBadge()` function:

```javascript
function statusBadge(status) {
  const labels = {
    awaiting:    'Awaiting',
    not_started: 'Not Started',
    loading:     'Loading',
    loaded:      'Loaded',
    in_transit:  'In Transit',
    delivered:   'Delivered',
    cancelled:   'Cancelled',
    scheduled:   'Scheduled',  // Legacy fallback for any old data
  };
  return `<span class="logistics-status-badge status-${status}">${labels[status] || status}</span>`;
}
```

### 5d. Stats card logic

In `updateStats()`, the "Pending Inbound" stat currently filters `scheduled || in_transit`. Update to include the new statuses:

```javascript
const inboundPending = inboundData.filter(s =>
  s.status !== 'delivered' && s.status !== 'cancelled'
).length;
```

Also update the stat sub-label text. In the HTML stats section, change:

```html
<!-- BEFORE -->
<div class="logistics-stat-sub">scheduled or in transit</div>

<!-- AFTER -->
<div class="logistics-stat-sub">not yet delivered</div>
```

### 5e. Inbound rendering sort logic

In `renderInbound()`, the active/done split currently checks `!== 'delivered' && !== 'cancelled'`. This is already correct for the new statuses — no change needed.

### 5f. Remove delivery_date from the form

In the modal HTML, find the field row containing Ship Date and Delivery Date (around lines 136–145):

```html
<div class="logistics-field-row">
  <div class="logistics-field">
    <label>Ship Date</label>
    <input type="date" id="f-ship-date">
  </div>
  <div class="logistics-field">
    <label>Delivery Date</label>
    <input type="date" id="f-delivery-date">
  </div>
</div>
```

Remove the Delivery Date field div entirely. Ship Date stays. The field-row can either contain just Ship Date full-width, or pair Ship Date with the Status field. Preferred layout — put Ship Date and Status on the same row:

```html
<div class="logistics-field-row">
  <div class="logistics-field">
    <label>Ship Date</label>
    <input type="date" id="f-ship-date">
  </div>
  <div class="logistics-field">
    <label>Status</label>
    <select id="f-status">
      <option value="awaiting">Awaiting</option>
      <option value="not_started">Not Started</option>
      <option value="loading">Loading</option>
      <option value="loaded">Loaded</option>
      <option value="in_transit">In Transit</option>
      <option value="delivered">Delivered</option>
      <option value="cancelled">Cancelled</option>
    </select>
  </div>
</div>
```

Then the next row becomes Method + (whatever was previously paired with Status). Adjust accordingly so the form fields flow naturally in two-column pairs.

### 5g. Remove delivery_date from JavaScript

In `clearForm()`, remove `'f-delivery-date'` from the array of fields to clear.

In `openEdit()`, remove the line:
```javascript
document.getElementById('f-delivery-date').value= s.delivery_date || '';
```

In `saveShipment()`, remove:
```javascript
const delivDate  = document.getElementById('f-delivery-date').value;
```

And remove `delivery_date: delivDate` from the payload object.

---

## Step 6 — CSS: add badge styles for new statuses

In `logistics/logistics-shared.css`, add badge styles for the new statuses alongside the existing ones:

```css
.status-awaiting    { background: #f3f4f6; color: #374151; }
.status-not_started { background: #fef3c7; color: #92400e; }
.status-loading     { background: #dbeafe; color: #1e40af; }
.status-loaded      { background: #d1fae5; color: #065f46; }
/* .status-in_transit and .status-delivered already exist */
/* .status-cancelled already exists */
/* Keep .status-scheduled as legacy fallback */
```

These colors match the loading dashboard's `LD_STATUS_COLORS` exactly.

Also add inbound card border colors for the new statuses:

```css
.logistics-inbound-card.status-awaiting    { border-left-color: #9ca3af; }
.logistics-inbound-card.status-not_started { border-left-color: #f59e0b; }
.logistics-inbound-card.status-loading     { border-left-color: #3b82f6; }
.logistics-inbound-card.status-loaded      { border-left-color: #10b981; }
```

Update the CSS variables in `:root` if they reference `--status-scheduled`:

```css
/* BEFORE */
--status-scheduled: #6b7280;

/* AFTER */
--status-awaiting: #6b7280;
```

---

## What NOT to touch

- Do NOT modify the loading dashboard (`loading.html`) — it already has the correct statuses
- Do NOT modify the loading_assignments table schema
- Do NOT modify the BOL generator or `bol-shared.js`
- Do NOT modify the load builder
- Do NOT modify the homepage (`index.html`)
- Do NOT modify admin pages
- Do NOT change the loading status flow order (awaiting → not_started → loading → loaded → in_transit → delivered)
- Do NOT change the notification dispatch logic in the loading assignment PUT handler — it stays exactly as-is
- Do NOT modify how inbound shipments work for bead receive / silo auto-logging

---

## Completion checklist

- [ ] Migration SQL: existing `scheduled` → `awaiting`, drop `delivery_date` column
- [ ] Worker: loading assignment PUT syncs `loading_status` → linked shipment `status`
- [ ] Worker: loading assignment POST syncs initial status → linked shipment
- [ ] Worker: `delivery_date` removed from shipment POST INSERT
- [ ] Worker: `delivery_date` removed from shipment PUT allowed fields
- [ ] Worker: auto-created shipment from job defaults to `'awaiting'` instead of `'scheduled'`
- [ ] Logistics dashboard: all three status filter dropdowns updated with new statuses
- [ ] Logistics dashboard: `statusBadge()` labels include all new statuses
- [ ] Logistics dashboard: `clearForm()` defaults to `'awaiting'`
- [ ] Logistics dashboard: delivery_date field removed from form HTML
- [ ] Logistics dashboard: delivery_date references removed from JS (`clearForm`, `openEdit`, `saveShipment`)
- [ ] Logistics dashboard: stats card "Pending Inbound" logic updated
- [ ] Logistics dashboard: stats sub-label text changed to "not yet delivered"
- [ ] CSS: badge styles for `awaiting`, `not_started`, `loading`, `loaded` added
- [ ] CSS: inbound card border colors for new statuses added
- [ ] Legacy `scheduled` badge style kept as fallback
- [ ] No console errors

**Notify Steve:** Run the migration SQL in the Cloudflare D1 Dashboard Console before deploying:
```sql
UPDATE shipments SET status = 'awaiting' WHERE status = 'scheduled';
ALTER TABLE shipments DROP COLUMN delivery_date;
```
If `DROP COLUMN` fails, leave the column — the code will simply ignore it.

Test:
1. Open Loading Dashboard → advance a job from `not_started` → `loading` → check logistics dashboard → shipment status should auto-update to `loading`
2. Create a new job (which auto-creates a shipment) → shipment should have status `awaiting`
3. Pull that job into loading → assign to bay → shipment status should update to `not_started`
4. Advance through full flow → `loading` → `loaded` → `in_transit` → `delivered` — shipment should follow each step
5. Open logistics dashboard → filter dropdowns show new status options
6. Edit an existing shipment → no delivery_date field in the form
7. Check inbound delivery form → also no delivery_date field, new status options work
8. Check stat cards → "Pending Inbound" counts anything not delivered/cancelled
