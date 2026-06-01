# Prompt 62 — Logistics Dashboard: Complete Modal Rebuild + Data Migration

## Goal

Three things are broken on the logistics dashboard:

1. The edit modal still has the old minimalist shipment fields — no ship-to address, no PO, no invoice, no delivery time, no contact info. It needs to mirror the job entry form.
2. `awaiting` status still appears everywhere — status dropdown, filter dropdown, clearForm default. It needs to be eliminated. The status flow is: `not_started` → `in_production` → `ready_to_ship` → `loading` → `loaded` → `in_transit` → `delivered`.
3. Existing shipment records in the database still have `status = 'awaiting'` from before Prompt 59. They need to be updated to reflect their linked job's actual status.
4. The Build Load / Generate BOL action buttons only show for `ready_to_ship` and later — they should show for ALL job-linked shipments regardless of status.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Step 1 — Migration: fix existing shipment statuses

Create `DB Migrations/fix-shipment-statuses.sql`:

```sql
-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.

-- Update all outbound shipments that are still 'awaiting' to match their linked job's status.
-- Jobs at 'not_started' → shipment 'not_started'
-- Jobs at 'in_production' → shipment 'in_production'
-- Jobs at 'done' or 'loading' or 'shipped' → shipment 'ready_to_ship'
UPDATE shipments SET status = 'not_started', updated_at = datetime('now')
WHERE status = 'awaiting' AND direction = 'outbound'
AND job_id IN (SELECT id FROM jobs WHERE status = 'not_started');

UPDATE shipments SET status = 'in_production', updated_at = datetime('now')
WHERE status = 'awaiting' AND direction = 'outbound'
AND job_id IN (SELECT id FROM jobs WHERE status = 'in_production');

UPDATE shipments SET status = 'ready_to_ship', updated_at = datetime('now')
WHERE status = 'awaiting' AND direction = 'outbound'
AND job_id IN (SELECT id FROM jobs WHERE status IN ('done', 'loading', 'shipped'));

-- Any remaining 'awaiting' outbound shipments without a linked job → set to 'not_started'
UPDATE shipments SET status = 'not_started', updated_at = datetime('now')
WHERE status = 'awaiting' AND direction = 'outbound';
```

---

## Step 2 — Replace the outbound modal fields

In `logistics/index.html`, find the outbound-specific section (the `<div id="outbound-fields">` block, around lines 218–253). Replace the ENTIRE block from `<!-- Outbound-specific -->` through the closing `</div>` of `outbound-fields` with:

```html
<!-- Outbound-specific -->
<div class="logistics-field-section" id="outbound-fields">
  <div class="logistics-field-section-label">Customer &amp; Order</div>

  <div class="logistics-field">
    <label>Customer <span style="color:#dc2626;">*</span></label>
    <input type="text" id="f-customer" placeholder="Customer name">
  </div>

  <div class="logistics-field-row">
    <div class="logistics-field">
      <label>PO Number</label>
      <input type="text" id="f-po-number" placeholder="PO #">
    </div>
    <div class="logistics-field">
      <label>Invoice Number</label>
      <input type="text" id="f-invoice-number" placeholder="INV #">
    </div>
  </div>

  <div class="logistics-field-section-label" style="margin-top:12px;">Ship-To Address</div>

  <div class="logistics-field-row">
    <div class="logistics-field">
      <label>Company</label>
      <input type="text" id="f-ship-to-company" placeholder="Ship-to company name">
    </div>
    <div class="logistics-field">
      <label>Attention</label>
      <input type="text" id="f-ship-to-attention" placeholder="ATTN: name">
    </div>
  </div>

  <div class="logistics-field">
    <label>Street</label>
    <input type="text" id="f-ship-to-street" placeholder="Street address">
  </div>

  <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;">
    <div class="logistics-field">
      <label>City</label>
      <input type="text" id="f-ship-to-city" placeholder="City">
    </div>
    <div class="logistics-field">
      <label>State</label>
      <input type="text" id="f-ship-to-state" placeholder="ST" maxlength="2" style="text-transform:uppercase;">
    </div>
    <div class="logistics-field">
      <label>Zip</label>
      <input type="text" id="f-ship-to-zip" placeholder="Zip" maxlength="10">
    </div>
  </div>

  <div class="logistics-field-section-label" style="margin-top:12px;">Shipping</div>

  <div class="logistics-field">
    <label>Trailer #</label>
    <input type="text" id="f-trailer-number" placeholder="Trailer number">
  </div>

  <div class="logistics-field-row">
    <div class="logistics-field">
      <label>Delivery Time</label>
      <input type="text" id="f-delivery-time" placeholder="e.g. 7:00 am &amp; HRLY">
    </div>
    <div class="logistics-field">
      <label>Scrap Pickup</label>
      <select id="f-scrap-pickup">
        <option value="">— N/A —</option>
        <option value="YES">YES</option>
        <option value="NO">NO</option>
      </select>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
    <div class="logistics-field">
      <label>Load Count</label>
      <input type="number" id="f-load-count" min="1" step="1" value="1">
    </div>
    <div class="logistics-field">
      <label>Total BDFT</label>
      <input type="number" id="f-total-bdft" min="0" step="0.01" placeholder="0.00">
    </div>
    <div class="logistics-field">
      <label>Location</label>
      <input type="text" id="f-destination" placeholder="City, State">
    </div>
  </div>

  <div class="logistics-field-section-label" style="margin-top:12px;">Contact</div>

  <div class="logistics-field-row">
    <div class="logistics-field">
      <label>Contact Name</label>
      <input type="text" id="f-contact-name" placeholder="Contact person">
    </div>
    <div class="logistics-field">
      <label>Contact Phone</label>
      <input type="tel" id="f-contact-phone" placeholder="Phone number">
    </div>
  </div>

  <div class="logistics-field">
    <label>Linked Job</label>
    <select id="f-job-id">
      <option value="">— no linked job —</option>
    </select>
  </div>
</div>
```

