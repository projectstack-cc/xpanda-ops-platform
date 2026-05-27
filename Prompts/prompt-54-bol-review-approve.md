# Prompt 54 — BOL Review/Approve Flow + Stop Auto-Download

## Goal

Replace the current "generate and immediately download/open" BOL flow with a review step. After generating a BOL PDF, the user sees an inline preview and can either **Approve** (saves the record and opens the final PDF) or **Make Changes** (returns to the form to edit and re-generate). Also remove the auto-download behavior from `bol-shared.js`.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Context

Current flow in `bol-generator.html`:
1. User fills form → clicks "Generate BOL PDF"
2. `handleGenerate()` → `doGenerate()` → saves to DB via POST/PUT → calls `generatePdf(data.bol)` → `BolShared.generatePdf()` which auto-downloads AND opens in new tab

Current flow in `load-builder.html` BOL modal:
1. User fills per-trailer BOL fields → clicks "Generate BOLs"
2. Saves each BOL to DB → calls `BolShared.generatePdf()` → same auto-download + new tab

New flow for **both pages**:
1. User fills form → clicks "Generate BOL PDF"
2. PDF is generated client-side (but NOT saved to DB yet, NOT opened)
3. PDF preview appears in an embedded viewer with two buttons: **Approve** and **Make Changes**
4. **Approve** → saves the BOL record to DB → opens the final PDF in a new tab (no auto-download)
5. **Make Changes** → closes the preview, returns to the form with all fields intact for editing → user clicks Generate again → repeat

---

## Step 1 — Remove auto-download from `bol-shared.js`

In `logistics/bol-shared.js`, find the `generatePdf()` function. Around lines 161–184, the current code does:

```javascript
// Save, download, and open
const pdfBytes = await combinedPdf.save();
const blob = new Blob([pdfBytes], { type: 'application/pdf' });
const blobUrl = URL.createObjectURL(blob);

// Trigger download
const bolNum = bolRecords[0]?.bol_number || 'BOL';
const a = document.createElement('a');
a.href = blobUrl;
a.download = `BOL-${bolNum}.pdf`;
document.body.appendChild(a);
a.click();
document.body.removeChild(a);

// Open in new tab
const win = window.open(blobUrl, '_blank');
```

**Refactor `generatePdf` to support two modes:**

1. **Preview mode** (new default) — generates the PDF and returns the blob URL instead of opening/downloading. The caller handles display.
2. **Open mode** — opens the PDF in a new tab (no download).

Replace the "Save, download, and open" section with:

```javascript
const pdfBytes = await combinedPdf.save();
const blob = new Blob([pdfBytes], { type: 'application/pdf' });
const blobUrl = URL.createObjectURL(blob);

if (opts.previewOnly) {
  // Return blob URL for inline preview — caller handles display
  return { blobUrl, pdfBytes };
}

// Open in new tab (no auto-download)
const win = window.open(blobUrl, '_blank');
if (!win) {
  const err = new Error('PDF was generated but your browser blocked the popup. Please allow popups for this site.');
  err.popupBlocked = true;
  throw err;
}

// Clean up blob URL after delay
setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
```

Update the function signature's JSDoc to document the `previewOnly` option and the return value.

Update the public API return at the bottom to also export a small `openPdf` helper:

```javascript
function openPdf(blobUrl) {
  const win = window.open(blobUrl, '_blank');
  if (!win) {
    alert('Your browser blocked the popup. Please allow popups for this site.');
    return;
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
}

return {
  COORDS,
  generatePdf,
  openPdf,
  buildShipToLines,
  wrapText,
  confirmNoBolNumber,
};
```

---

## Step 2 — BOL Generator: add review/approve flow

In `logistics/bol-generator.html`, the current `doGenerate()` function saves to DB first, then generates the PDF.

**Reverse the order**: generate the preview first, then save on approve.

### 2a. Add review modal HTML

Add a modal for the PDF review, just before the closing `</body>` tag (or alongside the existing modals):

