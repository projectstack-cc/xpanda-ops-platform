# P91 — Fix delete-job (orphaned children) + Customer Pickup bay-queue exclusion

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **db-api-agent** (lead) and **job-board-agent**, with **logistics-agent** awareness for Task B's dashboard visibility.

Two surgical backend fixes in `_worker.js`. **No migration required for either** (the `jobs.method` field already exists). Confirm the root cause in code before editing — do not rewrite the handlers.

---

## Task A — Delete job not working (BUG)

**Root cause (already traced):** the frontend is correct — `deleteJob()` in `jobs/index.html` (~line 1678) sends `{ id }` in the DELETE body, which matches the handler. The bug is in the DELETE branch of **`handleApiJobs`** in `_worker.js` (~lines 2213–2232). It only cleans `job_line_items` before deleting the job:

```js
await db.prepare("DELETE FROM job_line_items WHERE job_id = ?").bind(id).run();
await db.prepare("DELETE FROM jobs WHERE id = ?").bind(id).run();
```

But every job now auto-creates child rows that reference `job_id`:
- an outbound `shipments` row (auto-created on job create, ~line 1990)
- one or more `loading_assignments` rows (auto-created on job create, ~line 2021)
- potentially `loading_photos` rows (FK `job_id`)

Those children are never removed, so the delete either fails on a foreign-key constraint or leaves orphaned ghost rows that keep surfacing on the logistics/loading dashboards.

**Fix:** before `DELETE FROM jobs`, enumerate every table with a `job_id` column and delete its rows for this job, in child→parent order, inside the existing `try`. Known tables to clean: `job_line_items` (already done), `shipments`, `loading_assignments`, `loading_photos`. **Also scan the repo/migrations for any other `job_id`-referencing tables** (e.g. `bols`, `saved_loads`, `packing_slips`) and include any that exist; do not assume my list is exhaustive. Keep the existing `logActivity('delete', 'job', ...)` call and surface real errors to the frontend (the handler already returns `detail` on 500 — keep that).

Do not enable/disable global PRAGMA foreign_keys and do not alter table constraints — explicit cleanup in the handler is the pattern this codebase already uses.

## Task B — Customer Pickup must not create a bay-queue card

**Field:** `jobs.method`, value `'customer pickup'` (lowercase — see the `<select id="f-method">` in `jobs/index.html` ~line 302). Note the logistics dashboard uses a differently-cased `"Customer Pickup"` on `shipments.method`; the authoritative filter for this task is **`jobs.method = 'customer pickup'`**.

Loading assignments are auto-created in two places — guard **both** so pickups never enter the bay queue:

1. **Job-create loop** in `handleApiJobs` (~line 2021): wrap the `loading_assignments` insert loop so it is skipped when the job's `method === 'customer pickup'`. (The auto-created **shipment** just above it must still run — pickups SHOULD appear on the logistics dashboard.)

2. **Backfill query** in the loading endpoint (~line 4306): add `AND j.method != 'customer pickup'` to the `WHERE` clause that selects jobs needing assignments:
   ```sql
   WHERE j.status IN ('done', 'loading', 'shipped')
     AND j.method != 'customer pickup'
     AND (SELECT COUNT(*) FROM loading_assignments la WHERE la.job_id = j.id) < ...
   ```

Net effect: customer-pickup jobs get an outbound shipment (visible on `logistics/index.html`) but no `loading_assignments` row, so they never populate the bay queue on `loading.html`.

> Optional, mention to Steve only — don't auto-run: existing pickup jobs may already have stale `loading_assignments` from before this fix. A one-line cleanup (`DELETE FROM loading_assignments WHERE job_id IN (SELECT id FROM jobs WHERE method='customer pickup')`) could be run manually in the D1 console if ghost pickup cards appear. Do not include this in code.

---

## What NOT to change
- The auto-pack algorithm. The `STORAGE_KEY`. The parts table. The auto-shipment creation (pickups need it). Unrelated routes. The status enum (that's P92).
