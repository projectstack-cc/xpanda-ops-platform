# P143 — Load Count → Loading Card Reconcile

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. This task is **db-api-agent** only,
in `_worker.js/routes/jobs.js`. No migration. No frontend.

## Goal
Editing `jobs.load_count` currently writes the column but never reconciles
`loading_assignments`, so the loading-dashboard card count drifts from the job's load count. Add
reconcile to the job PUT:
- **Increase:** insert `(target − current)` new `awaiting` cards (mirror the create-time INSERT shape exactly).
- **Decrease:** delete only **surplus, safe** cards — `bay_id IS NULL` AND empty `trailer_number`
  AND `loading_status = 'awaiting'` AND no loading photos. **Never** delete a card with a bay,
  trailer, or photos. If there aren't enough safe cards to reach the target, delete only what's
  safe and leave the rest (the count won't go below committed work — that's intended).
- **Customer-pickup jobs** have no bay-queue cards (create-time skips them) — skip reconcile too.

`current` counts non-archived assignments. This pairs with the create-time loop and the loading
GET top-up backfill (which only *adds*, never removes) — this PUT becomes the authoritative
decrease path.

## File
- `_worker.js/routes/jobs.js` — 1 insertion in the PUT handler, after line-items replace and
  before the post-update `SELECT * FROM jobs`.

---

### Edit — insert reconcile block

FIND (count == 1):
```
      }

      const job    = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first();
      const liRows = await db.prepare("SELECT * FROM job_line_items WHERE job_id = ? ORDER BY sort_order ASC").bind(id).all();
```

REPLACE:
```
      }

      // Reconcile loading_assignments to the new load_count (only when load_count changed).
      if ("load_count" in payload) {
        try {
          const reconRow = await db.prepare("SELECT load_count, method FROM jobs WHERE id = ?").bind(id).first();
          const isPickup = (reconRow?.method || '').toLowerCase() === 'customer pickup';
          if (reconRow && !isPickup) {
            const target  = Math.max(Number(reconRow.load_count) || 1, 1);
            const curRow  = await db.prepare(
              "SELECT COUNT(*) AS cnt FROM loading_assignments WHERE job_id = ? AND loading_status != 'archived'"
            ).bind(id).first();
            const current = Number(curRow?.cnt || 0);

            if (target > current) {
              const nowR = new Date().toISOString();
              for (let n = current + 1; n <= target; n++) {
                await db.prepare(`
                  INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
                  VALUES (?, ?, NULL, '', 'awaiting', NULL, '', ?, ?, ?)
                `).bind(crypto.randomUUID(), id, n, nowR, nowR).run();
              }
            } else if (target < current) {
              // Drop only surplus, safe cards: unbayed, untrailered, awaiting, no photos.
              const surplus = current - target;
              const safe = await db.prepare(`
                SELECT la.id FROM loading_assignments la
                 WHERE la.job_id = ?
                   AND la.loading_status = 'awaiting'
                   AND la.bay_id IS NULL
                   AND COALESCE(la.trailer_number, '') = ''
                   AND NOT EXISTS (SELECT 1 FROM loading_photos lp WHERE lp.assignment_id = la.id)
                 ORDER BY la.load_number DESC, la.created_at DESC
                 LIMIT ?
              `).bind(id, surplus).all();
              for (const r of (safe?.results || [])) {
                await db.prepare("DELETE FROM loading_assignments WHERE id = ?").bind(r.id).run();
              }
            }
          }
        } catch (e) {
          console.error('Load count reconcile failed:', String(e?.message || e));
        }
      }

      const job    = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first();
      const liRows = await db.prepare("SELECT * FROM job_line_items WHERE job_id = ? ORDER BY sort_order ASC").bind(id).all();
```

---

## Verify before applying
- FIND confirmed `count == 1`.
- **Confirm the loading-photos FK column name.** This block assumes `loading_photos.assignment_id`.
  Grep the real column (`grep -n "assignment_id\|loading_assignment_id\|CREATE TABLE loading_photos" DB_Migrations/*.sql _worker.js/routes/loading.js`). If it differs, fix the `NOT EXISTS` subquery to match the actual column **before** applying. Do not guess.
- `cp _worker.js/routes/jobs.js /tmp/jobs.mjs && node --check /tmp/jobs.mjs`

## What NOT to change
- Do NOT alter the create-time assignment loop or the loading GET top-up backfill.
- Do NOT delete any card with a bay, trailer, photos, or any non-`awaiting` status.
- Do NOT add a migration.
- Do NOT touch the auto-pack algorithm, `STORAGE_KEY`, or load-builder.

## Deploy
```
git add _worker.js/routes/jobs.js
git commit -m "P143: reconcile loading_assignments to load_count on job PUT (add awaiting cards up; drop only surplus safe cards down)"
git push
```