```html
<!-- BOL Review Modal -->
<div id="bol-review-backdrop" style="
  position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;
  display:none;align-items:center;justify-content:center;
">
  <div style="
    background:#fff;border-radius:12px;width:95%;max-width:800px;
    height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.2);
  ">
    <div style="
      display:flex;justify-content:space-between;align-items:center;
      padding:16px 20px;border-bottom:1px solid #e5e7eb;
    ">
      <h3 style="margin:0;font-size:16px;font-weight:700;color:#111827;">Review BOL</h3>
      <div style="display:flex;gap:8px;">
        <button id="bol-review-edit" style="
          padding:8px 20px;border-radius:8px;border:1px solid #d1d5db;
          background:#fff;cursor:pointer;font-size:14px;font-weight:600;color:#111827;
        ">Make Changes</button>
        <button id="bol-review-approve" style="
          padding:8px 20px;border-radius:8px;border:none;
          background:#1e293b;color:#fff;cursor:pointer;font-size:14px;font-weight:600;
        ">Approve & Save</button>
      </div>
    </div>
    <iframe id="bol-review-iframe" style="
      flex:1;border:none;border-radius:0 0 12px 12px;
    "></iframe>
  </div>
</div>
```

### 2b. Rewrite `doGenerate()` to preview first

Replace the current `doGenerate()` function:

```javascript
async function doGenerate(payload) {
  const btn = document.getElementById('btn-generate');
  btn.disabled = true;
  btn.textContent = 'Generating preview…';
  setStatus('');

  try {
    // Build a temporary BOL object for PDF generation (not yet saved to DB)
    const tempBol = {
      ...payload,
      bol_number: payload.bol_number || '',
    };

    // Generate PDF in preview mode
    let packingSlipPdfBytes = null;
    if (prefilledJobId && document.getElementById('f-include-packing')?.checked) {
      try {
        const res = await fetch('/api/jobs/' + encodeURIComponent(prefilledJobId));
        const data = await res.json();
        if (data.job?.packing_slip_pdf) {
          const b64 = data.job.packing_slip_pdf;
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          packingSlipPdfBytes = bytes.buffer;
        }
      } catch (e) { console.error('Failed to fetch packing slip:', e); }
    }

    const result = await BolShared.generatePdf([tempBol], { previewOnly: true, packingSlipPdfBytes });

    // Show review modal
    showBolReview(result.blobUrl, payload);

  } catch (e) {
    setStatus('Error: ' + (e.message || String(e)), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate BOL PDF';
  }
}
```

### 2c. Add review modal logic

```javascript
let pendingReviewPayload = null;
let pendingReviewBlobUrl = null;

function showBolReview(blobUrl, payload) {
  pendingReviewPayload = payload;
  pendingReviewBlobUrl = blobUrl;

  const backdrop = document.getElementById('bol-review-backdrop');
  const iframe = document.getElementById('bol-review-iframe');
  iframe.src = blobUrl;
  backdrop.style.display = 'flex';

  // Wire up buttons (remove old listeners by replacing)
  const approveBtn = document.getElementById('bol-review-approve');
  const editBtn = document.getElementById('bol-review-edit');

  const newApprove = approveBtn.cloneNode(true);
  approveBtn.parentNode.replaceChild(newApprove, approveBtn);
  newApprove.addEventListener('click', handleReviewApprove);

  const newEdit = editBtn.cloneNode(true);
  editBtn.parentNode.replaceChild(newEdit, editBtn);
  newEdit.addEventListener('click', handleReviewEdit);
}

function closeBolReview() {
  const backdrop = document.getElementById('bol-review-backdrop');
  backdrop.style.display = 'none';
  document.getElementById('bol-review-iframe').src = '';
  if (pendingReviewBlobUrl) {
    URL.revokeObjectURL(pendingReviewBlobUrl);
    pendingReviewBlobUrl = null;
  }
}

async function handleReviewApprove() {
  if (!pendingReviewPayload) return;

  const approveBtn = document.getElementById('bol-review-approve');
  approveBtn.disabled = true;
  approveBtn.textContent = 'Saving…';

  try {
    const isEdit = !!editingBolId;
    const res = await fetch(isEdit ? `/api/bols/${editingBolId}` : '/api/bols', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingReviewPayload),
    });
    const data = await res.json();
    if (!data.ok) {
      setStatus(data.error || 'Save failed.', 'error');
      closeBolReview();
      return;
    }

    // Open the PDF in a new tab
    BolShared.openPdf(pendingReviewBlobUrl);
    pendingReviewBlobUrl = null; // Don't revoke — openPdf handles cleanup

    const bolLabel = data.bol.bol_number ? `BOL #${data.bol.bol_number}` : 'BOL';
    showToast(`${bolLabel} ${isEdit ? 'updated' : 'generated'}`);
    loadRecentBols();
    closeBolReview();
  } catch (e) {
    setStatus('Error: ' + (e.message || String(e)), 'error');
    closeBolReview();
  } finally {
    approveBtn.disabled = false;
    approveBtn.textContent = 'Approve & Save';
  }
}

