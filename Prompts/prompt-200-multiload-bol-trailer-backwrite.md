# P200 — Multi-load BOL trailer back-write (match by load_number)

**Agent:** db-api-agent (you own `_worker.js/routes/*.js`).
**Read first:** `AGENTS.md` and `xpanda-ops-agents.md`. Operate as the **Database & API Agent**.

## Context (do not skip)

Yesterday's commit `771b634` ("Fix multi-load BOL trailer numbers not propagating") added a
generation-time prefill in `logistics/index.html` (`openBolModalForJob` stamps `td.trailerNo` from
the job's loading assignments) and changed `bol-compose.js` to save `trailer_no: td.trailerNo`.

That prefill is **correct and stays untouched**. The real-world break is elsewhere: trailers are
entered on the loading dashboard cards *after* the BOL is generated, so at generation time the
assignment `trailer_number` is empty and the BOL saves blank. The only mechanism that stamps the
trailer later is the **P144 back-write** in `_worker.js/routes/loading.js`, and it is gated to
`bolCount === 1`, so **multi-load jobs never get a trailer back-written** — they render blank.

`bols` already carries `load_number` (P170; persisted by the BOL POST in `routes/bols.js`, lines
408/425). Loading assignments carry `load_number` (set on both the backfill GET path and the POST
path). So the back-write can target the matching per-load BOL instead of bailing on multi-BOL jobs.

## Scope — ONE file

Edit **only** `_worker.js/routes/loading.js`. **No migration. No frontend change. Do not touch the
prefill, `bol-compose.js`, or `bols.js`.**

## The change

In the `PUT` handler of `handleApiLoadingAssignments`, replace the trailer→BOL back-write block.

**Find (verified unique — `grep -c` returns 1; anchor on the comment + gated update):**

```js
      // Back-write the assigned trailer onto the job's BOL (only when the trailer changed and the
      // job has exactly one BOL — multi-BOL jobs are skipped; that's the multi-trailer item).
      // Note: a manual trailer override in the BOL editor (render_overrides.trailerNo) will shadow
      // this field at render time; that is acceptable and rare.
      if (payload.trailer_number !== undefined &&
          String(payload.trailer_number) !== String(existing.trailer_number || '')) {
        try {
          const bolCount = await db.prepare(
            "SELECT COUNT(*) AS cnt FROM bols WHERE job_id = ?"
          ).bind(existing.job_id).first();
          if (Number(bolCount?.cnt || 0) === 1) {
            await db.prepare(
              "UPDATE bols SET trailer_no = ? WHERE job_id = ?"
            ).bind(String(payload.trailer_number), existing.job_id).run();
            await logActivity(db, 'update', 'bol', existing.job_id,
              `Trailer # propagated to BOL: ${String(payload.trailer_number)}`,
              { job_id: existing.job_id },
              request.headers.get('X-User-Id'));
          }
        } catch (e) {
          console.error('Trailer→BOL back-write failed:', String(e?.message || e));
        }
      }
```

**Replace with:**

```js
      // Back-write the assigned trailer onto the matching BOL for this load. Each loading
      // assignment maps 1:1 to a BOL via load_number (P170), so multi-load jobs now propagate
      // the trailer to its own load's BOL instead of being skipped (the multi-trailer fix).
      // Fallback: a legacy single-BOL job whose BOL predates load_number (NULL) is updated by
      // job_id, but ONLY when the job has exactly one BOL — never blanket-stamp a multi-BOL job.
      // Note: a manual trailer override in the BOL editor (render_overrides.trailerNo) will shadow
      // this field at render time; that is acceptable and rare.
      if (payload.trailer_number !== undefined &&
          String(payload.trailer_number) !== String(existing.trailer_number || '')) {
        try {
          let propagated = false;
          if (existing.load_number != null) {
            const r = await db.prepare(
              "UPDATE bols SET trailer_no = ? WHERE job_id = ? AND load_number = ?"
            ).bind(String(payload.trailer_number), existing.job_id, existing.load_number).run();
            propagated = Number(r?.meta?.changes || 0) > 0;
          }
          if (!propagated) {
            const bolCount = await db.prepare(
              "SELECT COUNT(*) AS cnt FROM bols WHERE job_id = ?"
            ).bind(existing.job_id).first();
            if (Number(bolCount?.cnt || 0) === 1) {
              await db.prepare(
                "UPDATE bols SET trailer_no = ? WHERE job_id = ?"
              ).bind(String(payload.trailer_number), existing.job_id).run();
              propagated = true;
            }
          }
          if (propagated) {
            await logActivity(db, 'update', 'bol', existing.job_id,
              `Trailer # propagated to BOL: ${String(payload.trailer_number)}`,
              { job_id: existing.job_id, load_number: existing.load_number ?? null },
              request.headers.get('X-User-Id'));
          }
        } catch (e) {
          console.error('Trailer→BOL back-write failed:', String(e?.message || e));
        }
      }
```

## What NOT to change

- Do **not** alter the prefill in `logistics/index.html` or the `trailer_no: td.trailerNo` save in `bol-compose.js`.
- Do **not** change the trailer-lock guard (`in_transit`/`delivered`/`archived` 409) earlier in the PUT.
- Do **not** add a migration — `bols.load_number` already exists.
- Do **not** touch the `loading_bays` PUT (`handleApiLoadingBays`) — its `trailer_number` is bay-level, unrelated.

## Validation (required before commit)

- `node --check _worker.js/routes/loading.js`
- Confirm the old `UPDATE bols SET trailer_no = ? WHERE job_id = ?` blanket update now appears **only inside the `if (!propagated)` fallback** — `grep -n "UPDATE bols SET trailer_no" _worker.js/routes/loading.js` should show two statements (the new `AND load_number = ?` one and the fallback).
- Confirm `existing` is still fetched via `SELECT * FROM loading_assignments` (so `existing.load_number` is present).

## Manual steps for Steve

- None. No migration. Deploy worker (`main` → live).
- After deploy: on a multi-load job, set a trailer on each loading card, then View BOL — each load's copy shows its own trailer. Single-load and legacy single-BOL jobs unchanged.
