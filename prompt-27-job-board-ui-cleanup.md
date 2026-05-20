# Prompt 27 — Job Board UI Cleanup

## Goal

Apply a series of UI changes to the job board (`jobs/index.html`): remove unused fields, add inline packing slip viewer, fix modal close behavior, move instructions section, add drag-and-drop upload, and remove the BOL info field.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Step 1 — Remove fields

### 1a. Remove Sales Lead field

Find and remove the "Sales Lead" form group (around line 157):
```html
<label for="f-sales-lead">Sales Lead</label>
<input type="text" id="f-sales-lead" placeholder="e.g. Tim for MS">
```

Also remove from:
- The save payload (around line 1206): `sales_lead: ...`
- The form population on edit (around line 1060): `set('f-sales-lead', ...)`
- The form clear/reset (around line 1023): `'f-sales-lead'` from the ID list

Do NOT remove the `sales_lead` column from the database or the API — just remove it from the UI. Existing data stays.

### 1b. Remove Priority section

Find and remove the priority toggle buttons (around line 277-279):
```html
<div class="jobs-priority-toggle">
  <button type="button" class="jobs-priority-btn active-normal" id="priority-normal">Normal</button>
  <button type="button" class="jobs-priority-btn" id="priority-rush">RUSH</button>
</div>
```

Also remove:
- The `setPriority()` function (around line 1115-1122)
- The event listeners for priority buttons (around line 862-863)
- The priority from the save payload: `priority: ...`
- The priority population on edit: `setPriority(job.priority || 'normal')`
- The RUSH badge rendering on kanban cards (around line 591): `${job.priority === 'rush' ? ...}`
- Any CSS rules for `.jobs-priority-toggle`, `.jobs-priority-btn`, `.active-normal`, `.active-rush`, `.jobs-rush-badge`

### 1c. Remove "Confirmed to Ship" checkbox

Find and remove the confirmed checkbox (around line 271):
```html
<input type="checkbox" id="f-confirmed">
```
And its label.

Also remove from:
- The save payload: `confirmed_to_ship: ...`
- The form population on edit: `document.getElementById('f-confirmed').checked = ...`
- The form reset: `document.getElementById('f-confirmed').checked = false`

### 1d. Remove BOL Info field

Find and remove (around line 304-305):
```html
<label for="f-bol-info">BOL Info</label>
<input type="text" id="f-bol-info" placeholder="Bill of lading details">
```

Also remove from save payload, edit population, and form reset.

---

## Step 2 — Inline packing slip viewer with collapse

Currently, clicking "View / Print" opens the packing slip in a new tab. Replace this with an inline collapsible PDF viewer embedded in the job modal.

### 2a. Add the viewer HTML

Add this inside the job modal, after the packing slip upload badge area and before the form fields:

```html
<div id="slip-inline-viewer" hidden style="margin:8px 0 12px;">
  <div id="slip-viewer-toggle" style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;margin-bottom:6px;">
    <span id="slip-viewer-chevron" style="font-size:12px;transition:transform 0.2s;">▶</span>
    <span style="font-size:13px;font-weight:600;color:#1e40af;">View Packing Slip</span>
  </div>
  <div id="slip-viewer-content" hidden>
    <iframe id="slip-viewer-iframe" style="width:100%;height:500px;border:1px solid #d1d5db;border-radius:8px;" src="about:blank"></iframe>
  </div>
</div>
```

### 2b. Wire toggle behavior

```javascript
document.getElementById('slip-viewer-toggle').addEventListener('click', () => {
  const content = document.getElementById('slip-viewer-content');
  const chevron = document.getElementById('slip-viewer-chevron');
  const isHidden = content.hidden;
  content.hidden = !isHidden;
  chevron.style.transform = isHidden ? 'rotate(90deg)' : '';
});
```

### 2c. Show the viewer when editing a job with a packing slip

When editing a job that has a packing slip, show the inline viewer container and set the iframe src:

```javascript
if (job.packing_slip_filename) {
  document.getElementById('slip-inline-viewer').hidden = false;
  // Set iframe src only when expanded (lazy load)
  document.getElementById('slip-viewer-toggle').addEventListener('click', function loadSlip() {
    const iframe = document.getElementById('slip-viewer-iframe');
    if (iframe.src === 'about:blank' || !iframe.src.includes('/packing-slip')) {
      iframe.src = '/api/jobs/' + encodeURIComponent(jobId) + '/packing-slip';
    }
  }, { once: true });
}
```

Also remove the old "View / Print" button that opens a new tab (around line 978-986).

### 2d. Hide the viewer when creating a new job or when no slip exists

In `clearForm()` / form reset:
```javascript
document.getElementById('slip-inline-viewer').hidden = true;
document.getElementById('slip-viewer-content').hidden = true;
document.getElementById('slip-viewer-chevron').style.transform = '';
document.getElementById('slip-viewer-iframe').src = 'about:blank';
```