function handleReviewEdit() {
  // Close the review modal — form still has all the values
  closeBolReview();
  // User edits the form, clicks Generate again → new preview
}
```

### 2d. Remove the old `generatePdf()` wrapper

The existing `generatePdf(bol)` function (around line 1293) that fetches the packing slip and calls `BolShared.generatePdf()` is no longer needed — its logic is now inside `doGenerate()`. **Delete it.**

---

## Step 3 — Load Builder: add review/approve flow to BOL modal

In `logistics/load-builder.html`, the BOL modal has a "Generate BOLs" button that calls a function to save each BOL to DB, then calls `BolShared.generatePdf()`.

### 3a. Add the same review modal HTML

Add the same review modal HTML from Step 2a to `load-builder.html`, just before `</body>`. Use the same IDs — it won't conflict since they're on separate pages.

### 3b. Modify the BOL generation flow

Find the function that handles the "Generate BOLs" button click (the function that loops through trailers, saves BOLs via POST, then calls `generateBolPdf(savedBols)`). This is around line 2690.

Change the flow to:

1. Save all BOLs to DB (this stays the same — the load builder saves before preview because it may create multiple BOLs)
2. Generate the combined PDF in **preview mode** (`previewOnly: true`)
3. Show the review modal
4. **Approve** → open the PDF in a new tab
5. **Make Changes** → close the preview. For the load builder, "Make Changes" should take the user back to the BOL modal (not close it entirely) so they can edit fields and re-generate.

The key difference from the BOL generator: the load builder saves to DB first because it creates multiple BOL records per generation. So "Make Changes" here means re-generating the PDFs with updated fields (the DB records can be updated via PUT).

Adapt the review modal wiring:
- **Approve** → `BolShared.openPdf(blobUrl)` and close the review
- **Make Changes** → close the review modal, return to the BOL modal so the user can edit commodity descriptions, addresses, etc. and click "Generate BOLs" again (which will PUT-update the existing BOL records)

### 3c. Remove old `generateBolPdf` auto-open behavior

Find `generateBolPdf` (which calls `BolShared.generatePdf(savedBols)`). This should now call with `{ previewOnly: true }` and pipe the result to the review modal instead of auto-opening.

---

## What NOT to touch

- Do NOT modify `loading.html`
- Do NOT modify `_worker.js` API handlers — the save endpoints stay exactly the same
- Do NOT modify `logistics/index.html` (logistics dashboard)
- Do NOT change COORDS or PDF field placement in `bol-shared.js`
- Do NOT modify `buildShipToLines` or `wrapText` or `confirmNoBolNumber` in `bol-shared.js`
- Do NOT rename existing functions that other code depends on (except internal refactors within the same file)
- Do NOT remove the load builder's existing BOL modal — it stays as-is, just with the added review step after generation

---

## Completion checklist

- [ ] `bol-shared.js`: auto-download `<a>` block removed entirely
- [ ] `bol-shared.js`: `generatePdf()` supports `previewOnly` option, returns `{ blobUrl, pdfBytes }` when set
- [ ] `bol-shared.js`: new `openPdf(blobUrl)` helper exported
- [ ] `bol-shared.js`: default behavior (without `previewOnly`) opens PDF in new tab, no download
- [ ] `bol-generator.html`: review modal HTML added
- [ ] `bol-generator.html`: `doGenerate()` generates preview first, shows review modal
- [ ] `bol-generator.html`: "Approve & Save" saves to DB then opens PDF
- [ ] `bol-generator.html`: "Make Changes" closes preview, returns to form with fields intact
- [ ] `bol-generator.html`: old standalone `generatePdf()` wrapper removed
- [ ] `load-builder.html`: review modal HTML added
- [ ] `load-builder.html`: BOL generation shows preview after saving records
- [ ] `load-builder.html`: "Approve" opens PDF in new tab
- [ ] `load-builder.html`: "Make Changes" returns to BOL modal for edits
- [ ] No auto-download on any path
- [ ] No console errors

**Notify Steve:** No migrations needed. Deploy and test:
1. Open BOL Generator → fill form → click Generate → review modal appears with PDF preview
2. Click "Make Changes" → returns to form with all fields intact → edit a field → click Generate → new preview
3. Click "Approve & Save" → BOL saved to DB, PDF opens in new tab, no file download
4. Check recent BOLs list → new BOL appears
5. Open Load Builder → add parts → go to Results → Generate BOLs → review modal appears
6. Click "Make Changes" → returns to BOL modal fields → edit → re-generate → new preview
7. Click "Approve" → PDF opens in new tab
8. Test on iPad — iframe PDF preview should render in the modal
