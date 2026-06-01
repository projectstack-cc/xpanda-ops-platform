# Prompt 63 — Logistics Dashboard: Modal Rebuild, Action Buttons, Kill Awaiting

## Goal

Seven surgical edits to `logistics/index.html`. Nothing else. No other files.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Edit 1 — Replace the `<select id="f-status">` options (line 182)

Find:
```html
            <option value="awaiting">Awaiting</option>
            <option value="not_started">Not Started</option>
            <option value="loading">Loading</option>
            <option value="loaded">Loaded</option>
            <option value="in_transit">In Transit</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
```

Replace with:
```html
            <option value="not_started">Not Started</option>
            <option value="in_production">In Production</option>
            <option value="ready_to_ship">Ready to Ship</option>
            <option value="loading">Loading</option>
            <option value="loaded">Loaded</option>
            <option value="in_transit">In Transit</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
```

---

## Edit 2 — Replace the entire `<div id="outbound-fields">` block (lines 218–254)

Find the block that starts with `<!-- Outbound-specific -->` and ends with the closing `</div>` of `outbound-fields`. Replace it entirely with:

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
            <input type="text" id="f-delivery-time" placeholder="e.g. 7:00 am">
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

## Edit 3 — Replace `clearForm()` function

Find the entire `clearForm()` function (starts with `function clearForm() {`, ends with its closing `}`). Replace it with:

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

## Edit 4 — Replace the outbound block inside `openEdit()`

Inside the `openEdit()` function, find this exact block:

```javascript
  if (currentDirection === 'outbound') {
    document.getElementById('f-customer').value       = s.customer || '';
    document.getElementById('f-destination').value    = s.destination || '';
    document.getElementById('f-load-count').value     = s.load_count || 1;
    document.getElementById('f-total-bdft').value     = s.total_bdft || '';
    document.getElementById('f-job-id').value         = s.job_id || '';
    document.getElementById('f-trailer-number').value = s.trailer_number || '';
  } else {
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

    ['f-po-number','f-invoice-number','f-ship-to-company','f-ship-to-attention',
     'f-ship-to-street','f-ship-to-city','f-ship-to-state','f-ship-to-zip',
     'f-delivery-time','f-contact-name','f-contact-phone'].forEach(fid => {
      const el = document.getElementById(fid);
      if (el) el.value = '';
    });
    const spEl = document.getElementById('f-scrap-pickup');
    if (spEl) spEl.value = '';

    if (s.job_id) fetchJobForModal(s.job_id);
  } else {
```

---

## Edit 5 — Replace `buildActionButtons()` function

Find the entire `buildActionButtons()` function (starts with `function buildActionButtons(shipment) {`, ends with its closing `}`). Replace it with:

```javascript
function buildActionButtons(shipment) {
  if (!shipment.job_id) return '';
  if (['delivered', 'cancelled'].includes(shipment.status)) return '';
  return `<a class="logistics-action-btn action-load" href="/logistics/load-builder.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">Build Load</a> <a class="logistics-action-btn action-bol" href="/logistics/bol-generator.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">Generate BOL</a>`;
}
```

---

## Edit 6 — Add `fetchJobForModal()` and `syncJobFromModal()` functions

Add these two functions inside the `<script>` block, right before `gateLogisticsNav()`:

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
    if (j.customer)          document.getElementById('f-customer').value = j.customer;
    if (j.carrier)           document.getElementById('f-carrier').value = j.carrier;
    if (j.method)            document.getElementById('f-method').value = j.method;
    if (j.ship_date)         document.getElementById('f-ship-date').value = j.ship_date;
    if (j.location)          document.getElementById('f-destination').value = j.location;
    if (j.load_count)        document.getElementById('f-load-count').value = j.load_count;
    if (j.total_bdft)        document.getElementById('f-total-bdft').value = j.total_bdft;
  } catch (e) {
    console.error('Failed to fetch job for modal:', e);
  }
}

async function syncJobFromModal(jobId) {
  try {
    await fetch('/api/jobs/' + encodeURIComponent(jobId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: jobId,
        customer:          document.getElementById('f-customer').value.trim(),
        carrier:           document.getElementById('f-carrier').value.trim(),
        method:            document.getElementById('f-method').value,
        ship_date:         document.getElementById('f-ship-date').value,
        location:          document.getElementById('f-destination').value.trim(),
        load_count:        parseInt(document.getElementById('f-load-count').value || 1, 10),
        total_bdft:        parseFloat(document.getElementById('f-total-bdft').value) || 0,
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
      }),
    });
  } catch (e) {
    console.error('Job sync from logistics failed:', e);
  }
}
```

---

## Edit 7 — Call `syncJobFromModal` after successful save in `saveShipment()`

In `saveShipment()`, find this exact line:

```javascript
    const saved = body.data;
```

Add immediately after it:

```javascript
    const syncJobId = document.getElementById('f-job-id').value;
    if (syncJobId && dir === 'outbound') await syncJobFromModal(syncJobId);
```

---

## What NOT to touch

- Do NOT modify `_worker.js`
- Do NOT modify any other file
- Do NOT modify `buildOutboundRow()`, `buildBayCell()`, `renderOutbound()`, `renderInbound()`, `buildInboundRow()`, `loadOutbound()`, `loadInbound()`, `loadBays()`, `loadLoadingAssignments()`, `assignBayFromDashboard()`, `saveShipment()` (except the one line in Edit 7), `confirmDelete()`, `prefillFromJob()`, `statusBadge()`, calendar functions, or anything else not listed above
- Do NOT add new `<script>` tags or CSS files
- Do NOT modify the inbound fields section of the modal