---

## Step 3 — Replace the status dropdown in the modal

Find the `<select id="f-status">` (around line 182). Replace the entire `<select>`:

```html
<select id="f-status">
  <option value="not_started">Not Started</option>
  <option value="in_production">In Production</option>
  <option value="ready_to_ship">Ready to Ship</option>
  <option value="loading">Loading</option>
  <option value="loaded">Loaded</option>
  <option value="in_transit">In Transit</option>
  <option value="delivered">Delivered</option>
  <option value="cancelled">Cancelled</option>
</select>
```

---

## Step 4 — Remove `awaiting` from the outbound filter dropdown

Find the outbound status filter `<select id="outbound-status-filter">`. Remove the `<option value="awaiting">Awaiting</option>` line. It should already have the new statuses from Prompt 60, but verify `in_production` and `ready_to_ship` are present.

---

## Step 5 — Update `openEdit()` to fetch job data

Replace the outbound population section in `openEdit()`. Find this block:

```javascript
if (currentDirection === 'outbound') {
    document.getElementById('f-customer').value       = s.customer || '';
    document.getElementById('f-destination').value    = s.destination || '';
    document.getElementById('f-load-count').value     = s.load_count || 1;
    document.getElementById('f-total-bdft').value     = s.total_bdft || '';
    document.getElementById('f-job-id').value         = s.job_id || '';
    document.getElementById('f-trailer-number').value = s.trailer_number || '';
```

Replace with:

```javascript
if (currentDirection === 'outbound') {
    document.getElementById('f-customer').value       = s.customer || '';
    document.getElementById('f-destination').value    = s.destination || '';
    document.getElementById('f-load-count').value     = s.load_count || 1;
    document.getElementById('f-total-bdft').value     = s.total_bdft || '';
    document.getElementById('f-job-id').value         = s.job_id || '';
    document.getElementById('f-trailer-number').value = s.trailer_number || '';

    // Clear new fields
    ['f-po-number','f-invoice-number','f-ship-to-company','f-ship-to-attention',
     'f-ship-to-street','f-ship-to-city','f-ship-to-state','f-ship-to-zip',
     'f-delivery-time','f-contact-name','f-contact-phone'].forEach(fid => {
      const el = document.getElementById(fid);
      if (el) el.value = '';
    });
    const sp = document.getElementById('f-scrap-pickup');
    if (sp) sp.value = '';

    // Fetch full job data to populate address and detail fields
    if (s.job_id) {
      fetchJobForModal(s.job_id);
    }
```

Add the `fetchJobForModal` function anywhere in the `<script>` block:

