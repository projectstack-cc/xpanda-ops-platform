# Prompt 08 — Load Builder: Fix Parent Row Cart Controls Alignment

You are working inside the xPanda Operations Platform repository.
Follow all rules in AGENTS.md.

---

## Objective

Two small fixes to the parent SKU row in the Load tab:

1. The cart controls (`+` button / qty input / `−` button) are wrapping to a new line below the row instead of staying right-aligned inline — fix alignment so they sit on the right side of the row, identical to non-parent SKU rows
2. The qty input box is too narrow — increase its width by a few pixels to match the non-parent rows

---

## Scope

**One file only:**

`/logistics/load-builder.html`

Change is inside `renderLoadTab` only — specifically the parent SKU row construction. Do NOT touch any other rows, logic, or files.

---

## Root Cause

The parent SKU row has a chevron button prepended as the first child. This is likely causing the row's flex layout to overflow or wrap because the row was not built to accommodate the extra element, pushing the `sku-actions` div onto a new line.

---

## Fix

### 1. Row flex layout

Ensure the parent SKU row `div` has `flexWrap: 'nowrap'` set explicitly in its style, and that `alignItems` is `'center'`. The `sku-actions` div must have `flexShrink: 0` so it never wraps.

The chevron button should have a fixed small width and `flexShrink: 0` so it does not compress other elements.

### 2. Qty input width

For the qty input inside the parent row's cart controls, set `width: '54px'` (up from the current default). Apply this to the parent row's qty input only — do not change the width on non-parent rows.

---

## Constraints

- Do NOT change any non-parent SKU row styles
- Do NOT touch `renderSkusTab`, algorithms, or any other logic
- Do NOT change `STORAGE_KEY`

---

## Completion

Notify me when done. No migration required.
