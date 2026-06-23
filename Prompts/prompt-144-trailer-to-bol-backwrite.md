# P144 — Trailer # → BOL Back-Write

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. This task is **db-api-agent** only,
in `_worker.js/routes/loading.js`. No migration. No frontend.

## Goal
The trailer is assigned on the loading dashboard **after** the BOL is drafted, so the BOL's
`trailer_no` is blank. When a trailer number is set/changed on a loading assignment, back-write it
onto the job's BOL so it appears on the rendered BOL.

This works because the BOL is **re-rendered from its stored fields** on view/download
(`BolShared.generatePdf([bol], { previewOnly:true })` in `loading.html`) — there is no frozen PDF —
so updating `bols.trailer_no` surfaces immediately on next view.

### Scope guard (important)
`bols` links to a job only by `job_id`; there is **no per-trailer link**. Back-write **only when the
job has exactly one BOL**. If the job has zero BOLs, do nothing. If it has multiple (multi-trailer
job), **skip silently** — trailer↔BOL matching for multi-trailer jobs is the separate
`bol-generator.html` multi-trailer backlog item and must not be guessed here.

## File
- `_worker.js/routes/loading.js` — 1 insertion in the assignment PUT, after the successful UPDATE,
  before `return json({ ok: true });`.

---

### Edit — back-write trailer to single linked BOL

FIND (count == 1):
```
      if (payload.location === 'yard') {
        await logActivity(db, 'update', 'loading_assignment', id,
          'Moved to yard',
          { job_id: existing.job_id },
          request.headers.get('X-User-Id'));
      }
      return json({ ok: true });
```

REPLACE:
```
      if (payload.location === 'yard') {
        await logActivity(db, 'update', 'loading_assignment', id,
          'Moved to yard',
          { job_id: existing.job_id },
          request.headers.get('X-User-Id'));
      }

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

      return json({ ok: true });
```

---

## Verify before applying
- FIND confirmed `count == 1`.
- **Confirm `bols.trailer_no` is the column name** (not `trailer_number`) — it is referenced in
  `_worker.js/routes/bols.js` INSERT/UPDATE; re-confirm before applying.
- `cp _worker.js/routes/loading.js /tmp/loading.mjs && node --check /tmp/loading.mjs`
- Sanity test: draft a BOL for a single-load job, assign a trailer on the loading dashboard, then
  View BOL from the loading card — trailer # should now render.

## What NOT to change
- Do NOT back-write when the job has 0 or >1 BOLs.
- Do NOT modify `bol-shared.js`, `bol-compose.js`, or BOL coordinates.
- Do NOT add a migration; `bols.trailer_no` already exists.
- Do NOT touch the auto-pack algorithm, `STORAGE_KEY`, or load-builder.

## Deploy
```
git add _worker.js/routes/loading.js
git commit -m "P144: back-write assigned trailer onto single-BOL job's bols.trailer_no on trailer set"
git push
```