```javascript
async function fetchJobForModal(jobId) {
  try {
    const res = await fetch('/api/jobs/' + encodeURIComponent(jobId));
    const data = await res.json();
    if (!data.ok || !data.job) return;
    const j = data.job;

    if (j.po_number)         document.getElementById('f-po-number').value = j.po_number;
    if (j.invoice_number)    document.getElementById('f-invoice-number').value = j.invoice_number;
    if (j.ship_to_company)   document.getElementById('f-ship-to-company').value = j.ship_to_company;
    if (j.ship_to_attention) document.getElementById('f-ship-to-attention').value = j.ship_to_attention;
    if (j.ship_to_street)    document.getElementById('f-ship-to-street').value = j.ship_to_street;
    if (j.ship_to_city)      document.getElementById('f-ship-to-city').value = j.ship_to_city;
    if (j.ship_to_state)     document.getElementById('f-ship-to-state').value = j.ship_to_state;
    if (j.ship_to_zip)       document.getElementById('f-ship-to-zip').value = j.ship_to_zip;
    if (j.delivery_time)     document.getElementById('f-delivery-time').value = j.delivery_time;
    if (j.contact_name)      document.getElementById('f-contact-name').value = j.contact_name;
    if (j.contact_phone)     document.getElementById('f-contact-phone').value = j.contact_phone;
    if (j.scrap_pickup)      document.getElementById('f-scrap-pickup').value = j.scrap_pickup;

    // Sync fields that may have drifted from the job
    if (j.customer)    document.getElementById('f-customer').value = j.customer;
    if (j.carrier)     document.getElementById('f-carrier').value = j.carrier;
    if (j.method)      document.getElementById('f-method').value = j.method;
    if (j.ship_date)   document.getElementById('f-ship-date').value = j.ship_date;
    if (j.location)    document.getElementById('f-destination').value = j.location;
    if (j.load_count)  document.getElementById('f-load-count').value = j.load_count;
    if (j.total_bdft)  document.getElementById('f-total-bdft').value = j.total_bdft;
  } catch (e) {
    console.error('Failed to fetch job for modal:', e);
  }
}
```

---

## Step 6 — Update `saveShipment()` to sync back to the job

In `saveShipment()`, after the successful save response (find `if (!body.ok)` check, then after the success path), add a job sync block. Find the section after `const saved = body.data;` and add before any existing post-save logic:

```javascript
// Sync editable fields back to the linked job
const jobId = document.getElementById('f-job-id').value;
if (jobId && dir === 'outbound') {
  try {
    const jobUpdate = {
      id: jobId,
      customer: payload.customer,
      carrier: payload.carrier,
      method: payload.method,
      ship_date: payload.ship_date,
      location: payload.destination,
      load_count: payload.load_count,
      total_bdft: payload.total_bdft,
      ship_to_company:   document.getElementById('f-ship-to-company')?.value?.trim() || '',
      ship_to_attention: document.getElementById('f-ship-to-attention')?.value?.trim() || '',
      ship_to_street:    document.getElementById('f-ship-to-street')?.value?.trim() || '',
      ship_to_city:      document.getElementById('f-ship-to-city')?.value?.trim() || '',
      ship_to_state:     document.getElementById('f-ship-to-state')?.value?.trim() || '',
      ship_to_zip:       document.getElementById('f-ship-to-zip')?.value?.trim() || '',
      delivery_time:     document.getElementById('f-delivery-time')?.value?.trim() || '',
      contact_name:      document.getElementById('f-contact-name')?.value?.trim() || '',
      contact_phone:     document.getElementById('f-contact-phone')?.value?.trim() || '',
      scrap_pickup:      document.getElementById('f-scrap-pickup')?.value || '',
      po_number:         document.getElementById('f-po-number')?.value?.trim() || '',
      invoice_number:    document.getElementById('f-invoice-number')?.value?.trim() || '',
    };
    await fetch('/api/jobs/' + encodeURIComponent(jobId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jobUpdate),
    });
  } catch (e) {
    console.error('Job sync from logistics failed:', e);
  }
}
```

---

## Step 7 — Update `clearForm()` to reset new fields and default to `not_started`

Replace `clearForm()`:

```javascript
function clearForm() {
  ['f-ship-date','f-carrier','f-bol-number','f-notes',
   'f-customer','f-destination','f-supplier','f-origin','f-trailer-number',
   'f-po-number','f-invoice-number','f-ship-to-company','f-ship-to-attention',
   'f-ship-to-street','f-ship-to-city','f-ship-to-state','f-ship-to-zip',
   'f-delivery-time','f-contact-name','f-contact-phone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const lc = document.getElementById('f-load-count'); if (lc) lc.value = 1;
  const bd = document.getElementById('f-total-bdft'); if (bd) bd.value = '';
  const wl = document.getElementById('f-weight-lbs'); if (wl) wl.value = '';
  const sp = document.getElementById('f-scrap-pickup'); if (sp) sp.value = '';
  document.getElementById('f-status').value = 'not_started';
  document.getElementById('f-method').value = '';
  document.getElementById('f-job-id').value = '';
  document.getElementById('f-bead-type-id').value = '';
  document.getElementById('f-silo-id').value = '';
  document.getElementById('f-id').value = '';
}
```

