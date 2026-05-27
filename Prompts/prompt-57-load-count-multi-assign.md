# Prompt 57 — Load Count Multi-Assignment

## Goal

Jobs with `load_count > 1` represent multi-trailer loads. Currently the loading dashboard creates one assignment per job regardless of `load_count`. This prompt changes the system so a single job can have up to `load_count` loading assignments — one per physical trailer. Each assignment tracks its own bay, status, and trailer number independently.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Context

- The `jobs` table has a `load_count` column (integer, defaults to 1). It represents how many trailers a job requires.
- The `loading_assignments` table currently has no concept of which load number an assignment represents.
- The GET handler for `/api/loading-assignments` auto-backfills orphan jobs (jobs in `done`/`loading`/`shipped` status with no loading assignment). The backfill currently inserts one assignment per job using a `NOT EXISTS` check.
- The POST handler creates one assignment and has no duplicate guard.

**New behavior:**
- A job with `load_count = 3` should generate 3 separate loading assignments, each tagged as Load 1, Load 2, Load 3.
- The loading card for each assignment shows "Load X of Y" when `load_count > 1`.
- The backfill creates `load_count` assignments per orphan job.
- The POST handler checks how many assignments already exist for a job and rejects the request if the limit is reached.

---

## Step 1 — Migration SQL

Create `DB Migrations/load-number.sql`:

```sql
-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.

-- Add load_number column to loading_assignments
ALTER TABLE loading_assignments ADD COLUMN load_number INTEGER NOT NULL DEFAULT 1;
```

**Important:** Existing assignments are all `load_number = 1` by default, which is correct — all existing jobs that made it to loading have a single assignment.

---

## Step 2 — Worker: update auto-backfill in GET handler

In `_worker.js`, find the orphan backfill block in `handleApiLoadingAssignments` GET (around line 4216):

```javascript
const orphanJobs = await db.prepare(`
  SELECT j.id FROM jobs j
  WHERE j.status IN ('done', 'loading', 'shipped')
  AND NOT EXISTS (SELECT 1 FROM loading_assignments la WHERE la.job_id = j.id)
`).all();
```

Replace the entire backfill block (from `const orphanJobs` through the closing `}` of the backfill try/catch) with:

```javascript
// Backfill: create loading assignments for jobs that don't have enough
const backfillJobs = await db.prepare(`
  SELECT j.id, j.load_count,
    (SELECT COUNT(*) FROM loading_assignments la WHERE la.job_id = j.id) AS existing_count
  FROM jobs j
  WHERE j.status IN ('done', 'loading', 'shipped')
  HAVING existing_count < MAX(j.load_count, 1)
`).all();
const backfill = backfillJobs.results || [];
if (backfill.length > 0) {
  const now = new Date().toISOString();
  for (const bj of backfill) {
    const targetCount = Math.max(bj.load_count || 1, 1);
    for (let n = bj.existing_count + 1; n <= targetCount; n++) {
      const laId = crypto.randomUUID();
      await db.prepare(`
        INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
        VALUES (?, ?, NULL, '', 'awaiting', NULL, '', ?, ?, ?)
      `).bind(laId, bj.id, n, now, now).run();
    }
  }
}
```

---

## Step 3 — Worker: update GET query to include `load_count`

In the main SELECT query for loading assignments (around line 4241), add `j.load_count` to the selected columns:

```sql
SELECT la.*, j.customer, j.invoice_number, j.po_number, j.ship_date, j.ship_to_company,
       j.ship_to_city, j.ship_to_state, j.carrier, j.method, j.load_count,
       lb.bay_number, lb.label as bay_label
FROM loading_assignments la
JOIN jobs j ON la.job_id = j.id
LEFT JOIN loading_bays lb ON la.bay_id = lb.id
```

---

## Step 4 — Worker: update POST handler with load count guard

In `handleApiLoadingAssignments` POST (around line 4263), after the `if (!payload.job_id)` check and before the INSERT:

```javascript
// Check load count limit
const job = await db.prepare("SELECT load_count FROM jobs WHERE id = ?").bind(payload.job_id).first();
if (!job) return json({ ok: false, error: 'Job not found.' }, 404);

const maxLoads = Math.max(job.load_count || 1, 1);
const existingCount = await db.prepare(
  "SELECT COUNT(*) as cnt FROM loading_assignments WHERE job_id = ?"
).bind(payload.job_id).first();

const currentCount = existingCount?.cnt || 0;
if (currentCount >= maxLoads) {
  return json({ ok: false, error: `This job already has ${currentCount} of ${maxLoads} load assignment(s).` }, 400);
}

const loadNumber = currentCount + 1;
```

Then update the INSERT statement to include `load_number`:

```javascript
await db.prepare(`
  INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).bind(id, payload.job_id, payload.bay_id || null, payload.trailer_number || '', loading_status,
        request.headers.get('X-User-Id') || null, payload.notes || '', loadNumber, now, now).run();
