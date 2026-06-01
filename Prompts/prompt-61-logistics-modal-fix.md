# Prompt 61 — Logistics Dashboard: Job-Mirrored Modal, Status Display Fix, CSS

## Goal

The logistics dashboard edit modal needs to mirror the job entry form fields so clicking a shipment shows ALL relevant shipping information. The status display on the outbound table needs to show the job board statuses correctly. Several CSS classes for new features are missing. This prompt fixes everything that was missed or broken from Prompts 59–60.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Context — What's wrong right now

1. **The edit modal is still the old shipment-centric form.** It shows: Ship Date, Status, Method, Carrier, BOL Number, Trailer #, Customer, Destination (single text field), Load Count, Total BDFT, Linked Job, Notes. It does NOT show: Ship-To Address (company, attention, street, city, state, zip), PO Number, Invoice Number, Delivery Time, Contact Name, Contact Phone, Scrap Pickup. These fields all exist on the job and are critical for shipping.

2. **The status dropdown in the modal still shows `Awaiting` as default** and doesn't include the new statuses (`in_production`, `ready_to_ship`).

3. **CSS classes referenced in Prompt 60 code were never added.** The `buildActionButtons()` and `buildBayCell()` functions render elements with classes like `logistics-action-btn`, `action-load`, `action-bol`, `logistics-bay-select` — but the CSS for those classes doesn't exist in the stylesheet or inline styles.

4. **For job-linked shipments, the modal should pull data directly from the job** rather than relying on whatever was copied into the shipment record at creation time. When a user clicks a shipment row, if it has a `job_id`, fetch the full job and populate the modal with job data.

---

## Step 1 — Add missing CSS

In `logistics/index.html`, find the end of the `<head>` section (before `</head>`). Add a `<style>` block with the missing classes:

```html
<style>
.logistics-action-btn {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 5px;
  text-decoration: none;
  white-space: nowrap;
  margin-left: 4px;
  transition: background .12s;
}
.action-load { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
.action-load:hover { background: #fde68a; }
.action-bol { background: #f0f9ff; color: #0369a1; border: 1px solid #bae6fd; }
.action-bol:hover { background: #e0f2fe; }

.logistics-bay-select {
  font-size: 12px;
  padding: 3px 6px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  max-width: 120px;
}

.status-in_production { background: #fef3c7; color: #92400e; border-radius: 6px; padding: 2px 8px; font-size: 12px; font-weight: 600; }
.status-ready_to_ship { background: #dcfce7; color: #166534; border-radius: 6px; padding: 2px 8px; font-size: 12px; font-weight: 600; }
</style>
```

---

## Step 2 — Rebuild the outbound modal to mirror the job form

Replace the entire outbound-specific section of the modal (`<div id="outbound-fields">...</div>`, currently around lines 218–253) with a form that mirrors the job entry form layout. Keep the same field IDs where they already exist, add new ones for new fields.

Replace from `<!-- Outbound-specific -->` through the closing `</div>` of `outbound-fields`:

```html
<!-- Outbound-specific -->
<div class="logistics-field-section" id="outbound-fields">
  <div class="logistics-field-section-label">Customer & Order</div>

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
      <input type="text" id="f-delivery-time" placeholder="e.g. 7:00 am & HRLY">
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

## Step 3 — Update the status dropdown in the modal

Find the status `<select>` (currently around line 182):

```html
<select id="f-status">
  <option value="awaiting">Awaiting</option>
  <option value="not_started">Not Started</option>
  ...
