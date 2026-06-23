# Prompt 178 — "Hide tracking QR code" toggle on the BOL generator (generation-time, default off)

## Required reading (do this first)
1. Read `AGENTS.md` (platform conventions).
2. Read `xpanda-ops-agents.md` (multi-agent definition).
3. Assume the **logistics-agent** role. Two files: `logistics/bol-compose.js` (toggle + threading) and `logistics/bol-shared.js` (render gate). Frontend only. No DB migration, no worker change, no permission key.

## Context
The driver-tracking QR is drawn on the original + driver BOL copies in `bol-shared.js` (gated on `copyType !== 'customer' && bol.access_token`). Until driver tracking is fully tested, ops wants the option to leave the QR off the printed BOL so drivers don't scan a not-yet-vetted flow.

This adds a **"Hide tracking QR code"** checkbox to the BOL modal (next to "Include packing slip" / "Include Loading Diagram"), **default unchecked** (QR shows as today). When checked, the generated/downloaded BOL omits the QR on every copy. This is **generation-time only** — the flag is not persisted, so re-opening a saved BOL via "View BOL" will render with the QR again (acceptable per scoping; the concern is the printed copy the driver receives).

All edits are byte-exact, each verified to appear exactly once at HEAD. Confirm `count == 1` before applying.

---

## Edit 1 — Render gate honors the flag (`logistics/bol-shared.js`)
FIND (exactly once):
```
      if (opts.copyType !== 'customer' && bol.access_token && typeof qrcode === 'function') {
```
REPLACE:
```
      if (opts.copyType !== 'customer' && !opts.hideQr && bol.access_token && typeof qrcode === 'function') {
```

---

## Edit 2 — Modal state default (`logistics/bol-compose.js`)
FIND (exactly once):
```
      includePacking: false,
      includeLoadingDiagram: false,
    };
```
REPLACE:
```
      includePacking: false,
      includeLoadingDiagram: false,
      hideQr: false,
    };
```

---

## Edit 3 — Thread the flag into the combined-copy generator (`logistics/bol-compose.js`)
FIND (exactly once):
```
  async function generateCombinedCopies(records, append) {
    const { PDFDocument } = PDFLib;
    const out = await PDFDocument.create();
    for (const copyType of [undefined, 'driver', 'customer']) {
      const r = await BolShared.generatePdf(records, { previewOnly: true, copyType });
```
REPLACE:
```
  async function generateCombinedCopies(records, append, hideQr) {
    const { PDFDocument } = PDFLib;
    const out = await PDFDocument.create();
    for (const copyType of [undefined, 'driver', 'customer']) {
      const r = await BolShared.generatePdf(records, { previewOnly: true, copyType, hideQr: !!hideQr });
```

---

## Edit 4 — Pass the toggle from the modal generate path (`logistics/bol-compose.js`)
`BM` is the module-scoped modal state; read the toggle from it directly.
FIND (exactly once):
```
    const { blobUrl } = await generateCombinedCopies(bolRecords, append);
```
REPLACE:
```
    const { blobUrl } = await generateCombinedCopies(bolRecords, append, BM && BM.hideQr);
```

---

## Edit 5 — Add the checkbox to the footer (`logistics/bol-compose.js`)
Mirrors the existing "Include Loading Diagram" toggle pattern.
FIND (exactly once):
```
      diagramLabel.appendChild(document.createTextNode('Include Loading Diagram'));
      footer.appendChild(diagramLabel);
    }
    const navRight = h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } });
```
REPLACE:
```
      diagramLabel.appendChild(document.createTextNode('Include Loading Diagram'));
      footer.appendChild(diagramLabel);
    }
    {
      const qrLabel = h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', cursor: 'pointer', color: 'var(--text-muted)' } });
      const qrChk = h('input', { type: 'checkbox' });
      qrChk.checked = BM.hideQr;
      qrChk.addEventListener('change', e => { BM.hideQr = e.target.checked; });
      qrLabel.appendChild(qrChk);
      qrLabel.appendChild(document.createTextNode('Hide tracking QR code'));
      footer.appendChild(qrLabel);
    }
    const navRight = h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } });
```

---

## Step 6 — Validation
Both files are standalone `.js`:
- `node --check logistics/bol-shared.js`
- `node --check logistics/bol-compose.js`

## Step 7 — Manual sanity (notes for Steve)
- Open the BOL modal (load-builder or dashboard): "Hide tracking QR code" appears unchecked; generating produces a BOL **with** the QR (unchanged default).
- Check it, generate: the downloaded BOL (all copies) has **no** QR.
- Note: this affects the generated/printed PDF only; "View BOL" on a previously saved BOL re-renders with the QR (not persisted, by design).

## What NOT to change
- Do NOT add a `bols` column or migration — this is generation-time only.
- Do NOT change the `customer` copy behavior (it already never gets a QR), the `access_token` logic, or the driver track pages.
- Do NOT touch the reviewRecords/`rrApprove` path, the worker, or any other file.

## Deliverables summary
- `logistics/bol-shared.js` — QR gate also checks `!opts.hideQr`.
- `logistics/bol-compose.js` — `hideQr` state (default false), threaded through `generateBolPdf` → `generateCombinedCopies` → `generatePdf`, plus the footer checkbox.
- Both files pass `node --check`.
