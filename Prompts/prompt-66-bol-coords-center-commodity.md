# Prompt 66 — BOL COORDS: Center & Auto-Size Commodity, Enlarge Time + Scrap Marks

## Goal

A set of small, independent visual adjustments to the BOL PDF output. **All changes are made in `logistics/bol-shared.js` only** — the single source of truth for BOL coordinates. Because both `bol-generator.html` and `load-builder.html` consume this file, both BOL outputs pick up every change automatically. That is intended.

1. **Center the commodity description text horizontally** in its box (currently left-aligned).
2. **Auto-size the commodity description font** by how many lines it wraps to (fewer lines → larger font).
3. **Enlarge the delivery-time font** (currently size 20).
4. **Enlarge the scrap pick-up "X" marks** and nudge their position to stay centered in the checkboxes.

**Read `AGENTS.md` before starting. Follow all rules strictly. Do NOT touch any file other than `logistics/bol-shared.js`. No DB migration, no API change, no other module. Make only the edits described below — do not refactor anything else.**

---

## Fix 1 — Center the commodity description

### Step 1a: Add a `center` flag to the commodity coord

In the `COORDS` object near the top of `bol-shared.js`, find this exact line:

```javascript
    // Commodity description
    commodity:     { x: 55,  y: 410, size: 13, lineH: 28, maxW: 510 },
```

Add `center: true` (size/lineH here become defaults; Fix 2 overrides them at render time):

```javascript
    // Commodity description (size/lineH set dynamically — see commodity render block)
    commodity:     { x: 55,  y: 410, size: 13, lineH: 28, maxW: 510, center: true },
```

### Step 1b: Teach `drawMultiline` to honor the `center` flag

Find the `drawMultiline` helper inside `generatePdf` (begins `const drawMultiline = (text, coord) => {`). It currently reads:

```javascript
      const drawMultiline = (text, coord) => {
        if (!text) return;
        const size = coord.size || 10;
        const lineH = coord.lineH || 12;
        const maxW = coord.maxW || 250;
        const wrappedLines = wrapText(String(text), font, size, maxW);
        wrappedLines.forEach((line, i) => {
          page.drawText(line, {
            x: coord.x,
            y: coord.y - (i * lineH),
            size,
            font,
            color: black,
            maxWidth: maxW,
          });
        });
      };
```

Replace it with this version. It centers each pre-wrapped line within `[coord.x, coord.x + maxW]` only when `coord.center` is set; otherwise behavior is identical to before:

```javascript
      const drawMultiline = (text, coord) => {
        if (!text) return;
        const size = coord.size || 10;
        const lineH = coord.lineH || 12;
        const maxW = coord.maxW || 250;
        const wrappedLines = wrapText(String(text), font, size, maxW);
        wrappedLines.forEach((line, i) => {
          const opts = {
            x: coord.x,
            y: coord.y - (i * lineH),
            size,
            font,
            color: black,
          };
          if (coord.center && line) {
            const lineWidth = font.widthOfTextAtSize(line, size);
            opts.x = coord.x + (maxW - lineWidth) / 2;
          } else {
            opts.maxWidth = maxW;
          }
          page.drawText(line, opts);
        });
      };
```

**Implementer notes:** `wrapText` already breaks text into lines that fit within `maxW`, so each line width is `<= maxW` and the offset is always `>= 0`. When centering, `maxWidth` is intentionally omitted (it would make pdf-lib re-wrap relative to the shifted `x`, fighting the centering). Do not change `wrapText`, `drawText`, or `buildShipToLines`.

---

## Fix 2 — Auto-size the commodity description by line count

The commodity font should shrink as the text gets longer:

| Wrapped lines | Font size | Line height |
|---------------|-----------|-------------|
| 1–2 lines     | 24        | 30          |
| 3–5 lines     | 20        | 26          |
| 6+ lines      | 18        | 22          |

Find the current commodity render line inside the per-BOL loop:

```javascript
      // ── Commodity description ──
      drawMultiline(bol.commodity_description, COORDS.commodity);
```

Replace it with a tiered block. For each tier (largest first), it wraps at that tier's size and uses the first tier whose line count fits the tier's allowance. The chosen size/lineH are spread onto a copy of `COORDS.commodity`, which preserves `center: true` from Fix 1:

```javascript
      // ── Commodity description (centered, auto-sized by wrapped line count) ──
      if (bol.commodity_description) {
        // [size, lineH, max wrapped lines allowed at this size] — tune freely
        const commodityTiers = [
          { size: 24, lineH: 30, maxLines: 2 },
          { size: 20, lineH: 26, maxLines: 5 },
          { size: 18, lineH: 22, maxLines: Infinity },
        ];
        let chosen = commodityTiers[commodityTiers.length - 1];
        for (const tier of commodityTiers) {
          const lineCount = wrapText(String(bol.commodity_description), font, tier.size, COORDS.commodity.maxW).length;
          if (lineCount <= tier.maxLines) { chosen = tier; break; }
        }
        drawMultiline(bol.commodity_description, { ...COORDS.commodity, size: chosen.size, lineH: chosen.lineH });
      }
```

**Implementer notes:** Line count is re-evaluated per tier because wrapping depends on font size (smaller font → fewer lines). The `Infinity` tier always matches, so 18 is the floor. Do not modify `wrapText`. The `commodityTiers` array is the single place to tune sizes, line heights, and thresholds.

**Tuning note for Steve:** `y: 410` is the *baseline of the first line*. A 24pt line sits taller above that baseline than a 13pt line did, so a single large line may want a slightly lower `y`. If vertical placement drifts between tiers after a test print, the cleanest fix is to add an optional `y` override per tier and apply it in the spread (e.g. `{ ...COORDS.commodity, size: chosen.size, lineH: chosen.lineH, y: chosen.y ?? COORDS.commodity.y }`). Left out for now to keep this minimal — flag it if you see drift.

---

## Fix 3 — Enlarge the delivery-time font

In the `COORDS` object, find:

```javascript
    // Delivery time — top-right, bold red
    deliveryTime:  { x: 390, y: 758, size: 20 },
```

Bump `size` from `20` to `24`:

```javascript
    // Delivery time — top-right, bold red
    deliveryTime:  { x: 390, y: 758, size: 24 },
```

The render block already reads `size: COORDS.deliveryTime.size`, so no other change is needed. `24` is a single tunable integer.

---

## Fix 4 — Enlarge the scrap pick-up "X" marks and recenter

The scrap marks are drawn as the literal text `'X'` via `drawText` at fixed coords. Growing the font grows the glyph from its baseline-left anchor, so to keep each `X` centered in its checkbox the `x` shifts slightly left and the `y` slightly down.

In the `COORDS` object, find:

```javascript
    // Scrap Pick Up checkboxes
    scrapYes:      { x: 110, y: 513, size: 10 },
    scrapNo:       { x: 110, y: 497, size: 10 },
```

Change to (size up to 13, x/y nudged to recenter):

```javascript
    // Scrap Pick Up checkboxes
    scrapYes:      { x: 109, y: 512, size: 13 },
    scrapNo:       { x: 109, y: 496, size: 13 },
```

**Tuning note for Steve:** These are starting values. If the `X` sits off-center after a test print: larger font → move `x` further *left* and `y` further *down* to recenter; smaller → the reverse. The render path is unchanged (`drawText('X', COORDS.scrapYes)` / `scrapNo`) — only the three numbers per coord change.

---

## Scope Constraints (strict)

- **One file only:** `logistics/bol-shared.js`.
- **Edits total:** (1) `commodity` coord gets `center: true`; (2) `drawMultiline` replaced; (3) commodity render line replaced with the tiered block; (4) `deliveryTime` size → 24; (5) `scrapYes` / `scrapNo` coords updated.
- Do **not** alter any other `COORDS` entry, any other render call, the `wrapText` / `drawText` / `buildShipToLines` helpers, the toast/confirm logic, or the export block.
- No DB migration. No `_worker.js` change. No change to `bol-generator.html` or `load-builder.html`.
- Do not refactor or "improve" anything outside the edits above.

## Manual steps after build

- None beyond commit. No migration to run. Verify by generating BOLs from **both** the BOL generator and the load builder:
  - Commodity description is horizontally centered and sized by length (short → large, long → small).
  - Delivery time renders slightly larger.
  - Scrap pick-up `X` is larger and still centered in its checkbox.