```

Replace with:

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

## Step 4 — Populate the modal from job data for job-linked shipments

Update `openEdit()` to fetch the full job record when opening a job-linked shipment. Replace the current outbound population section.

Find where outbound fields are populated in `openEdit()` (the `if (currentDirection === 'outbound')` block). Replace it with:

```javascript
if (currentDirection === 'outbound') {
  document.getElementById('f-customer').value       = s.customer || '';
  document.getElementById('f-destination').value    = s.destination || '';
  document.getElementById('f-load-count').value     = s.load_count || 1;
  document.getElementById('f-total-bdft').value     = s.total_bdft || '';
  document.getElementById('f-job-id').value         = s.job_id || '';
  document.getElementById('f-trailer-number').value = s.trailer_number || '';

  // Clear new fields first
  ['f-po-number','f-invoice-number','f-ship-to-company','f-ship-to-attention',
   'f-ship-to-street','f-ship-to-city','f-ship-to-state','f-ship-to-zip',
   'f-delivery-time','f-contact-name','f-contact-phone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const sp = document.getElementById('f-scrap-pickup');
  if (sp) sp.value = '';

  // If job-linked, fetch full job data and populate address/details from job
  if (s.job_id) {
    fetchJobForModal(s.job_id);
  }
}
```

Add the `fetchJobForModal` function:

```javascript
async function fetchJobForModal(jobId) {
  try {
    const res = await fetch('/api/jobs/' + encodeURIComponent(jobId));
    const data = await res.json();
    if (!data.ok || !data.job) return;
    const j = data.job;

    // Populate job fields into the modal
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

    // Also sync fields that might have drifted
    if (j.customer)    document.getElementById('f-customer').value = j.customer;
    if (j.carrier)     document.getElementById('f-carrier').value = j.carrier;
    if (j.method)      document.getElementById('f-method').value = j.method;
    if (j.ship_date)   document.getElementById('f-ship-date').value = j.ship_date;
    if (j.location)    document.getElementById('f-destination').value = j.location;
    if (j.load_count)  document.getElementById('f-load-count').value = j.load_count;
    if (j.total_bdft)  document.getElementById('f-total-bdft').value = j.total_bdft;
  } catch (e) {
    console.error('Failed to fetch job data for modal:', e);
  }
}
```

---

## Step 5 — Update `saveShipment()` to sync editable fields back to the job

When saving changes on a job-linked shipment, fields like customer, carrier, ship_date, method, and address should write back to the job. Add this sync after the existing shipment save.

In `saveShipment()`, after the successful PUT response (find the `if (data.ok)` block after the PUT call), add:

```javascript
// Sync editable fields back to the linked job
const jobId = document.getElementById('f-job-id').value;
if (jobId && dir === 'outbound') {
  try {
    const jobPayload = {
      id: jobId,
      customer: payload.customer,
      carrier: payload.carrier,
      method: payload.method,
      ship_date: payload.ship_date,
      location: payload.destination,
      load_count: payload.load_count,
      total_bdft: payload.total_bdft,
    };

    // Sync address fields
    const shipToFields = {
      ship_to_company:   document.getElementById('f-ship-to-company')?.value?.trim() || '',
      ship_to_attention: document.getElementById('f-ship-to-attention')?.value?.trim() || '',
      ship_to_street:    document.getElementById('f-ship-to-street')?.value?.trim() || '',
      ship_to_city:      document.getElementById('f-ship-to-city')?.value?.trim() || '',
      ship_to_state:     document.getElementById('f-ship-to-state')?.value?.trim() || '',
      ship_to_zip:       document.getElementById('f-ship-to-zip')?.value?.trim() || '',
    };
    Object.assign(jobPayload, shipToFields);

    // Sync other detail fields
    const detailFields = {
      delivery_time:  document.getElementById('f-delivery-time')?.value?.trim() || '',
      contact_name:   document.getElementById('f-contact-name')?.value?.trim() || '',
      contact_phone:  document.getElementById('f-contact-phone')?.value?.trim() || '',
      scrap_pickup:   document.getElementById('f-scrap-pickup')?.value || '',
      po_number:      document.getElementById('f-po-number')?.value?.trim() || '',
      invoice_number: document.getElementById('f-invoice-number')?.value?.trim() || '',
    };
    Object.assign(jobPayload, detailFields);

    await fetch('/api/jobs/' + encodeURIComponent(jobId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jobPayload),
    });
  } catch (e) {
    console.error('Job sync from logistics failed:', e);
  }
}
```

---

## Step 6 — Update `clearForm()` to reset new fields

Update `clearForm()` to include the new field IDs:

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

Note the default status changed from `'awaiting'` to `'not_started'`.

---

## Step 7 — Update `openModal()` for new shipments

When creating a new shipment via "+ New Shipment", the form should also default to `not_started` status. This is already handled by the `clearForm()` change above.

---

## What NOT to touch

- Do NOT modify `_worker.js` — backend sync is already correct from Prompt 59
- Do NOT modify `loading.html`
- Do NOT modify `bol-shared.js`, `bol-generator.html`, or `load-builder.html`
- Do NOT modify the inbound fields section of the modal
- Do NOT modify the `buildOutboundRow()`, `buildBayCell()`, or `buildActionButtons()` functions — they are correct, they just need the CSS from Step 1
- Do NOT modify the save/delete handlers for the shipment API
- Do NOT touch `jobs/index.html`

---

## Completion checklist

- [ ] `logistics/index.html`: CSS for `.logistics-action-btn`, `.action-load`, `.action-bol`, `.logistics-bay-select`, `.status-in_production`, `.status-ready_to_ship` added
- [ ] `logistics/index.html`: outbound modal fields mirror job form (ship-to address, PO, invoice, delivery time, contact, scrap pickup)
- [ ] `logistics/index.html`: status dropdown updated (no `awaiting`, includes `in_production` and `ready_to_ship`)
- [ ] `logistics/index.html`: `openEdit()` fetches job data for job-linked shipments and populates all fields
- [ ] `logistics/index.html`: `saveShipment()` syncs editable fields back to the linked job
- [ ] `logistics/index.html`: `clearForm()` resets all new fields, defaults status to `not_started`
- [ ] `logistics/index.html`: `fetchJobForModal()` function added
- [ ] No console errors

**Notify Steve:** No migrations needed. Deploy and test:
1. Open logistics dashboard → click a job-linked shipment row → modal should show full address, PO, invoice, delivery time, contact info pulled from the job
2. Status dropdown shows: Not Started, In Production, Ready to Ship, Loading, Loaded, In Transit, Delivered, Cancelled
3. Outbound table rows for jobs in production show "In Production" status badge (yellow)
4. Outbound table rows for jobs marked Done show "Ready to Ship" badge (green) with Bay dropdown and Build Load / Generate BOL buttons
5. Click Build Load button on a row → opens load builder with job prefilled
6. Click Generate BOL button on a row → opens BOL generator with job prefilled
7. Select a bay from the dropdown → toast confirms assignment
8. Edit a field (carrier, address) on the logistics modal and save → verify the change syncs back to the job board
9. Create a new ad-hoc shipment via "+ New Shipment" → form works normally, no job link
