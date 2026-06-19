# Prompt 189 — Loading: hide customer-pickup assignments in GET + bidirectional Loading/Loaded status sync

## Required reading (do this first)
1. Read `AGENTS.md` (repo root) in full.
2. Read `xpanda-ops-agents.md` (repo root) in full.
3. You are acting as the **db-api-agent** (primary). Cross-reference the **logistics-agent** section for the loading-status semantics.

## Scope
Worker only. **No migration. No frontend changes. No new endpoints.**
Files you may touch:
- `_worker.js/routes/loading.js`
- `_worker.js/routes/jobs.js`

Do NOT touch: any `.html`, any `.css`, `routes/public.js` (driver QR path), `bol-*.js`, `load-builder.html`, admin files, or any migration.

---

## Change 1 — Loading-assignments GET must hide customer-pickup jobs

In `_worker.js/routes/loading.js`, inside the `GET` handler, the assignment list query builds a `conditions` array. Currently:

```js
      if (!includeArchived) conditions.push("la.loading_status != 'archived'");
      if (bayId) { conditions.push("la.bay_id = ?"); binds.push(bayId); }
```

Add a customer-pickup exclusion as the first condition. Replace the block above with:

```js
      // Customer-pickup jobs are live loads — never surface them on the loading dashboard.
      // (Matches the lowercase 'customer pickup' value stored by the jobs form. We hide here
      // rather than deleting any existing loading_assignments rows.)
      conditions.push("COALESCE(j.method, '') != 'customer pickup'");
      if (!includeArchived) conditions.push("la.loading_status != 'archived'");
      if (bayId) { conditions.push("la.bay_id = ?"); binds.push(bayId); }
```

Notes:
- `j` is already the alias for the `jobs` JOIN in this query — confirm before editing.
- The existing backfill block earlier in the GET already excludes pickup jobs from auto-create; this change is the read-side guard for jobs whose method was changed to pickup AFTER an assignment already existed. **Delete nothing.**

---

## Change 2 — Bidirectional status: Loading & Loaded from the logistics dashboard

In `_worker.js/routes/jobs.js`, in the **shipments PUT** handler (the `method === "PUT"` block of the shipments handler — the one containing `SHIPMENT_TO_JOB_STATUS`, around line 800), make two edits.

### 2a — Map Loading/Loaded to job status

Current map:

```js
        const SHIPMENT_TO_JOB_STATUS = {
          not_started:   'not_started',
          in_production: 'in_production',
          ready_to_ship: 'done',
          awaiting:      'loading',
          in_transit:    'shipped',
          delivered:     'shipped',
        };
```

Add `loading` and `loaded`, both mapping to the job-level `'loading'` status (the jobs table uses the coarse `loading` status for any active loading stage):

```js
        const SHIPMENT_TO_JOB_STATUS = {
          not_started:   'not_started',
          in_production: 'in_production',
          ready_to_ship: 'done',
          awaiting:      'loading',
          loading:       'loading',
          loaded:        'loading',
          in_transit:    'shipped',
          delivered:     'shipped',
        };
```

### 2b — Mirror Loading/Loaded into loading_assignments

Current mirror block (only fires for in_transit/delivered):

```js
        // Mirror in_transit/delivered directly to loading_assignments (same pattern as driver QR flow)
        if (['in_transit', 'delivered'].includes(payload.status)) {
          try {
            const nowSync = new Date().toISOString();
            await db.prepare(
              "UPDATE loading_assignments SET loading_status = ?, updated_at = ? WHERE job_id = ? AND loading_status != 'archived'"
            ).bind(payload.status, nowSync, row.job_id).run();
          } catch (e) {
            console.error('Shipment→LoadingAssignment status sync failed:', e);
          }
        }
```

Widen the status list to include `loading` and `loaded`. Replace with:

```js
        // Mirror active loading-stage + transit statuses directly to loading_assignments
        // (same pattern as the driver QR flow). loading/loaded keep the cards in sync when a
        // manager advances status from the logistics dashboard instead of the loading board.
        if (['loading', 'loaded', 'in_transit', 'delivered'].includes(payload.status)) {
          try {
            const nowSync = new Date().toISOString();
            await db.prepare(
              "UPDATE loading_assignments SET loading_status = ?, updated_at = ? WHERE job_id = ? AND loading_status != 'archived'"
            ).bind(payload.status, nowSync, row.job_id).run();
          } catch (e) {
            console.error('Shipment→LoadingAssignment status sync failed:', e);
          }
        }
```

Leave the `ready_to_ship` re-queue block immediately below this UNCHANGED.

### Important constraints for Change 2
- The `loading_status` values written must be exactly `loading` and `loaded` (lowercase) — these are the existing values in `LD_STATUS_COLORS` and the loading board filters.
- Do NOT change the customer-pickup re-queue guard.
- Do NOT touch `routes/public.js` (the driver pickup path is a separate handler and stays untouched).
- The `awaiting` shipment status is not offered by the logistics modal `#f-status`; leave its mapping as-is.

---

## Verification (run before declaring done)
1. `node --check _worker.js/routes/loading.js`
2. `node --check _worker.js/routes/jobs.js`
3. Confirm each find/replace anchor matched exactly once (no duplicate blocks introduced).
4. Re-read the edited regions and confirm: the pickup condition references alias `j`; the two status structures contain the new keys; the mirror block list now has four statuses.

## What NOT to change
- No migration, no schema change.
- No frontend, no CSS.
- No new endpoints, no changes to GET response shape (still `{ ok, assignments }`).
- Driver QR / `routes/public.js`: untouched.
- The `STORAGE_KEY`, BOL rendering, load-builder, admin pages: untouched.

## Manual steps for Steve
- None. Deploy worker on `main`. No D1 console action required.