---

## Step 3 — Move "Instructions" section to the bottom of the form

The "Packing / Labeling Instructions" textarea (around line 314-316) and "Notes" textarea (around line 318-319) are currently in the middle of the form.

Move both of these to the very bottom of the form, just before the Save/Cancel buttons. Cut them from their current location and paste before the button row.

---

## Step 4 — Fix modal close on outside click

Currently (line 858-859):
```javascript
document.getElementById('jobs-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('jobs-modal')) closeModal();
});
```

This closes the modal when clicking the overlay background. **Remove this event listener entirely** — clicking outside the modal card should NOT close it, as this causes loss of work in progress.

The user can still close via the × button or Cancel button.

---

## Step 5 — Add drag-and-drop for packing slip upload

Add a drop zone to the job modal that allows dragging a PDF file directly onto the form to trigger the packing slip upload flow.

### 5a. Add drop zone HTML

Add at the top of the modal card content (just inside the modal card, before the form sections):

```html
<div id="slip-dropzone" style="border:2px dashed #d1d5db;border-radius:12px;padding:20px;text-align:center;margin-bottom:16px;transition:all 0.2s;cursor:pointer;" onclick="document.getElementById('packing-slip-upload').click()">
  <div style="font-size:14px;color:#6b7280;">
    <span style="font-size:20px;">📄</span><br>
    Drag & drop a packing slip PDF here<br>
    <span style="font-size:12px;color:#9ca3af;">or click to browse</span>
  </div>
</div>
```

### 5b. Wire drag-and-drop events

```javascript
const dropzone = document.getElementById('slip-dropzone');

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.style.borderColor = '#3b82f6';
  dropzone.style.backgroundColor = '#eff6ff';
});

dropzone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dropzone.style.borderColor = '#d1d5db';
  dropzone.style.backgroundColor = '';
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.style.borderColor = '#d1d5db';
  dropzone.style.backgroundColor = '';

  const files = e.dataTransfer.files;
  if (files.length && files[0].type === 'application/pdf') {
    // Trigger the same handler as the file input
    const input = document.getElementById('packing-slip-upload');
    // Create a new DataTransfer to set the file input
    const dt = new DataTransfer();
    dt.items.add(files[0]);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
```

### 5c. Hide the drop zone after a slip is uploaded

After a packing slip is successfully parsed and the badge is shown, hide the drop zone:
```javascript
document.getElementById('slip-dropzone').hidden = true;
```

Show it again in `clearForm()`:
```javascript
document.getElementById('slip-dropzone').hidden = false;
```

---

## Step 6 — Board footage to quantity conversion note

Some line items from packing slips list quantities in board footage (BDFT) rather than piece count (e.g., "8,064" for 8064 BDFT of 2" x 24" x 48" holey board). The pieces-per-bundle info is in the description (e.g., "18 pieces per bundle / 16 BDFT per piece / 288 BDFT per bundle").

Add a small "BDFT" badge/indicator next to the quantity in the line items section of the job form. When the parser detects that quantities are in BDFT (by checking if the description lines contain "BDFT per piece"), mark the line item accordingly.

In the parser output, add a `qty_unit` field:
```javascript
// In parseLineItems, when building the item:
qty_unit: /BDFT\s*per\s*piece/i.test(descLines.join(' ')) ? 'bdft' : 'pcs',
```

In the job form's line items display, when `qty_unit === 'bdft'`, show the quantity with a "BDFT" suffix badge in a muted color, so the user knows this is board footage not piece count.

---

## What NOT to touch

- Do NOT modify `_worker.js` or any API handlers
- Do NOT modify the packing slip parser (that's Prompt 26)
- Do NOT modify the kanban card rendering logic beyond removing the RUSH badge
- Do NOT modify the load builder, BOL generator, or any other pages
- Do NOT remove database columns — only remove UI references

---

## Completion checklist

- [ ] Sales Lead field removed from form, save payload, edit population, and reset
- [ ] Priority toggle removed from form, save payload, edit population, reset, and kanban cards
- [ ] Confirmed to Ship checkbox removed from form, save payload, edit population, and reset
- [ ] BOL Info field removed from form, save payload, edit population, and reset
- [ ] Inline packing slip viewer with collapse toggle added
- [ ] Old "View / Print" new-tab button removed
- [ ] Instructions and Notes textareas moved to bottom of form
- [ ] Modal overlay click no longer closes the modal
- [ ] Drag-and-drop zone added for packing slip upload
- [ ] Drop zone accepts PDF files and triggers the existing upload handler
- [ ] Drop zone hides after successful upload, reappears on form reset
- [ ] BDFT indicator shown on line items when quantity is in board footage

**Notify Steve:** No migration needed. All changes are UI-only.
