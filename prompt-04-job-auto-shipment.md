# Prompt 04 — Job Board: Auto-Generate Outbound Shipment on Job Creation

You are working inside the xPanda Operations Platform repository.
Follow all rules in AGENTS.md.

---

## Objective

When a new job is created (POST only, not edit/PUT), automatically create a corresponding outbound shipment record in the `shipments` table, pre-populated from the job's data. The shipment should be silently created in the background — no UI disruption to the job creation flow.

---

## Scope

**Files to modify:**

1. `_worker.js` — add auto-shipment creation inside the job POST handler
2. `/jobs/index.html` — add a small visual indicator on the kanban card for jobs that have a linked shipment

**Do NOT modify:**
- Any other file
- The job POST payload structure or response shape
- The shipments GET/PUT/DELETE handlers
- Any existing job board logic outside the card render

---

## Step 1 — `_worker.js` (Job POST handler)

After the job INSERT and line items INSERTs succeed, and **before** the final `return json(...)` response, insert a new outbound shipment record:

```js
// Auto-create outbound shipment
try {
  const shipmentId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO shipments
      (id, direction, job_id, customer, carrier, method, bol_number, origin,
       destination, ship_date, delivery_date, status, total_bdft, load_count,
       weight_lbs, bead_type, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    shipmentId, 'outbound', id,
    customer,
    carrier || '',
    method  || '',
    '',                     // bol_number — blank until BOL is generated
    'XPanda Foam',          // origin
    location || '',         // destination
    ship_date || '',
    '',                     // delivery_date
    'scheduled',            // default status
    total_bdft,
    load_count,
    0,                      // weight_lbs
    '',                     // bead_type
    '',                     // notes
  ).run();
} catch (e) {
  // Non-fatal — log but do not fail the job creation response
  console.error('Auto-shipment creation failed:', String(e?.message || e));
}
```

This must be wrapped in its own try/catch so a shipment failure never causes the job creation to fail.

---

## Step 2 — `/jobs/index.html` (Card indicator)

The kanban card render function (`renderBoard`) already checks `job.packing_slip_filename` for the 📄 slip icon. Add a similar indicator for jobs that have a linked shipment.

### How to detect

The job object returned from the API does not currently include shipment data. The simplest approach: add a `has_shipment` flag to the job POST response.

In `_worker.js`, after the auto-shipment INSERT, set a flag on the returned job object:

```js
const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first();
// ...existing code...
return json({ ok: true, message: 'Job created.', job: { ...job, has_shipment: true, processes: ..., line_items: ... } }, 201);
```

For the GET `/api/jobs` response, join to check for an existing shipment:

In `handleApiJobs` GET handler, modify the SELECT to include a shipment existence check:

```sql
SELECT j.*,
  CASE WHEN EXISTS (
    SELECT 1 FROM shipments s WHERE s.job_id = j.id AND s.direction = 'outbound'
  ) THEN 1 ELSE 0 END AS has_shipment
FROM jobs j
```

Update this query only — do not change any other part of the GET handler.

### Card render

In the card render in `/jobs/index.html`, add a small 🚚 indicator next to the existing slip icon when `job.has_shipment` is truthy:

```js
const shipmentIcon = job.has_shipment
  ? ` <span class="jobs-card-shipment" title="Outbound shipment record exists">🚚</span>`
  : '';
```

Add it in the `jobs-card-customer` line alongside `slipIcon`:

```js
<div class="jobs-card-customer">${esc(job.customer)}${slipIcon}${shipmentIcon}</div>
```

Add a minimal CSS class for it — match the existing `.jobs-card-slip` style:

```css
.jobs-card-shipment { font-size: 11px; opacity: 0.7; margin-left: 3px; vertical-align: middle; }
```

---

## Constraints

- The auto-shipment creation must be non-fatal (wrapped in try/catch)
- Do NOT auto-create a shipment on job PUT/edit — new jobs only
- Do NOT modify the shipments modal, logistics dashboard, or any logistics files
- Do NOT change the job response shape beyond adding `has_shipment`
- Preserve all existing job board behavior

---

## Completion

Notify me when done. No migration required (all existing schema columns are used).
