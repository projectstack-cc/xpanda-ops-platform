# Prompt 193 — Cutting Dashboard: data model + worker automation (C1)

## Agent context (read first, in this order)
1. Read `AGENTS.md` (platform-wide rules).
2. Read `xpanda-ops-agents.md` (domain agents).
3. **You are acting as the `db-api-agent`** (lead), with cross-reference to the `job-board-agent`
   for the `jobs.processes` bidirectional sync. This is the backend half of the Cutting Dashboard
   feature; the frontend ships separately (P194). **Pull `main` and treat the repo as source of truth.**

## Goal
Stand up the data + automation layer that turns a job's checked Production Processes into live
cutting steps, and wires bidirectional status automation between the Cutting Dashboard and the
Job Board. No frontend in this prompt.

### Decisions already locked (do not reinterpret)
- **Step generation:** auto-reconcile `cutting_steps` from `jobs.processes` on **every job POST and PUT**
  (same philosophy as the existing `load_count` loading-assignment reconcile). When a process is
  **unchecked**, drop **only "safe" steps** — those still in `queued` (never started). Never delete a
  step that is `in_progress` or `completed`.
- **Step lifecycle:** `queued` → (job-level Start) `in_progress` → (per-step Complete) `completed`.
- **Job-level Start** lives on the Cutting Dashboard (P194) and calls this worker. Starting a job:
  flips `jobs.status` `not_started` → `in_production`, and sets all that job's `queued` steps → `in_progress`.
- **All steps completed** → flip `jobs.status` `in_production` → `done`.
- **Bidirectional pill sync (both directions, server-side):**
  - Completing a cutting step sets the matching `jobs.processes[].completed = true`.
  - Un-completing a step sets it back to `false`.
  - When the Job Board PUTs `processes` (pill toggle), mirror each `completed` flag onto the matching
    `cutting_steps.step_status` (`completed` ⇄ revert to `in_progress` if the job is already in
    production, else `queued`). Keep the two representations consistent in one transaction path.
- Process set is fixed: Cross Cutter, Hole Cutter, Main Line, Blue Line, Laminate (match the exact
  `name` strings already used in `jobs/index.html` `PROCESSES` and stored in `jobs.processes`).

## Files in scope
- **NEW** `DB_Migrations/add-cutting-steps.sql`  *(note: folder is `DB_Migrations/` with an underscore — verify with `ls`)*
- **NEW** `_worker.js/routes/cutting.js`
- `_worker.js/index.js`  (one `API_ROUTES` row + import)
- `_worker.js/lib/core.js`  (one `API_PERMISSION_MAP` row)
- `_worker.js/routes/jobs.js`  (reconcile on POST + PUT; Start/complete status automation; pill→step mirror)

Do **not** touch any frontend file, admin page, or `load-builder.html`.

## 1. Migration — `DB_Migrations/add-cutting-steps.sql`
Model on `DB_Migrations/loading-dashboard.sql`. Begin with the standard manual-step comment.

```sql
-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console BEFORE deploying the worker.

CREATE TABLE IF NOT EXISTS cutting_steps (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  process_name TEXT NOT NULL,           -- 'Cross Cutter' | 'Hole Cutter' | 'Main Line' | 'Blue Line' | 'Laminate'
  step_status TEXT NOT NULL DEFAULT 'queued',  -- queued | in_progress | completed
  operator TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  started_at TEXT DEFAULT NULL,
  completed_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_cutting_steps_job    ON cutting_steps(job_id);
CREATE INDEX IF NOT EXISTS idx_cutting_steps_status ON cutting_steps(step_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cutting_steps_job_process ON cutting_steps(job_id, process_name);
```
(The unique `(job_id, process_name)` index lets reconcile use `INSERT OR IGNORE`.)

**Deploy ordering note for Steve (include verbatim at the top of your output summary):**
Run `add-cutting-steps.sql` in the D1 console **before** deploying the worker. The worker references
`cutting_steps`; deploying first would 500 the cutting routes and the job reconcile.

## 2. `_worker.js/routes/cutting.js`
Follow the existing route module conventions (study `routes/loading.js` for shape: `json`/`error`
helpers from `lib/core.js`, `logActivity` on mutations, `X-User-Id` resolution where used).

Export `handleApiCutting(request, env)` covering `/api/cutting`:
- `GET /api/cutting` — board payload: all non-archived jobs that have ≥1 cutting step, each with its
  steps; include enough job fields for lane cards (`id, customer, invoice_number, po_number, ship_date,
  status, total_bdft`). Support a `?week=YYYY-MM-DD` style filter consistent with how `loading.js`/jobs
  filter by ship_date if practical; otherwise return all and let the frontend filter (P194 reuses the
  P190 client-side week/search pattern — confirm by reading `logistics/loading.html`).