---

## Step 8 — Show Build Load / Generate BOL for ALL job-linked shipments

Replace `buildActionButtons()`:

```javascript
function buildActionButtons(shipment) {
  if (!shipment.job_id) return '';
  if (['delivered', 'cancelled'].includes(shipment.status)) return '';

  return `<a class="logistics-action-btn action-load" href="/logistics/load-builder.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">Build Load</a> <a class="logistics-action-btn action-bol" href="/logistics/bol-generator.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">Generate BOL</a>`;
}
```

---

## Step 9 — Show bay dropdown for `ready_to_ship` AND `not_started` (in loading context)

Replace `buildBayCell()`:

```javascript
function buildBayCell(shipment, loadingAssignment) {
  if (!shipment.job_id) return '—';

  if (loadingAssignment && loadingAssignment.bay_number) {
    return `<span style="font-size:12px;font-weight:600;">Bay ${loadingAssignment.bay_number}</span>`;
  }

  if (['ready_to_ship'].includes(shipment.status) && allLoadingBays.length > 0) {
    const laId = loadingAssignment?.id || '';
    if (!laId) return '—';
    const opts = allLoadingBays.map(b =>
      `<option value="${b.id}">Bay ${b.bay_number}${b.label ? ' — ' + esc(b.label) : ''}</option>`
    ).join('');
    return `<select class="logistics-bay-select" onchange="assignBayFromDashboard('${laId}', this.value)" onclick="event.stopPropagation()">
      <option value="">Assign…</option>
      ${opts}
    </select>`;
  }

  return '—';
}
```

---

## What NOT to touch

- Do NOT modify `_worker.js`
- Do NOT modify `loading.html`
- Do NOT modify `bol-shared.js`, `bol-generator.html`, or `load-builder.html`
- Do NOT modify `jobs/index.html`
- Do NOT modify the inbound section of the modal
- Do NOT modify the `buildOutboundRow()` function (it already renders bay and action columns)
- Do NOT modify `logistics-shared.css` (CSS is already there from Prompt 61)

---

## Completion checklist

- [ ] Migration SQL created at `DB Migrations/fix-shipment-statuses.sql`
- [ ] Outbound modal fields mirror job form: ship-to address, PO, invoice, delivery time, contact, scrap pickup
- [ ] Status dropdown in modal: no `awaiting`, includes `in_production` and `ready_to_ship`
- [ ] Status filter dropdown: no `awaiting`
- [ ] `openEdit()` calls `fetchJobForModal()` for job-linked shipments
- [ ] `fetchJobForModal()` populates all address/detail fields from the job
- [ ] `saveShipment()` syncs all editable fields back to the linked job
- [ ] `clearForm()` resets all new fields, defaults to `not_started`
- [ ] `buildActionButtons()` shows Build Load and Generate BOL for all job-linked shipments except delivered/cancelled
- [ ] `buildBayCell()` unchanged (bay dropdown for `ready_to_ship`)
- [ ] No references to `awaiting` as a default anywhere
- [ ] No console errors

**Notify Steve:** Run the migration SQL in the Cloudflare D1 Dashboard Console BEFORE deploying:

```sql
UPDATE shipments SET status = 'not_started', updated_at = datetime('now')
WHERE status = 'awaiting' AND direction = 'outbound'
AND job_id IN (SELECT id FROM jobs WHERE status = 'not_started');

UPDATE shipments SET status = 'in_production', updated_at = datetime('now')
WHERE status = 'awaiting' AND direction = 'outbound'
AND job_id IN (SELECT id FROM jobs WHERE status = 'in_production');

UPDATE shipments SET status = 'ready_to_ship', updated_at = datetime('now')
WHERE status = 'awaiting' AND direction = 'outbound'
AND job_id IN (SELECT id FROM jobs WHERE status IN ('done', 'loading', 'shipped'));

UPDATE shipments SET status = 'not_started', updated_at = datetime('now')
WHERE status = 'awaiting' AND direction = 'outbound';
```

Then deploy and test.
