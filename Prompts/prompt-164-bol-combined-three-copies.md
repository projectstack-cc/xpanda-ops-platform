# BOL Output Parity — One combined PDF: original + driver + customer (both consumers)

> Assign a number before committing. Makes `bol-generator` and load-builder produce **identical**
> BOL output by routing both through one shared helper. Reflects HEAD `a66e5e2`.
> **Land the font-case fix first** (`prompt-fix-font-case-crash`) — `generatePdf` must not crash, since
> this calls it three times per generate.

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent** —
`logistics/bol-compose.js` only. No worker, no migration, no `bol-shared.js` change.

## Background / why
`copyType` (driver/customer templates) was scaffolded in `bol-shared` but never wired into Generate.
Both review paths — `rrRegenerate`/`rrApprove` (bol-generator) and `generateBolPdf`/`showReview`
(load-builder) — call `generatePdf` once with **no** `copyType`, so they only ever output the default
("original") BOL. This adds a single shared helper that builds **one combined PDF** with all three
copies per BOL (original → driver → customer), packing slip appended once, and points both paths at it.

## Files
- `logistics/bol-compose.js` — add helper + reroute both generators (2 edits)

---

### Edit 1 — add `generateCombinedCopies` and route `generateBolPdf` through it

FIND (count == 1):
```
  async function generateBolPdf(bolRecords, bm) {
    const append = (OPTS && OPTS.buildAppendBytes) ? await OPTS.buildAppendBytes(bm) : null;
    const result = await BolShared.generatePdf(bolRecords, { previewOnly: true, packingSlipPdfBytes: append });
    return result.blobUrl;
  }
```
REPLACE:
```
  // ONE combined PDF with all three copies per BOL — original, driver, customer — then the packing
  // slip once. Single source of truth so bol-generator and load-builder produce identical output.
  async function generateCombinedCopies(records, append) {
    const { PDFDocument } = PDFLib;
    const out = await PDFDocument.create();
    for (const copyType of [undefined, 'driver', 'customer']) {
      const r = await BolShared.generatePdf(records, { previewOnly: true, copyType });
      try { URL.revokeObjectURL(r.blobUrl); } catch (_e) {}
      const src = await PDFDocument.load(r.pdfBytes);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach(p => out.addPage(p));
    }
    if (append) {
      const ap = await PDFDocument.load(append);
      const apages = await out.copyPages(ap, ap.getPageIndices());
      apages.forEach(p => out.addPage(p));
    }
    const pdfBytes = await out.save();
    const blobUrl = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
    return { blobUrl, pdfBytes };
  }

  async function generateBolPdf(bolRecords, bm) {
    const append = (OPTS && OPTS.buildAppendBytes) ? await OPTS.buildAppendBytes(bm) : null;
    const { blobUrl } = await generateCombinedCopies(bolRecords, append);
    return blobUrl;
  }
```

### Edit 2 — route the bol-generator path (`rrRegenerate`) through the same helper

FIND (count == 1):
```
  async function rrRegenerate() {
    const append = RR.opts.buildAppendBytes ? await RR.opts.buildAppendBytes() : null;
    const result = await BolShared.generatePdf(RR.records, { previewOnly: true, packingSlipPdfBytes: append });
    if (RR.blobUrl) URL.revokeObjectURL(RR.blobUrl);
    RR.blobUrl = result.blobUrl;
  }
```
REPLACE:
```
  async function rrRegenerate() {
    const append = RR.opts.buildAppendBytes ? await RR.opts.buildAppendBytes() : null;
    const result = await generateCombinedCopies(RR.records, append);
    if (RR.blobUrl) URL.revokeObjectURL(RR.blobUrl);
    RR.blobUrl = result.blobUrl;
  }
```

---

## Verify
- Both FINDs `count == 1`. Extract the `bol-compose.js` script to a temp `.js` and `node --check` it.
- Confirm `PDFLib` is the global pdf-lib namespace used elsewhere (it's what `bol-shared.js`
  destructures) and is loaded on both bol-generator and load-builder.
- Generate from **bol-generator**: the review preview and the approved output are ONE PDF whose pages
  are original → driver → customer (per BOL), packing slip last when present.
- Generate from **load-builder**: identical structure.
- Driver page shows the QR; customer page does **not**; the cursive shipper name appears on all three
  (once the font fix is in).
- Multi-record (multi-trailer) still works: each record contributes its three copies in order.

## Notes
- Preview now shows all three copies — that's intended (it's exactly what prints).
- Delivery mechanism is unchanged per path (load-builder downloads, bol-generator opens via
  `openPdf`). If you want bol-generator to download like load-builder too, that's a separate small change.

## What NOT to change
- Do NOT modify `bol-shared.js`, the `copyType` templates/QR-suppression, auto-pack, or `STORAGE_KEY`.
- Do NOT pass `packingSlipPdfBytes` into the per-copy `generatePdf` calls — the slip is appended once
  in the helper (passing it per copy would triplicate it).

## Deploy
```
git add logistics/bol-compose.js
git commit -m "P###: combined 3-copy BOL output (original+driver+customer) via shared BolCompose helper — bol-generator + load-builder parity"
git push
```
