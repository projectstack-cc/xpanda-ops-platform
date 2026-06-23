# BOL Signatures #6 — Track Correction: both signatures + date on BOTH copies

> Assign a number before committing (likely **P159**). Corrects the #3/#4 stamping model: each signed
> copy now carries the **customer signature, the carrier (driver) signature, and the signing date**,
> at the coords tuned in `bol-test`. The QR coord is already tuned in `bol-shared` (40, 222) — no
> change here.

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent**, `track/index.html`
only. No backend, no migration. (Reflects the as-shipped file at HEAD `fdc2fd9`.)

## Goal
Today each copy gets only its own single signature. Change it so **both** copies stamp all three:
customer signature (`customerSigPad`) at `SLOTS.customer`, carrier signature (`driverSigPad`) at
`SLOTS.carrier`, and the signing date at `SLOTS.date`. The submit gate already requires both pads, so
both signatures exist when these run.

## File
- `track/index.html` — 4 edits

---

### Edit 1 — replace `SIG_COORDS` with the tuned `SLOTS`

FIND (count == 1):
```
  const SIG_COORDS = {
    driver:   { x: 80,  y: 95, w: 190, h: 55 },
    customer: { x: 340, y: 95, w: 190, h: 55 },
  };
```
REPLACE:
```
  // Stamp slots (pdf-lib points, bottom-left origin). Both copies stamp all three at the same coords.
  const SLOTS = {
    customer: { x: 380, y: 175, w: 160, h: 16 },
    carrier:  { x: 390, y: 45,  w: 110, h: 16 },
    date:     { x: 513, y: 45,  w: 58,  h: 16 },
  };
```

### Edit 2 — replace `stampSignature` with `stampCopy` (both sigs + date)

FIND (count == 1):
```
  async function stampSignature(basePdfBytes, sigDataUrl, c) {
    const { PDFDocument } = PDFLib;
    const doc = await PDFDocument.load(basePdfBytes);
    const png = await doc.embedPng(sigDataUrl);
    doc.getPages()[0].drawImage(png, { x: c.x, y: c.y, width: c.w, height: c.h });
    return await doc.save();
  }
```
REPLACE:
```
  async function stampCopy(basePdfBytes) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const doc  = await PDFDocument.load(basePdfBytes);
    const page = doc.getPages()[0];
    const custPng = await doc.embedPng(customerSigPad.dataUrl());
    page.drawImage(custPng, { x: SLOTS.customer.x, y: SLOTS.customer.y, width: SLOTS.customer.w, height: SLOTS.customer.h });
    const carrPng = await doc.embedPng(driverSigPad.dataUrl());
    page.drawImage(carrPng, { x: SLOTS.carrier.x, y: SLOTS.carrier.y, width: SLOTS.carrier.w, height: SLOTS.carrier.h });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(new Date().toLocaleDateString('en-US'), { x: SLOTS.date.x + 2, y: SLOTS.date.y + 4, size: 11, font, color: rgb(0, 0, 0) });
    return await doc.save();
  }
```

### Edit 3 — `uploadSignedCopy` stamps all three (drop the per-pad arg)

FIND (count == 1):
```
  async function uploadSignedCopy(copyType, pad) {
    if (!pad || pad.isEmpty()) return;
    const bolForRender = { ...currentBol, access_token: token };
    const { pdfBytes } = await BolShared.generatePdf([bolForRender], { copyType });
    const coords  = copyType === 'driver' ? SIG_COORDS.driver : SIG_COORDS.customer;
    const stamped = await stampSignature(pdfBytes, pad.dataUrl(), coords);
    const docType = copyType === 'driver' ? 'driver_signed' : 'customer_signed';
```
REPLACE:
```
  async function uploadSignedCopy(copyType) {
    const bolForRender = { ...currentBol, access_token: token };
    const { pdfBytes } = await BolShared.generatePdf([bolForRender], { copyType });
    const stamped = await stampCopy(pdfBytes);
    const docType = copyType === 'driver' ? 'driver_signed' : 'customer_signed';
```

### Edit 4 — update the submit calls (no pad arg)

FIND (count == 1):
```
      await uploadSignedCopy('driver', driverSigPad);
      await uploadSignedCopy('customer', customerSigPad);
```
REPLACE:
```
      await uploadSignedCopy('driver');
      await uploadSignedCopy('customer');
```

---

## Verify
- All FINDs `count == 1`.
- Extract the `track/index.html` `<script>` block to a temp `.js` and `node --check` it.
- No remaining references to `SIG_COORDS` or `stampSignature` in the file (grep to confirm).
- End-to-end: sign both pads → Submit → both `driver_signed` and `customer_signed` show **both**
  signatures + the date, each in its slot; the driver copy also has the QR.

## What NOT to change
- Do NOT touch `bol-shared.js` (QR coord already tuned), the photo flow, auto-pack, or `STORAGE_KEY`.
- Submit-gate behavior (both pads required) stays as-is.
- No backend, no migration.

## Deploy
```
git add track/index.html
git commit -m "P###: both copies stamp customer sig + carrier sig + signing date at tuned coords"
git push
```
