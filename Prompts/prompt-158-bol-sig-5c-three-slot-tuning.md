# BOL Signatures #5C — `bol-test`: three slots (Customer / Carrier / Date) on both copies

> Assign a number before committing (likely **P158**). Edits the **already-shipped** P157 tuning aid
> in `logistics/bol-test.html`. The copyType selector is already present — this only swaps the
> single-"Signature" placeholder for the three real slots (customer sig, carrier sig, date), which
> go on **both** copies at the **same** coords.

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent**, `logistics/bol-test.html`
only. One edit.

## File
- `logistics/bol-test.html` — 1 edit (replace the placeholder stamp block)

---

### Edit — swap the single placeholder for three labeled slots

FIND (count == 1):
```
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
```

REPLACE:
```
    // Coord-tuning aid: stamp Customer Sig / Carrier Sig / Date placeholders. All three go on
    // BOTH copies at the SAME coords. KEEP IN SYNC with track/index.html.
    const SLOTS = {
      customer: { x: 380, y: 128, w: 160, h: 16 },  // Customer Signature line
      carrier:  { x: 430, y: 30,  w: 110, h: 16 },  // Carrier Signature (bottom)
      date:     { x: 548, y: 30,  w: 58,  h: 16 },  // Date Signed
    };
    const LABELS = { customer: 'Customer Sig', carrier: 'Carrier Sig', date: 'Date Signed' };
    let blobUrl = result.blobUrl;
    if (copyType) {
      const { PDFDocument, rgb } = PDFLib;
      const doc  = await PDFDocument.load(result.pdfBytes);
      const page = doc.getPages()[0];
      for (const key in SLOTS) {
        const c = SLOTS[key];
        page.drawRectangle({ x: c.x, y: c.y, width: c.w, height: c.h, borderColor: rgb(0.85, 0.1, 0.1), borderWidth: 1 });
        page.drawText(LABELS[key], { x: c.x + 4, y: c.y + (c.h / 2) - 4, size: 9, color: rgb(0.85, 0.1, 0.1) });
      }
      const bytes = await doc.save();
      blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      URL.revokeObjectURL(result.blobUrl);
    }
```

---

## Verify
- FIND `count == 1`.
- Extract the `bol-test.html` `<script>` block to a temp `.js` and `node --check` it.
- Render **Driver** → driver template + QR + three red labeled boxes (Customer Sig / Carrier Sig /
  Date Signed). Render **Customer** → customer template, no QR, the same three boxes.

## Tuning loop
1. Nudge the three `SLOTS` values until each red box sits on its green target from the markups;
   nudge `COORDS.qrCode` in `bol-shared.js` for the driver QR.
2. Hand me the final `SLOTS` values → they go into `track/index.html` in the track-correction
   prompt, where both copies get all three stamps.

## What NOT to change
- Do NOT touch the copyType selector (already shipped), `bol-shared.js`, `track/index.html`, or
  `buildBol`/the sample record.

## Deploy
```
git add logistics/bol-test.html
git commit -m "P###: bol-test — three slot placeholders (customer/carrier/date) on both copies"
git push
```
