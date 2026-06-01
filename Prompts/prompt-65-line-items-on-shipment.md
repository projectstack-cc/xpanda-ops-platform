# Prompt 65 — Show Read-Only Line Items on Logistics Shipment Modal

## Goal

When opening a job-linked shipment on the logistics dashboard, display the job's line items (parts) as a read-only table inside the modal. Users can see what parts are on the order but cannot edit them here.

Only file to modify: `logistics/index.html`

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Step 1 — Add line items container to the outbound fields HTML

In the `<div id="outbound-fields">` section, find the Linked Job field (the last field before the closing `</div>` of outbound-fields):

```html
        <div class="logistics-field">
          <label>Linked Job</label>
          <select id="f-job-id">
            <option value="">— no linked job —</option>
          </select>
        </div>
      </div>
```

Add a line items section **before** the closing `</div>` of `outbound-fields`, right after the Linked Job `</div>`:

```html
        <!-- Read-only Line Items -->
        <div id="shipment-line-items" style="display:none;margin-top:16px;">
          <div class="logistics-field-section-label">Line Items</div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px;">
            <thead>
              <tr style="text-align:left;border-bottom:2px solid #e5e7eb;">
                <th style="padding:6px 8px;font-weight:700;color:#374151;">Part #</th>
                <th style="padding:6px 8px;font-weight:700;color:#374151;">Description</th>
                <th style="padding:6px 8px;font-weight:700;color:#374151;text-align:right;">Qty</th>
                <th style="padding:6px 8px;font-weight:700;color:#374151;">Dimensions</th>
              </tr>
            </thead>
            <tbody id="shipment-line-items-body"></tbody>
          </table>
        </div>
```

---

## Step 2 — Populate line items from `fetchJobForModal()`

In the `fetchJobForModal()` function, find the end of the function (just before the closing `} catch`). Add this block after the last field population line (`if (j.total_bdft) ...`):

```javascript
    // Render read-only line items
    const liContainer = document.getElementById('shipment-line-items');
    const liBody = document.getElementById('shipment-line-items-body');
    if (liContainer && liBody) {
      if (Array.isArray(j.line_items) && j.line_items.length > 0) {
        liBody.innerHTML = j.line_items.map(li => `<tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:6px 8px;font-weight:600;color:#111827;">${esc(li.part_number || '—')}</td>
          <td style="padding:6px 8px;color:#374151;">${esc(li.description || '—')}</td>
          <td style="padding:6px 8px;text-align:right;color:#111827;">${li.quantity || '—'}</td>
          <td style="padding:6px 8px;color:#6b7280;">${esc(li.dimensions || '—')}</td>
        </tr>`).join('');
        liContainer.style.display = '';
      } else {
        liBody.innerHTML = '';
        liContainer.style.display = 'none';
      }
    }
```

---

## Step 3 — Clear line items on modal close and for non-job shipments

In `clearForm()`, add at the end of the function (before the closing `}`):

```javascript
  const liContainer = document.getElementById('shipment-line-items');
  const liBody = document.getElementById('shipment-line-items-body');
  if (liContainer) liContainer.style.display = 'none';
  if (liBody) liBody.innerHTML = '';
```

---

## What NOT to touch

- Do NOT modify `_worker.js`
- Do NOT modify `jobs/index.html`
- Do NOT modify any other file
- Do NOT make line items editable
- Do NOT modify `fetchJobForModal()` beyond adding the line items block
- Do NOT modify `openEdit()`, `saveShipment()`, `buildOutboundRow()`, or any other existing function besides `clearForm()`
