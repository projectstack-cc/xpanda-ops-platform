# Prompt 59 — Job as Source of Truth: Backend Sync Overhaul

## Goal

Make the Job Board the single source of truth for outbound shipments. When a job is created, it immediately generates both a shipment record AND a loading assignment. Job status changes sync forward to the shipment. The shipment becomes a read-through view of the job (except for logistics-only fields like trailer number and BOL number). The loading assignment creation moves from the "done" status transition to job creation.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Context

### Current flow
1. Job created → auto-creates shipment (status `awaiting`)
2. Job moves to `done` → auto-creates loading assignment (status `awaiting`)
3. Loading assignment status changes sync to shipment status (Prompt 49)
4. Job status and shipment status are semi-independent

### New flow
1. Job created → auto-creates shipment (status `not_started`) AND loading assignment (status `awaiting`)
2. Job status changes (`not_started` → `in_production` → `done`) sync to shipment with mapping:
   - `not_started` → `not_started`
   - `in_production` → `in_production`
   - `done` → `ready_to_ship`
3. Once job reaches `done`, the loading dashboard takes over status progression:
   - Loading dashboard: `awaiting` → `not_started` → `loading` → `loaded` → `in_transit` → `delivered`
   - These continue to sync to shipment (already works via Prompt 49)
4. Key editable fields on the job (customer, carrier, ship_date, address, etc.) sync forward to the shipment when updated

### Status lifecycle summary
```
Job Board controls:     not_started → in_production → done
Shipment mirrors:       not_started → in_production → ready_to_ship
Loading Dash controls:  loading → loaded → in_transit → delivered
Shipment mirrors:       loading → loaded → in_transit → delivered
```

---

## Step 1 — Add `ready_to_ship` to valid shipment statuses

In `_worker.js`, find the POST handler for shipments (around line 2783):

```javascript
const validStatuses = ["awaiting", "not_started", "loading", "loaded", "in_transit", "delivered", "cancelled", "scheduled"];
```

Add `ready_to_ship` and `in_production`:

```javascript
const validStatuses = ["awaiting", "not_started", "in_production", "ready_to_ship", "loading", "loaded", "in_transit", "delivered", "cancelled", "scheduled"];
```

---

## Step 2 — Job creation: auto-create loading assignment + update shipment status

In `_worker.js`, find the job POST handler (around line 1940). Currently it auto-creates a shipment with status `awaiting` (around line 2007–2035).

### 2a. Change auto-shipment status from `awaiting` to `not_started`

In the shipment INSERT (around line 2025), change:

```javascript
'awaiting',
```

to:

```javascript
'not_started',
```

### 2b. Auto-create loading assignment on job creation

After the auto-shipment creation block (after the closing `}` of the try/catch around line 2035), add:

```javascript
// Auto-create loading assignment
try {
  const loadCount = Math.max(load_count || 1, 1);
  const now2 = new Date().toISOString();
  for (let n = 1; n <= loadCount; n++) {
    const laId = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
      VALUES (?, ?, NULL, '', 'awaiting', NULL, '', ?, ?, ?)
    `).bind(laId, id, n, now2, now2).run();
  }
} catch (e) {
  console.error('Auto-create loading assignment on job create failed:', String(e?.message || e));
}
```

**Note:** If Prompt 57 (load_number column) has NOT been applied yet, remove the `load_number` column and the `n` bind from this INSERT. The column reference is:
```sql
INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
```
If `load_number` column doesn't exist, use:
```sql
INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, created_at, updated_at)
```
And remove the `n` from the `.bind()`.

---

## Step 3 — Job status change: sync to shipment

In `_worker.js`, find the job PUT handler. After the job is updated (around line 2139, after `const job = await db.prepare("SELECT * FROM jobs WHERE id = ?")...`), find the existing block that auto-creates a loading assignment when status moves to `done` (around line 2142–2172).

### 3a. Replace the "done → create loading assignment" block

Replace the entire `if (payload.status === 'done') { ... }` block with:

```javascript
// Sync job status to linked shipment
if (payload.status) {
  const JOB_TO_SHIPMENT_STATUS = {
    not_started: 'not_started',
    in_production: 'in_production',
    done: 'ready_to_ship',
  };
  const mappedStatus = JOB_TO_SHIPMENT_STATUS[payload.status];
  if (mappedStatus) {
    try {
      const shipment = await db.prepare(
        "SELECT id FROM shipments WHERE job_id = ? AND direction = 'outbound' LIMIT 1"
      ).bind(id).first();
      if (shipment) {
        await db.prepare(
          "UPDATE shipments SET status = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(mappedStatus, shipment.id).run();
      }
    } catch (e) {
      console.error('Job→Shipment status sync failed:', e);
    }
  }
}
```

This removes the loading assignment auto-creation on `done` (since it now happens on job creation in Step 2) and adds status sync from job → shipment for the production phase statuses.

### 3b. Sync editable fields from job to shipment on job update

Still in the job PUT handler, after the status sync block above, add field sync for the fields that logistics needs to see in real-time:

```javascript
// Sync editable fields to linked shipment
const SYNC_FIELDS_JOB_TO_SHIPMENT = {
  customer:   'customer',
  carrier:    'carrier',
  method:     'method',
  ship_date:  'ship_date',
  location:   'destination',
  total_bdft: 'total_bdft',
  load_count: 'load_count',
};

const syncSets = [];
const syncBinds = [];
for (const [jobField, shipField] of Object.entries(SYNC_FIELDS_JOB_TO_SHIPMENT)) {
  if (jobField in payload) {
    syncSets.push(`${shipField} = ?`);
    if (['total_bdft', 'load_count'].includes(jobField)) {
      syncBinds.push(Number(payload[jobField]) || 0);
    } else {
      syncBinds.push(String(payload[jobField] || '').trim());
    }
  }
}

if (syncSets.length > 0) {
  try {
    const shipment = await db.prepare(
      "SELECT id FROM shipments WHERE job_id = ? AND direction = 'outbound' LIMIT 1"
    ).bind(id).first();
    if (shipment) {
      syncSets.push("updated_at = datetime('now')");
      syncBinds.push(shipment.id);
      await db.prepare(`UPDATE shipments SET ${syncSets.join(', ')} WHERE id = ?`).bind(...syncBinds).run();
    }
  } catch (e) {
    console.error('Job→Shipment field sync failed:', e);
  }
}
```

---

## Step 4 — Remove orphan backfill for loading assignments

In the loading assignments GET handler (around line 4216), the backfill block auto-creates loading assignments for orphan jobs. Since loading assignments are now created at job creation time, this backfill is no longer needed for NEW jobs. However, it should remain for EXISTING jobs that were created before this change but don't have loading assignments yet.

**Leave the backfill as-is for backward compatibility.** Once all existing jobs have been processed, it will find no orphans and be a no-op.

---

## Step 5 — Update valid shipment statuses in PUT handler

In the shipment PUT handler (around line 2856), the `allowed` field list already includes `status`. No explicit validation block exists in the PUT (unlike POST), so `ready_to_ship` and `in_production` will be accepted automatically. No change needed here.

However, double-check: if there IS a validation block for status in the PUT handler, add `in_production` and `ready_to_ship` to it.

---

## What NOT to touch

- Do NOT modify the loading assignment PUT handler (status sync from loading → shipment stays as-is)
- Do NOT modify `loading.html` or the loading dashboard
- Do NOT modify `bol-shared.js`, `bol-generator.html`, or `load-builder.html`
- Do NOT modify the inbound shipment flow
- Do NOT modify the job board frontend (`jobs/index.html`) — that comes in a separate prompt
- Do NOT modify the shipment DELETE handler
- Do NOT modify existing shipment data — backward compat handles old records

---

## Completion checklist

- [ ] `_worker.js`: `ready_to_ship` and `in_production` added to valid shipment statuses in POST
- [ ] `_worker.js`: auto-shipment creation on job POST uses `not_started` instead of `awaiting`
- [ ] `_worker.js`: auto-loading-assignment creation added to job POST (creates immediately, not on `done`)
- [ ] `_worker.js`: job PUT syncs status to shipment using mapping (`done` → `ready_to_ship`, etc.)
- [ ] `_worker.js`: job PUT syncs editable fields (customer, carrier, method, ship_date, location, total_bdft, load_count) to linked shipment
- [ ] `_worker.js`: old "status === done → create loading assignment" block removed from job PUT
- [ ] `_worker.js`: orphan backfill in loading assignments GET left intact for backward compat
- [ ] Loading assignment → shipment status sync (Prompt 49) still works unchanged
- [ ] No console errors

**Notify Steve:** No migrations needed — this is purely logic changes. Deploy and test:
1. Create a new job on the Job Board → verify a shipment appears on the logistics dashboard with status "Not Started"
2. Verify a loading assignment also appears on the loading dashboard with status "Awaiting"
3. Move the job to "In Production" on the Job Board → logistics dashboard shipment status updates to "In Production"
4. Move the job to "Done" → logistics dashboard shows "Ready to Ship"
5. Edit a job's customer name on the Job Board → verify the shipment's customer name updates on the logistics dashboard
6. From the loading dashboard, advance the loading assignment to "Loading" → shipment status syncs to "Loading"
7. Existing jobs without loading assignments are still backfilled on GET
8. Create a new shipment via "+ New Shipment" on logistics dashboard → still works normally (ad-hoc flow)
