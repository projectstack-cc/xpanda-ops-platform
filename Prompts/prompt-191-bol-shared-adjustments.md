# Prompt 191 — BOL surgical adjustments (bol-shared.js)

## Required reading (do this first)
1. Read **`AGENTS.md`** (platform-wide rules).
2. Read **`xpanda-ops-agents.md`** and operate as the **logistics-agent**. This task touches the BOL coordinate single-source-of-truth (`logistics/bol-shared.js`), which the logistics-agent owns.

## Source of truth
- Branch: **`main`**. Clone/pull `main` before doing anything; `main` is production.
- File touched: **`logistics/bol-shared.js`** — ONLY this file.
- Frontend-only. **No worker change. No DB migration. No other file.**

## Hard constraints
- Do **not** touch the auto-pack algorithm or anything in `load-builder.html`.
- Do **not** change any `STORAGE_KEY`.
- Do **not** alter any rendering **colors** in `bol-shared.js` (color work is out of scope here).
- All find/replace blocks below are **byte-exact**. Before each replacement, verify uniqueness:
  - `grep -cF "<anchor>" logistics/bol-shared.js` must return **exactly `1`**. If it is not `1`, STOP and report — do not guess.
- After all edits, run **`node --check logistics/bol-shared.js`** and confirm it passes. (`bol-shared.js` is a plain `.js` file — check it directly; no inline-script extraction needed.)

---

## Edit 1 — BOL/INV # font size 18 → 22

FIND (exact, count must == 1):
```
    bolNumber:     { x: 408, y: 690, size: 18, bold: true },
```
REPLACE:
```
    bolNumber:     { x: 408, y: 690, size: 22, bold: true },
```

---

## Edit 2 — Move POC (Contact Info) field up 30 points

pdf-lib origin is bottom-left, so "up 30" means `y` increases by 30: `495 → 525`. Only `y` changes.

FIND (exact, count must == 1):
```
    contactInfo:   { x: 315, y: 495, size: 12, lineH: 13, maxW: 255 },
```
REPLACE:
```
    contactInfo:   { x: 315, y: 525, size: 12, lineH: 13, maxW: 255 },
```

---

## Edit 3 — Bold the "PO:" label, leave the PO number regular

The PO/Invoice block currently draws `'PO: ' + value` through `drawMultiline` in a single regular font. Split the **default** path so the label **`PO:`** renders in `fontBold` and the number stays in the regular `font`, offset by the measured bold-label width. The **override path** (`_ov.poNumber` is an array of literal user-entered lines — no `PO:` prefix exists there) must keep using `drawMultiline` and stay visually unchanged. `fontBold` and the regular `font` are already embedded earlier in this same render loop, and `black`, `page`, and the `off(...)` offset helper are all already in scope at this point — reuse them, do not re-declare.

FIND (exact, count must == 1):
```
      // ── PO / Invoice Number ──
      // Override arrives as literal lines — draw verbatim (no 'PO: ' prefix added).
      const _poVal = Array.isArray(_ov.poNumber)
        ? _ov.poNumber.join('\n')
        : (() => { const v = bol.po_number || bol.poNumber || ''; return v ? 'PO: ' + v : ''; })();
      if (_poVal) drawMultiline(_poVal, off('poNumber', COORDS.poNumber));
```
REPLACE:
```
      // ── PO / Invoice Number ──
      // Override arrives as literal lines — draw verbatim (no 'PO: ' prefix added).
      // Default path: bold "PO:" label, regular PO number offset by the label width.
      if (Array.isArray(_ov.poNumber)) {
        const _poVal = _ov.poNumber.join('\n');
        if (_poVal) drawMultiline(_poVal, off('poNumber', COORDS.poNumber));
      } else {
        const _poNum = bol.po_number || bol.poNumber || '';
        if (_poNum) {
          const _pc = off('poNumber', COORDS.poNumber);
          const _poSize = _pc.size || 12;
          const _poLabel = 'PO:';
          page.drawText(_poLabel, { x: _pc.x, y: _pc.y, size: _poSize, font: fontBold, color: black });
          const _poLabelW = fontBold.widthOfTextAtSize(_poLabel + ' ', _poSize);
          page.drawText(String(_poNum), { x: _pc.x + _poLabelW, y: _pc.y, size: _poSize, font, color: black });
        }
      }
```

Notes:
- `_poSize` falls back to `12` to match the existing `poNumber` coord size, and respects any size that arrives via the `off(...)`/coord path.
- The bold label is measured **with a trailing space** (`'PO: '`) so the number sits one space-width after the colon, matching the old `'PO: ' + v` spacing.
- The default PO line is short and single-line in practice; this intentionally does not wrap (the prior `maxW` wrapping only ever mattered for the multiline override path, which is preserved above).

---

## Verification checklist (report results)
1. Each of the three FIND anchors returned `grep -cF` count == `1` before replacement.
2. All three replacements applied.
3. `node --check logistics/bol-shared.js` → passes.
4. Confirm no color values, no other file, no worker, and no migration were touched.

## Deliverable
Commit the single-file change to `logistics/bol-shared.js` on `main`.
