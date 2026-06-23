# Logistics "View BOL" should display the BOL, not open the generator

> Assign a number before committing. Reflects HEAD `a66e5e2`. Pairs well with the combined-3-copy
> prompt (this viewer renders the same combined output).

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent** —
`logistics/index.html` only. No worker, no migration.

## Problem
On the logistics dashboard, "View BOL" (both the calendar-popup link and the shipment action button)
points at `/logistics/bol-generator.html?job_id=…` — that opens the *editor*, not the BOL. The job
board and loading dashboard already render the BOL inline via `BolShared.generatePdf`; logistics
doesn't, because **it never loads pdf-lib / qrcode / fontkit / bol-shared**. This adds those libs, an
inline viewer modal, and a `viewBolForJob()` that renders the generated copies — matching the rest of
the platform.

## Files
- `logistics/index.html` — 4 edits

---

### Edit 1 — load the BOL libraries + add the viewer modal

FIND (count == 1):
```
<body>

<script src="/logistics/logistics-header.js"></script>
```
REPLACE:
```
<body>

<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
<script src="https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js"></script>
<script src="/logistics/bol-shared.js"></script>

<div id="log-bol-view-modal" hidden onclick="if(event.target===this) closeBolViewModal()" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;">
  <div style="max-width:95vw;width:95vw;max-height:95vh;height:95vh;display:flex;flex-direction:column;background:#fff;border-radius:10px;overflow:hidden;">
    <div style="padding:10px 16px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
      <h3 style="margin:0;font-size:16px;font-weight:700;color:#111827;">Bill of Lading</h3>
      <div style="display:flex;gap:8px;align-items:center;">
        <button onclick="downloadBolFromViewer()" style="padding:6px 12px;background:#f3f4f6;color:#4b5563;border:1px solid #d1d5db;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;">Download</button>
        <button onclick="closeBolViewModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#6b7280;padding:0;line-height:1;">×</button>
      </div>
    </div>
    <iframe id="log-bol-view-iframe" style="flex:1;width:100%;border:none;background:#525659;"></iframe>
  </div>
</div>

<script src="/logistics/logistics-header.js"></script>
```

### Edit 2 — add the viewer logic (renders the same combined copies as Generate)

FIND (count == 1):
```
function buildActionButtons(shipment) {
```
REPLACE:
```
let currentBolBlobUrl = null;
let currentBolFilename = 'BOL.pdf';

async function viewBolForJob(jobId) {
  if (!jobId) return;
  try {
    const { ok, data } = await api.get('/api/bols?job_id=' + encodeURIComponent(jobId));
    if (!ok || !data?.bols?.length) { alert('No BOL found for this job.'); return; }
    if (!window.BolShared || !window.PDFLib) { alert('BOL viewer not ready — try again in a moment.'); return; }
    const bol = data.bols[data.bols.length - 1];

    // Render the same combined output as Generate: original → driver → customer.
    const { PDFDocument } = PDFLib;
    const out = await PDFDocument.create();
    for (const copyType of [undefined, 'driver', 'customer']) {
      const r = await BolShared.generatePdf([bol], { previewOnly: true, copyType });
      try { URL.revokeObjectURL(r.blobUrl); } catch (e) {}
      const src = await PDFDocument.load(r.pdfBytes);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach(p => out.addPage(p));
    }
    const bytes = await out.save();

    if (currentBolBlobUrl) { try { URL.revokeObjectURL(currentBolBlobUrl); } catch (e) {} }
    currentBolBlobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    currentBolFilename = `BOL_${bol.bol_number || bol.id}.pdf`;
    document.getElementById('log-bol-view-iframe').src = currentBolBlobUrl;
    document.getElementById('log-bol-view-modal').hidden = false;
  } catch (e) {
    console.error('viewBolForJob failed:', e);
    alert('Failed to load BOL. Please try again.');
  }
}

function closeBolViewModal() {
  document.getElementById('log-bol-view-modal').hidden = true;
  document.getElementById('log-bol-view-iframe').src = '';
  if (currentBolBlobUrl) { try { URL.revokeObjectURL(currentBolBlobUrl); } catch (e) {} currentBolBlobUrl = null; }
}

function downloadBolFromViewer() {
  if (!currentBolBlobUrl) return;
  const a = document.createElement('a');
  a.href = currentBolBlobUrl; a.download = currentBolFilename;
  document.body.appendChild(a); a.click(); a.remove();
}

function buildActionButtons(shipment) {
```

### Edit 3 — calendar-popup link → in-page viewer

FIND (count == 1):
```
            <a href="/logistics/bol-generator.html?job_id=${esc(s.job_id)}" target="_blank" rel="noopener" style="font-size:13px;">📄 View BOL</a>
```
REPLACE:
```
            <a href="#" onclick="event.preventDefault();viewBolForJob('${esc(s.job_id)}')" style="font-size:13px;">📄 View BOL</a>
```

### Edit 4 — action button: View opens the viewer; Generate still opens the generator

FIND (count == 1):
```
  const bolLabel = Number(shipment.bol_count || 0) > 0 ? 'View BOL' : 'Generate BOL';
  return `<a class="logistics-action-btn action-load" href="/logistics/load-builder.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">Build Load</a> <a class="logistics-action-btn action-bol" href="/logistics/bol-generator.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">${bolLabel}</a>`;
```
REPLACE:
```
  const hasBol = Number(shipment.bol_count || 0) > 0;
  const bolBtn = hasBol
    ? `<a class="logistics-action-btn action-bol" href="#" onclick="event.stopPropagation();event.preventDefault();viewBolForJob('${shipment.job_id}')">View BOL</a>`
    : `<a class="logistics-action-btn action-bol" href="/logistics/bol-generator.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">Generate BOL</a>`;
  return `<a class="logistics-action-btn action-load" href="/logistics/load-builder.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">Build Load</a> ${bolBtn}`;
```

---

## Verify
- All FINDs `count == 1`. Extract the `logistics/index.html` script to a temp `.js` and `node --check`.
- On the dashboard, a shipment with a BOL: **View BOL** (action button and calendar popup) opens the
  in-page modal showing the rendered BOL (original + driver + customer), with Download working — it
  does **not** navigate to the generator.
- A shipment with no BOL still shows **Generate BOL** linking to the generator.
- Driver page has the QR; customer page doesn't; cursive shipper name present (with the font fix in).

## Notes
- The job board and loading viewers still render a single copy; if you want them to show the combined
  three copies too, that's the same small loop applied in their `viewBolForJob` — easy follow-on.
- Modal uses inline styles to match the existing logistics/loading modal pattern.

## What NOT to change
- Do NOT touch the worker, `bol-shared.js`, or the generator page.

## Deploy
```
git add logistics/index.html
git commit -m "P###: logistics View BOL renders the BOL inline (combined copies) instead of opening the generator"
git push
```
