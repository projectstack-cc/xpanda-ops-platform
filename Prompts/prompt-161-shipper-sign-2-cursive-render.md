# Shipper Auto-Sign #2 — Cursive Rendering (embed FRSCRIPT, draw on all copies)

> Assign a number before committing. **Depends on #1 (shipper_name foundation)** and on the
> QR-token prompt (P160) — both assumed landed. Steve has added `logistics/assets/FRSCRIPT.ttf`.
> Reflects HEAD `f792ea7` + P160 + shipper #1.

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent** —
`logistics/bol-shared.js` (single source of truth for BOL rendering), `logistics/bol-compose.js`,
and a one-line fontkit `<script>` on the four pages that render BOLs. No worker, no migration.

## Goal
Draw `bol.shipper_name` in a cursive font (Freestyle Script) at a shipper-signature slot on **all
copies** (default / driver / customer). pdf-lib needs `@pdf-lib/fontkit` registered to embed a custom
font. Everything is null-safe: if the font or fontkit fails to load, the signature is simply skipped
(no throw, no behavior change elsewhere).

## Files
- `logistics/bol-shared.js` — 4 edits (coord, font fetch, embed, draw)
- `logistics/bol-generator.html`, `logistics/load-builder.html`, `logistics/bol-test.html`,
  `track/index.html` — 1 edit each (load fontkit before `bol-shared.js`)
- `logistics/bol-compose.js` — 1 edit (inject name for the pre-save preview)

---

### Edit 1 — `bol-shared.js`: add the shipper-signature coord (PLACEHOLDER — tuned in #3)

FIND (count == 1):
```
    qrCode:        { x: 40, y: 222, size: 60 },
```
REPLACE:
```
    qrCode:        { x: 40, y: 222, size: 60 },
    // Shipper signature — cursive (FRSCRIPT), auto-signed with the generating user's display name.
    // PLACEHOLDER coords; tune in bol-test (#3).
    shipperSignature: { x: 90, y: 48, size: 22 },
```

### Edit 2 — `bol-shared.js`: fetch the cursive font once (null-safe)

FIND (count == 1):
```
    const templateBytes = await templateResp.arrayBuffer();

    const combinedPdf = await PDFDocument.create();
```
REPLACE:
```
    const templateBytes = await templateResp.arrayBuffer();

    // Cursive font for the shipper signature, embedded via fontkit. Fetched once; null-safe.
    let scriptFontBytes = null;
    try {
      const _ffResp = await fetch('/logistics/assets/FRSCRIPT.ttf');
      if (_ffResp.ok) scriptFontBytes = await _ffResp.arrayBuffer();
    } catch (_e) { scriptFontBytes = null; }

    const combinedPdf = await PDFDocument.create();
```

### Edit 3 — `bol-shared.js`: register fontkit + embed the font (per document)

FIND (count == 1):
```
      const font = await templateDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await templateDoc.embedFont(StandardFonts.HelveticaBold);
      const black = rgb(0, 0, 0);
```
REPLACE:
```
      const font = await templateDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await templateDoc.embedFont(StandardFonts.HelveticaBold);
      let cursive = null;
      if (scriptFontBytes && window.fontkit) {
        templateDoc.registerFontkit(window.fontkit);
        cursive = await templateDoc.embedFont(scriptFontBytes);
      }
      const black = rgb(0, 0, 0);
```

### Edit 4 — `bol-shared.js`: draw the signature on every copy (just before the QR block)

FIND (count == 1):
```
      // ── QR code (driver tracking link) ──
      if (opts.copyType !== 'customer' && bol.access_token && typeof qrcode === 'function') {
```
REPLACE:
```
      // ── Shipper signature (cursive, all copies) ──
      if (bol.shipper_name && cursive) {
        page.drawText(String(bol.shipper_name), {
          x: COORDS.shipperSignature.x,
          y: COORDS.shipperSignature.y,
          size: COORDS.shipperSignature.size || 22,
          font: cursive,
          color: black,
        });
      }

      // ── QR code (driver tracking link) ──
      if (opts.copyType !== 'customer' && bol.access_token && typeof qrcode === 'function') {
```

### Edits 5–8 — load fontkit before `bol-shared.js` on each BOL page

In **each** of `logistics/bol-generator.html`, `logistics/load-builder.html`,
`logistics/bol-test.html`, `track/index.html` —

FIND (count == 1 per file):
```
<script src="/logistics/bol-shared.js"></script>
```
REPLACE:
```
<script src="https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js"></script>
<script src="/logistics/bol-shared.js"></script>
```

### Edit 9 — `bol-compose.js`: inject the name for the pre-save preview

> Builds on P160's token map. The saved record always gets `shipper_name` from the worker (#1);
> this is so the cursive name also appears in the **review preview** before saving.

FIND (count == 1):
```
    const withTokens = records.map(r => r.access_token ? r : { ...r, access_token: crypto.randomUUID() });
    RR = { records: withTokens, idx: 0, blobUrl: null, opts: opts || {} };
```
REPLACE:
```
    const _me = (window.__xpandaUser && window.__xpandaUser.displayName) || '';
    const prepared = records.map(r => {
      const rec = r.access_token ? r : { ...r, access_token: crypto.randomUUID() };
      return rec.shipper_name ? rec : { ...rec, shipper_name: _me };
    });
    RR = { records: prepared, idx: 0, blobUrl: null, opts: opts || {} };
```

---

## Verify
- All FINDs `count == 1` (the page-include FIND is `count == 1` **within each file**).
- Extract the `bol-shared.js` and `bol-compose.js` scripts to temp `.js` and `node --check` both.
- Confirm `FRSCRIPT.ttf` is reachable at `/logistics/assets/FRSCRIPT.ttf` (200, correct MIME) — load
  the URL directly in the browser.
- Render a saved BOL (which now has `shipper_name` from #1): the display name appears in **cursive**
  on the default, driver, and customer copies. Generate a new BOL: the name shows in the review
  **preview** (from Edit 9) and persists.
- **Graceful degradation:** if fontkit/font fail to load, the BOL still renders — just without the
  signature. Confirm no throw.
- **Placement will be wrong on first render** — `shipperSignature` is a placeholder. Note where it
  lands; #3 dials it in via bol-test. Do **not** guess-nudge it here.

## What NOT to change
- Do NOT change other `COORDS`, the QR logic, the customer-copy QR suppression, or any field draw.
- Do NOT touch the worker, auto-pack, `STORAGE_KEY`, or the Load Builder save loop.
- No migration.

## Deploy
```
git add logistics/bol-shared.js logistics/bol-compose.js logistics/bol-generator.html logistics/load-builder.html logistics/bol-test.html track/index.html
git commit -m "P###: cursive shipper signature on all BOL copies (embed FRSCRIPT via fontkit) + preview injection"
git push
```