```

---

## Step 5 — Worker: update the shipment sync on POST

The existing shipment sync (after the INSERT) should still work — it syncs the status for any assignment creation. But note that when `load_count > 1`, the shipment status will get synced on each assignment creation. Since they all start at `awaiting`, this is fine — the shipment status reflects the most recent update.

No changes needed here.

---

## Step 6 — Frontend: show "Load X of Y" on cards

In `logistics/loading.html`, update `renderAssignmentCard()`. After the customer/invoice line, add a load indicator when `load_count > 1`:

Find this section in `renderAssignmentCard()`:

```javascript
<div class="ld-card-meta">
  ${a.invoice_number ? `<span>INV# ${esc(a.invoice_number)}</span>` : ''}
  ${a.trailer_number ? `<span>Trailer: ${esc(a.trailer_number)}</span>` : ''}
  ${a.ship_to_city ? `<span>${esc(a.ship_to_city)}${a.ship_to_state ? ', ' + esc(a.ship_to_state) : ''}</span>` : ''}
</div>
```

Add a load number indicator:

```javascript
<div class="ld-card-meta">
  ${a.invoice_number ? `<span>INV# ${esc(a.invoice_number)}</span>` : ''}
  ${(a.load_count || 1) > 1 ? `<span style="font-weight:700;color:#6366f1;">Load ${a.load_number || 1} of ${a.load_count}</span>` : ''}
  ${a.trailer_number ? `<span>Trailer: ${esc(a.trailer_number)}</span>` : ''}
  ${a.ship_to_city ? `<span>${esc(a.ship_to_city)}${a.ship_to_state ? ', ' + esc(a.ship_to_state) : ''}</span>` : ''}
</div>
```

---

## Step 7 — Frontend: update Pull Job modal availability

The "Pull Job to Loading" flow fetches available jobs. Currently, any job that already has a loading assignment disappears from the available list (because the backfill creates one automatically). With multi-load, a job with `load_count = 3` and only 1 existing assignment should still appear as available for additional pulls.

Find where the pull-job list filters available jobs. In the modal's job list rendering, it likely uses the `allAssignments` array to exclude already-assigned jobs. The simpler path is: the backfill in Step 2 already creates all needed assignments automatically, so managers don't need to manually pull multi-load jobs — they're auto-created.

**However**, if a manager manually creates a new assignment via the Pull Job modal, the POST guard (Step 4) prevents exceeding `load_count`. No frontend changes needed for the pull-job modal — the backfill handles multi-load creation automatically.

---

## What NOT to touch

- Do NOT modify `bol-shared.js`, `bol-generator.html`, or `load-builder.html`
- Do NOT modify `logistics/index.html` (logistics dashboard)
- Do NOT modify the loading assignment PUT handler (status changes)
- Do NOT modify the loading bay handlers
- Do NOT modify the checklist or photo features (if Prompt 56 has been applied)
- Do NOT change the status flow order
- Do NOT modify the jobs API or job board

---

## Completion checklist

- [ ] Migration SQL file created at `DB Migrations/load-number.sql`
- [ ] `_worker.js`: backfill creates `load_count` assignments per orphan job (not just 1)
- [ ] `_worker.js`: backfill counts existing assignments and only creates the missing ones
- [ ] `_worker.js`: GET query includes `j.load_count` in the SELECT
- [ ] `_worker.js`: POST handler checks existing assignment count vs `load_count` before INSERT
- [ ] `_worker.js`: POST handler sets `load_number` sequentially
- [ ] `_worker.js`: POST INSERT includes `load_number` column
- [ ] `loading.html`: card shows "Load X of Y" when `load_count > 1`
- [ ] Cards with `load_count = 1` show no load indicator (existing behavior preserved)
- [ ] Each assignment within a multi-load job has its own independent status, bay, and trailer number
- [ ] No console errors

**Notify Steve:** Run the migration SQL in the Cloudflare D1 Dashboard Console before deploying:
```sql
ALTER TABLE loading_assignments ADD COLUMN load_number INTEGER NOT NULL DEFAULT 1;
```

Test:
1. Create a job with `load_count = 1` → loading dashboard shows one card, no "Load X of Y" indicator
2. Create a job with `load_count = 3` → loading dashboard auto-creates 3 assignment cards, each showing "Load 1 of 3", "Load 2 of 3", "Load 3 of 3"
3. Each card can be independently assigned to a different bay
4. Each card can be independently advanced through the status flow
5. Try to manually pull the same 3-load job again → POST should reject with "already has 3 of 3"
6. Verify in D1 Console: `SELECT load_number FROM loading_assignments WHERE job_id = '...'` → values 1, 2, 3
7. Existing single-load assignments show `load_number = 1` and no UI indicator