- `PUT /api/cutting/:stepId` — update a single step's `step_status` (`in_progress`|`completed`),
  `operator`, or `notes`. Set `started_at`/`completed_at` timestamps on the appropriate transitions
  (mirror the timestamp pattern in `loading.js`). On `completed`/un-complete, call the shared sync
  helper (below) so the job's pill + job status stay consistent.
- `POST /api/cutting/start` (body `{ job_id }`) — job-level Start: set all that job's `queued` steps to
  `in_progress` (stamp `started_at`), and flip `jobs.status` `not_started` → `in_production`
  (only if currently `not_started`). `logActivity`.

Put the cross-cutting logic in small helpers so `jobs.js` can call them too, **or** export them:
- `reconcileCuttingSteps(db, jobId, processesArray)` — INSERT OR IGNORE a `queued` step per checked
  process; delete steps whose process is no longer checked **only when** `step_status = 'queued'`.
- `syncJobFromSteps(db, jobId)` — after any step change: if all of the job's steps are `completed`
  and there is ≥1 step, set `jobs.status` → `done` (only from `in_production`); if some step is
  `in_progress` and job is `not_started`, set → `in_production`. Never downgrade `loading`/`shipped`/`archived`.
- `applyStepCompletionToProcesses(db, jobId)` — recompute `jobs.processes[].completed` from the
  matching steps' `step_status` and persist (read-modify-write the JSON; reuse `safeJsonParse`).

Decide carefully whether the helpers live in `cutting.js` (exported) or a tiny `lib/cutting.js`.
Prefer exporting from `routes/cutting.js` unless `jobs.js` import creates a cycle — if it does, put the
three helpers in `_worker.js/lib/cutting.js` and import into both. Document which you chose.

## 3. `_worker.js/index.js`
Add the import alongside the other route imports, and **one** `API_ROUTES` row. Place it in the
"Jobs / shipments" or a new "Manufacturing" comment group, using a `prefix` (so `/api/cutting/...`
sub-routes dispatch):

Verify the anchor first:
```
grep -n "{ path:   '/api/shipments', handler:" _worker.js/index.js   # expect count 1
```
Insert after the shipments row:
```js
  { prefix: '/api/cutting',   handler: (req, env) => handleApiCutting(req, env) },
```
And add to the import block (anchor: the existing `from './routes/jobs.js';` line):
```js
import { handleApiCutting } from './routes/cutting.js';
```

## 4. `_worker.js/lib/core.js`
Add the API permission mapping (PATH map already has `/manufacturing/cutting-dashboard` →
`manufacturing.cutting`; do not duplicate that). Anchor on the existing combos line:
```
grep -nc "{ pattern: /^\\/api\\/combos/,            key: 'manufacturing.calculators' }," _worker.js/lib/core.js   # expect 1
```
Insert immediately after it:
```js
  { pattern: /^\/api\/cutting/,           key: 'manufacturing.cutting' },
```

## 5. `_worker.js/routes/jobs.js` — wire reconcile + automation
- **POST:** after the loading-assignment auto-create block and before the final
  `SELECT * FROM jobs WHERE id = ?`, call `reconcileCuttingSteps(db, id, payload.processes || [])`
  inside a try/catch (log-and-continue, like the loading block). Verify anchor:
  ```
  grep -n "Auto-create loading assignment on job create failed" _worker.js/routes/jobs.js   # count 1
  ```
- **PUT:** when `"processes" in payload`, after the row UPDATE succeeds, run **in this order** inside
  try/catch: `reconcileCuttingSteps(db, id, payload.processes)` then the pill→step mirror
  (`applyProcessesToSteps`-style) then `syncJobFromSteps(db, id)`. The existing `processes` set block is
  here — verify:
  ```
  grep -n "if (\"processes\" in payload)" _worker.js/routes/jobs.js   # count 1
  ```
  Do **not** change the existing `sets.push("processes = ?")` logic; add the reconcile/sync **after** the
  `UPDATE jobs ...` runs (so the JSON is persisted first), near where line-items are replaced.
- Leave the shipments `SHIPMENT_TO_JOB_STATUS` block untouched.

## Validation (required before producing output)
- `ls DB_Migrations/` to confirm the underscore folder name; place the `.sql` there.
- `node --check _worker.js/routes/cutting.js`
- `node --check _worker.js/routes/jobs.js`
- `node --check _worker.js/index.js`
- `node --check _worker.js/lib/core.js` (and `lib/cutting.js` if created)
- For every find/replace, run `grep -n` + `grep -c` and confirm `count == 1` before applying.

## Output
- Write all changed/new files. Summarize each change, the helper-location decision, and the
  **migration-first deploy note** for Steve at the top.
- Remind Steve this is worker-only; P194 builds the dashboard UI that consumes `/api/cutting`.
