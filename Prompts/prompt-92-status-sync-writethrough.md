# P92 — Status sync: logistics dashboard change must propagate everywhere

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **db-api-agent** (lead), **logistics-agent**, and **job-board-agent**.

This system is in daily production use. Make the change **additive and reversible**. Do **not** introduce new status strings — map onto the existing lifecycle. **Depends on P91** (the customer-pickup exclusion) being applied first.

---

## Root cause (already traced)

There are three status stores: `jobs.status`, `shipments.status`, `loading_assignments.loading_status`. Sync today is **one-directional (job → shipment only)** and incomplete:

- In `handleApiJobs` PUT (`_worker.js` ~line 2140) a job status change maps via `JOB_TO_SHIPMENT_STATUS` (`not_started→not_started`, `in_production→in_production`, `done→ready_to_ship`) and updates the shipment. It does **not** handle `loading`/`shipped`, and it never touches `loading_assignments`.
- The logistics dashboard changes status through **`handleApiShipments`** PUT (`_worker.js` ~line 2880–2918), which updates **only** `shipments`. Nothing flows back to `jobs` or `loading_assignments` — that's the bug.

## Step 1 — Enumerate and REPORT before writing the fix

Produce a short report and pause for review:
- The exact shipment statuses the logistics dashboard exposes (see `SHIPMENT_STATUS_COLORS` in `logistics/index.html` ~line 459 and the status-label maps ~line 1496: `awaiting`, `not_started`, `in_production`, `ready_to_ship`, `in_transit`, `delivered`, `cancelled`).
- The `loading_assignments.loading_status` values in use (`awaiting`, `not_started`, `loading`, `loaded`, `in_transit`, `delivered`, `archived`).
- The job lifecycle (`not_started → in_production → done → loading → shipped`).
- Confirm every write path that mutates any of the three.

## Step 2 — Implement the reverse write-through in `handleApiShipments` PUT

After the existing `UPDATE shipments ...` (~line 2913), when `payload.status` is present and the shipment has a `job_id`, propagate the change through the **job as source of truth**, mirroring the existing job→shipment block's structure. Add the inverse map:

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
*(Confirm/adjust this map against your Step 1 report and include the final version in your summary so Steve can verify it against shop-floor expectations.)*

- Update `jobs.status` for the linked job when the mapped value differs.
- Update the linked `loading_assignments` `loading_status` to the corresponding stage so the loading dashboard reflects it (e.g. `in_transit`/`delivered` mirror straight through, as already done in the driver-QR flow at ~lines 5083/5166 — reuse that pattern, do not duplicate it).
- **Re-queue rule:** when a shipment is pulled back to **`ready_to_ship`**, move its card out of its current stage and back into the loading queue — set the job to `done` and the linked `loading_assignments.loading_status` back to `'awaiting'` (and clear `bay_id` if it was assigned). **Skip this for customer-pickup jobs** (`jobs.method = 'customer pickup'`) — per P91 they have no bay-queue card and must not gain one here.
- Wrap each cross-table update in its own `try/catch` with a `console.error` (match the existing sync blocks). Keep the existing `logActivity('update','shipment',...)` call.

The result: changing status on the logistics dashboard updates the job → the kanban card moves columns → the loading dashboard reflects it; pulling back to "ready to ship" returns the card to the loading queue (non-pickup jobs only).

---

## What NOT to change
- The auto-pack algorithm. The `STORAGE_KEY`. The BOL render path. Existing job line-item data.
- Do not add new status strings or rename existing ones. Do not remove the existing job→shipment sync — this adds the reverse direction alongside it.
