# Prompt NNN — Fix "Pull Job" on Loading Dashboard: adopt existing awaiting assignment instead of erroring

## Agent context (read first)
- Read **both** `AGENTS.md` and `xpanda-ops-agents.md` before touching anything.
- You are acting as the **Database & API Agent (§9)** with **Logistics Agent (§3)** as the domain owner. Stay inside the loading worker route. Do **not** touch the React migration surface (`cutting-pilot/`, `/v2/*`) — that is being worked in parallel.

## Problem
On the Loading Dashboard, the **"+ Pull Job"** modal lets a manager pick a job and assign it a bay (mobile-friendly flow). It currently **always fails** with an error like *"This job already has 1 of 1 load assignment(s)."*

Root cause: job creation (`_worker.js/routes/jobs.js`, ~line 337) **auto-creates** `loading_assignments` rows with `loading_status = 'awaiting'` for every non-pickup job at the moment the job is created. So by the time a user opens "Pull Job," the job is already at its full `load_count` of assignments sitting in the awaiting queue. The POST handler in `_worker.js/routes/loading.js` then hits its `currentCount >= maxLoads` guard and rejects what it thinks is a brand-new assignment.

The user isn't trying to mint a new load — they're trying to **give a bay to a load that already exists in the awaiting queue.**

## Fix (worker only — `_worker.js/routes/loading.js`, POST handler)
When the job is already at its assignment cap **and** a `bay_id` was supplied, instead of erroring, **adopt an existing unbayed `'awaiting'` assignment** for that job: assign it the bay and flip its status to `not_started`. Only error when there is genuinely no awaiting card left to place.

Behavior matrix:
- Under cap → create a new assignment (existing behavior, unchanged).
- At cap, `bay_id` supplied, an unbayed `'awaiting'` card exists → **adopt it**: set `bay_id` + `loading_status = 'not_started'`, return that card's id.
- At cap, no unbayed `'awaiting'` card exists → error **"All loads for this job already have bays assigned."** (400).
- At cap, **no** `bay_id` supplied (awaiting-queue pull with no bay) → keep current error (nothing to do; the job is already in the queue).

### Anchor (verified unique — `grep -c` returns 1)
Replace this block:

```js
    const currentCount = existingCountRow?.cnt || 0;
    if (currentCount >= maxLoads) {
      return json({ ok: false, error: `This job already has ${currentCount} of ${maxLoads} load assignment(s).` }, 400);
    }
```

With:

```js
    const currentCount = existingCountRow?.cnt || 0;
    if (currentCount >= maxLoads) {
      // Job is already at its load_count of assignments (auto-created at job creation
      // as 'awaiting' cards). If the user supplied a bay, adopt an existing unbayed
      // awaiting card and place it in that bay rather than rejecting the request.
      if (payload.bay_id) {
        const adoptable = await db.prepare(
          "SELECT id FROM loading_assignments WHERE job_id = ? AND loading_status = 'awaiting' AND (bay_id IS NULL OR bay_id = '') ORDER BY load_number ASC LIMIT 1"
        ).bind(payload.job_id).first();

        if (adoptable) {
          const nowAdopt = new Date().toISOString();
          await db.prepare(
            "UPDATE loading_assignments SET bay_id = ?, loading_status = 'not_started', updated_at = ? WHERE id = ?"
          ).bind(payload.bay_id, nowAdopt, adoptable.id).run();

          // Sync the adopted card's new status to the linked outbound shipment.
          try {
            const shipment = await db.prepare(
              "SELECT id FROM shipments WHERE job_id = ? AND direction = 'outbound' LIMIT 1"
            ).bind(payload.job_id).first();
            if (shipment) {
              await db.prepare(
                "UPDATE shipments SET status = 'not_started', updated_at = datetime('now') WHERE id = ?"
              ).bind(shipment.id).run();
            }
          } catch (e) {
            console.error('Shipment status sync on assignment adoption failed:', e);
          }

          await logActivity(db, 'update', 'loading_assignment', adoptable.id,
            'Pulled job to loading bay (adopted awaiting card)', { job_id: payload.job_id, bay_id: payload.bay_id },
            request.headers.get('X-User-Id'));
          return json({ ok: true, id: adoptable.id, adopted: true }, 200);
        }

        return json({ ok: false, error: 'All loads for this job already have bays assigned.' }, 400);
      }

      return json({ ok: false, error: `This job already has ${currentCount} of ${maxLoads} load assignment(s).` }, 400);
    }
```

## Constraints
- **Worker only.** Do not modify `logistics/loading.html` — the frontend already POSTs `{ job_id, bay_id }` and surfaces `data.error`. Confirm this is true; if the frontend needs a one-line change to display the `adopted` path, note it but do not invent new UI.
- Do **not** touch the auto-create block in `routes/jobs.js` or the P143 `load_count` reconcile logic.
- Do **not** change the under-cap create path, the notification dispatch, or the existing shipment-sync block below the guard.
- No migration — `loading_assignments` already has `bay_id`, `loading_status`, `updated_at`, `load_number`.
- Use `logActivity(...)` for the adoption (already imported in this file — verify).

## Verify before declaring done
- `grep -c "if (currentCount >= maxLoads) {"` in `_worker.js/routes/loading.js` is exactly 1 before editing.
- `node --check` the worker route: extract the file to a temp `.js` and run `node --check /tmp/loading.js` (do **not** pipe via `/dev/stdin`). Must pass.
- Confirm `logActivity` and `json` are already imported at the top of `routes/loading.js`.

## BACKLOG / CHANGELOG (same commit)
- **CHANGELOG.md** → add under **## Logistics** (newest first), keyed `**PNNN**`:
  > **PNNN** — Fix Loading Dashboard "Pull Job": jobs auto-create `awaiting` loading cards at creation, so the Pull-Job POST always tripped the `currentCount >= maxLoads` guard ("all loads assigned"). POST handler now, when a job is at its load cap **and** a `bay_id` is supplied, adopts an existing unbayed `awaiting` card (sets bay + `not_started`, syncs shipment) instead of erroring; errors clearly with "All loads for this job already have bays assigned." only when no awaiting card remains. Awaiting-queue pulls with no bay keep the prior message. Worker-only (`_worker.js/routes/loading.js`); no migration, no frontend change.
- **BACKLOG.md** → no open item to remove (this was an unfiled bug); nothing to add unless the frontend `adopted`-path note above turns into follow-on work.

## Commit
One file, one commit: `_worker.js/routes/loading.js` (+ `CHANGELOG.md`). Message: `PNNN: Pull Job adopts existing awaiting loading assignment instead of erroring`.
