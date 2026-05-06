# Load Builder — Per-SKU Rotation Override + Dead Space Label on SVG

You are working inside the xPanda Operations Platform repository. Follow all rules defined in AGENTS.md.

---

## Context

The Load Builder at `/logistics/load-builder.html` currently uses a **fixed orientation** for all SKUs — each block's length, width, and height are used as-is when packing into the trailer. Length maps to the trailer's length axis (front-to-back), width maps to the trailer's width axis (side-to-side), and height maps to the vertical stacking axis. No rotation is attempted.

This fixed behavior is correct as the default and must remain the default. However, some specific SKUs benefit from being rotated (e.g., a part that is 96"L × 24"W could be rotated to 24"L × 96"W to pack differently). We need a **per-SKU opt-in** for rotation, not a global toggle.

---

## Feature 1: Per-SKU "Allow Rotation" Checkbox

### Data Model Change

Add a new boolean field to each SKU object:

```
allowRotation: false  // default
```

This field must be:
- Saved to and loaded from localStorage (same `foam_trailer_loader_v31` key)
- Included when loading DEFAULT_SKUS (default `false` for all)
- Preserved during edit, copy, CSV import/export
- Backward-compatible: if an existing localStorage entry is missing this field, default to `false`

### UI Changes

#### SKU Cards on LOAD Tab

Add a small, unobtrusive indicator on each SKU card when `allowRotation` is true. Something like a small "↻ ROTATE" tag or badge near the dimensions text. Don't show anything if `allowRotation` is false — keep it clean by default.

#### SKU Form (Add/Edit on SKUS Tab)

Add a checkbox to the SKU add/edit form:

- Label: `Allow rotation when loading`
- Help text (subtle, below the checkbox): `When checked, the algorithm may rotate this SKU's length and width for better trailer fit`
- Default: unchecked
- Position: below the Notes field, before the action buttons

#### SKU List on SKUS Tab

Show a small "↻" icon or "ROTATE" tag next to the dimensions display for SKUs that have `allowRotation: true`.

#### CSV Import/Export

- Export: add an `allowRotation` column (values: `true` or `false`)
- Import: parse the column if present, default to `false` if missing
- This keeps backward compatibility with CSV data that doesn't include the column

### Algorithm Changes

#### In `buildDemand`

When building the demand list from the cart, if a SKU has `allowRotation: true`, generate **two demand entries** for that SKU — one with original dimensions and one with length and width swapped:

- Entry 1: original `{ length, width, height }` — labeled as the original SKU name
- Entry 2: swapped `{ length: width, width: length, height }` — labeled as the original SKU name + " (rotated)"

Both entries share the same cart quantity as their pool. The algorithm should treat them as alternative orientations competing for the same demand. When a piece is placed from either entry, it deducts from a shared remaining count. The simplest approach:

- Create a single demand entry but before the algorithm runs, check if the rotated orientation allows more pieces per stack or better packing. Pick the better orientation for that SKU and use it.
- OR: create both demand entries with the same `skuId` but different effective dimensions, and use a shared remaining counter. When the algorithm places units from one orientation, it reduces the remaining count for both.

**Preferred approach (simpler):** Before building demand, for each SKU with `allowRotation: true`, evaluate both orientations and pick the one that yields more pieces per stack (`Math.floor(dims.height / sku.height)` is the same either way since height doesn't rotate — but `Math.floor(dims.width / sku.width)` columns per row changes, and `Math.floor(dims.length / sku.length)` rows along the trailer changes). Pick the orientation that yields the better packing and substitute the SKU's effective dimensions in the demand entry. This avoids the complexity of dual demand entries.

**Important constraints:**
- Height is NEVER rotated — only length and width may swap. Blocks are always stacked vertically on their height axis.
- The original SKU data in the library is never mutated. The rotation is applied only in the demand/algorithm layer.
- When displaying results (packing list, stack breakdown, SVG), use the original SKU name — but add a "(rotated)" indicator if the rotated orientation was used.

#### Validation

In `buildDemand`, after applying rotation, still validate that the effective dimensions fit within the trailer (`effectiveLength <= dims.length && effectiveWidth <= dims.width && effectiveHeight <= dims.height`). If the rotated orientation doesn't fit, fall back to the original.

---

## Feature 2: Remaining Space Label on SVG

### Current Behavior

The SVG trailer layout (`buildTopViewSVG` function) already renders the empty/unused space at the end of the trailer as a hatched pattern rectangle (`url(#ep)`). But it doesn't tell you *how much* space is left.

### Required Change

Add a text label centered on the hatched empty area showing the remaining length in both feet and inches.

**Format:** `XX' YY" remaining` (e.g., `12' 6" remaining` or `8' 0" remaining`)

If the remaining space is less than 12 inches, show only inches: `8" remaining`

**Styling:**
- Centered horizontally and vertically within the hatched empty rectangle
- Font color: `#94A3B8` (muted gray, matching the existing dimension labels)
- Font size: scale to fit — use a base size of 11px but reduce if the empty area is narrow
- Font weight: 700
- Only render this label if the empty width in pixels (`emptyW`) is greater than 40px — if the remaining space is too small to fit a readable label, skip it

**Calculation:**
```
remainingInches = dims.length - trailer.usedLength
remainingFeet = Math.floor(remainingInches / 12)
remainingInchesRemainder = remainingInches % 12
```

### Also apply to `buildPrintSvg`

Add the same remaining space label to the print version SVG (`buildPrintSvg` function) so the printed packing slip also shows remaining trailer space. Use a slightly larger font (14-16px base) for print readability.

---

## What NOT to Change

- The default no-rotation behavior for existing SKUs
- The two-pass loading strategy (same-size stacks first, mixed fill second) — rotation is a pre-processing step that happens before the algorithm runs
- The manual trailer editor
- The `exactFillHeight` function
- The print packing slip HTML layout (only the SVG within it changes)
- Any platform chrome (header, footer, shared CSS)
- The `STORAGE_KEY` value

---

## Rules

- No frameworks. Vanilla HTML, CSS, JavaScript only.
- Backward-compatible with existing localStorage data — missing `allowRotation` field defaults to `false`
- All existing functionality must continue to work unchanged for SKUs without rotation enabled
