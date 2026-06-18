# Prompt NNN — Fix `/api/jobs` 500 (too many SQL variables)

> **Type:** Worker bug fix, single file: `_worker.js/routes/jobs.js`. No migration, no schema change, no frontend change.
> **Severity:** Production-down — breaks the logistics dashboard INV# display and the Orders report (both consume the `/api/jobs` list endpoint).
> **Prompt number:** Steve assigns. Replace `NNN` in the filename before running.

## 0. Required reading (do this first)

1. **Pull the repo** (`git pull` on `main`).
2. Read **`AGENTS.md`** and **`xpanda-ops-agents.md`** in full.
3. Assume the **Database & API Agent** (`xpanda-ops-agents.md` §9) — this is a worker/data-layer fix. Note the downstream consumers it serves: logistics dashboard (`logistics/index.html` `allOpenJobs`), Orders report (`reports/orders/index.html`), and the Job Board list (`jobs/index.html`).

## 1. Root cause (confirmed)

The GET list handler in `_worker.js/routes/jobs.js` returns:

```
D1_ERROR: too many SQL variables at offset 246: SQLITE_ERROR
```

It is **not** the main jobs query (the `include_archived` path binds zero parameters; the status path binds ≤5). The failure is the **batch line-items fetch** immediately after the main query: it builds a single `WHERE job_id IN (?, ?, …)` with **one bound parameter per returned job** and binds all job ids at once. D1 caps the number of bound parameters per statement; once the returned-job count grew past that cap (rollout volume), the statement errors. Single-job GET is unaffected because it binds one id.

## 2. The fix — chunk the id list

In the GET list handler, locate this exact block (the batch line-items fetch):

```js
      // Batch-fetch line items for all returned jobs
      const lineItemsMap = {};
      if (jobs.length > 0) {
        const ids = jobs.map(j => j.id);
        const ph  = ids.map(() => "?").join(",");
        const liResult = await db
          .prepare(`SELECT * FROM job_line_items WHERE job_id IN (${ph}) ORDER BY job_id, sort_order ASC`)
          .bind(...ids)
          .all();
        for (const item of (liResult.results || [])) {
          if (!lineItemsMap[item.job_id]) lineItemsMap[item.job_id] = [];
          lineItemsMap[item.job_id].push(item);
        }
      }
```

Replace it with a chunked version that keeps each statement well under the D1 bound-parameter cap:

```js
      // Batch-fetch line items for all returned jobs.
      // D1 caps bound parameters per statement, so chunk the id list. A single
      // IN (?, ?, …) with one ? per job 500'd ("too many SQL variables") once
      // the job count grew past the cap.
      const lineItemsMap = {};
      if (jobs.length > 0) {
        const ids = jobs.map(j => j.id);
        const CHUNK = 90;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const slice = ids.slice(i, i + CHUNK);
          const ph    = slice.map(() => "?").join(",");
          const liResult = await db
            .prepare(`SELECT * FROM job_line_items WHERE job_id IN (${ph}) ORDER BY job_id, sort_order ASC`)
            .bind(...slice)
            .all();
          for (const item of (liResult.results || [])) {
            if (!lineItemsMap[item.job_id]) lineItemsMap[item.job_id] = [];
            lineItemsMap[item.job_id].push(item);
          }
        }
      }
```

Behavior is identical for small result sets; large sets now succeed across multiple statements. Per-job item ordering is preserved (each job's items are fetched whole within one chunk, ordered by `sort_order`).

## 3. Scope fences

- **Only** the batch line-items block in the GET list handler changes. Do **not** touch `JOB_LIST_COLS`, the main query branches, the single-job GET, the POST/PUT/DELETE handlers, or any other route file.
- No migration, no schema change, no frontend change. The logistics INV# display and Orders report recover automatically once the endpoint returns 200.
- Leave the `CHUNK` value at 90.

## 4. Find/replace discipline

- Work on a `/tmp` copy first.
- The find block must match the live file byte-for-byte and verify `count == 1` via Python `.count()` before applying. If it doesn't match (whitespace/comment drift), re-read the live handler and adjust the find block to the actual bytes — do not guess.
- Extract the inline question doesn't apply (pure `.js` file). Run **`node --check _worker.js/routes/jobs.js`** after the edit.

## 5. Deliverable & report

- Modified `_worker.js/routes/jobs.js` (one block).
- `node --check` passes.
- Report confirms: no other handler/file/query touched; no migration.
- After deploy, verify `/api/jobs?status=not_started,in_production,done,loading,shipped` and `/api/jobs?include_archived=1` both return 200, and the logistics board shows INV# again.
