# BOL Signatures #5B — `bol-test` Coord-Tuning Aid (copyType + "Signature" placeholder)

> Assign a number before committing (likely **P157**). Makes `logistics/bol-test.html` the single
> surface for eyeballing the driver-copy QR position and the signature placement. No `bol-shared` or
> `track/` changes — `SIG_COORDS` stays in `track/index.html`; this mirrors the values for preview.

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent**, `logistics/bol-test.html`
only. pdf-lib is already loaded on this page.

## Goal
Add a **Copy type** toggle (Default / Driver / Customer) and, when driver/customer is selected, draw
a red **"Signature"** placeholder box at the same coords `track/` stamps the real signature. Driver
copy also shows the QR (via `copyType`), so the QR box and signature box can both be tuned here. Tune
the values, then copy the finals into `SIG_COORDS` in `track/index.html` and `COORDS.qrCode` in
`bol-shared.js`.

## File
- `logistics/bol-test.html` — 2 edits

---

### Edit 1 — Copy type selector

FIND (count == 1):
```
        <div class="btest-actions">
          <button class="btn primary" id="btn-render">Render BOL</button>
```
REPLACE:
```
        <label style="display:block;margin:8px 0;font-size:13px;">Copy type
          <select id="btest-copytype" style="margin-left:8px;">
            <option value="">Default</option>
            <option value="driver">Driver (QR + sig)</option>
            <option value="customer">Customer (sig, no QR)</option>
          </select>
        </label>

        <div class="btest-actions">
          <button class="btn primary" id="btn-render">Render BOL</button>
```

### Edit 2 — thread `copyType` + stamp the "Signature" placeholder

FIND (count == 1):
```
    const bol    = buildBol();
    const result = await BolShared.generatePdf([bol], { previewOnly: true });

    currentBlobUrl = result.blobUrl;
    iframe.src     = currentBlobUrl;
```
REPLACE:
```
    const bol      = buildBol();
    const copyType = document.getElementById('btest-copytype').value || undefined;
    const result   = await BolShared.generatePdf([bol], { copyType, previewOnly: true });

    // Coord-tuning aid: stamp a "Signature" placeholder where track/ stamps the real signature.
    // KEEP IN SYNC with SIG_COORDS in track/index.html.
    const SIG_COORDS = {
      driver:   { x: 80,  y: 95, w: 190, h: 55 },
      customer: { x: 340, y: 95, w: 190, h: 55 },
    };
    let blobUrl = result.blobUrl;
    if (copyType && SIG_COORDS[copyType]) {
      const { PDFDocument, rgb } = PDFLib;
      const doc  = await PDFDocument.load(result.pdfBytes);
      const page = doc.getPages()[0];
      const c    = SIG_COORDS[copyType];
      page.drawRectangle({ x: c.x, y: c.y, width: c.w, height: c.h, borderColor: rgb(0.85, 0.1, 0.1), borderWidth: 1 });
      page.drawText('Signature', { x: c.x + 6, y: c.y + (c.h / 2) - 6, size: 12, color: rgb(0.85, 0.1, 0.1) });
      const bytes = await doc.save();
      blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      URL.revokeObjectURL(result.blobUrl);
    }

    currentBlobUrl = blobUrl;
    iframe.src     = currentBlobUrl;
```

---

## Verify
- Both FINDs `count == 1`.
- Extract the `bol-test.html` `<script>` block to a temp `.js` and `node --check` it.
- Render with **Driver** → driver template, QR at `COORDS.qrCode`, red "Signature" box at the driver
  coords. Render with **Customer** → customer template, no QR, signature box at customer coords.
- The sample BOL already has `access_token: 'TESTTOKEN123'`, so the driver QR draws.

## Tuning loop (after this lands)
1. In `bol-test`, render Driver/Customer; nudge the `SIG_COORDS` values here until the box sits on
   the template's signature line; nudge `COORDS.qrCode` in `bol-shared.js` for the driver QR box.
2. Copy the final `SIG_COORDS` into `track/index.html`, and keep `COORDS.qrCode` in `bol-shared.js`.

## What NOT to change
- Do NOT edit `bol-shared.js` or `track/index.html` in this prompt.
- Do NOT change `buildBol`, the sample record, or auto-pack/`STORAGE_KEY`.

## Deploy
```
git add logistics/bol-test.html
git commit -m "P###: bol-test copyType toggle + Signature placeholder for QR/signature coord tuning"
git push
```
