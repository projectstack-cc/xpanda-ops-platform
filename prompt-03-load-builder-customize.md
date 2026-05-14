# Prompt 03 — Load Builder: Customize Mode UX Improvements

You are working inside the xPanda Operations Platform repository.
Follow all rules in AGENTS.md.

---

## Objective

Two UX improvements to the Customize Trailer panel in the Load Builder:

1. **Alert when the total piece count in the customized layout exceeds the trailer capacity**
2. **Show an "Unassigned Pieces" section when pieces are removed from the layout**

---

## Scope

**One file only:**

`/logistics/load-builder.html`

Do NOT touch any algorithm, packing, or state management logic outside of `renderEditorContent` and `applyEditorRows`. Do NOT modify shared CSS, headers, or any other file.

---

## Background

The customize panel is rendered by `renderEditorContent(box, ti, skuLib)`.  
Rows → Columns → Layers, each layer has a `skuId` and `count`.  
`applyEditorRows(ti, skuLib)` commits the customized layout to the trailer state.

The trailer's original piece assignments come from `state.trailers[ti]` — the auto-packed result before customization. Each trailer has a known set of SKUs and quantities from the pack result.

---

## Feature 1 — Over-Capacity Alert

### Where to add it

Inside `renderEditorContent`, after the rows are rendered, add a live warning bar above the APPLY button.

### Logic

1. Sum up total pieces currently in `editorRows`: for each row → each column → each layer, sum `layer.count`.
2. Sum up total pieces in the original trailer assignment for trailer `ti` from `state.trailers[ti]` (use whatever field holds placed pieces — stacks, placements, or the SKU quantity map).
3. If the editor total **exceeds** the original total, show a visible warning:

```
⚠️ Layout exceeds original piece count ({editorTotal} placed vs {originalTotal} expected). Consider reviewing before applying.
```

4. If equal or under, show nothing (or a neutral count display if you judge it useful for context).

### Style

Use an inline warning bar styled consistently with existing Load Builder warning patterns (orange/amber tone). Keep it non-blocking — it is a warning only, not a hard stop. The APPLY button remains enabled.

---

## Feature 2 — Unassigned Pieces Section

### Where to add it

Inside `renderEditorContent`, below the rows container, conditionally render an "Unassigned Pieces" section.

### Logic

1. Build a map of the **original piece counts** by SKU for trailer `ti` from `state.trailers[ti]`.
2. Build a map of the **editor piece counts** by SKU by summing `layer.count` per `skuId` across all editorRows.
3. For each SKU in the original map: if `original[skuId] - editor[skuId] > 0`, that SKU has unassigned pieces.
4. If any unassigned pieces exist, render the section. If none, render nothing.

### Display

```
UNASSIGNED PIECES
┌─────────────────────────────┬────────┐
│ SKU Name                    │   Qty  │
│ SKU Name                    │   Qty  │
└─────────────────────────────┴────────┘
```

- Simple table or card list — match the existing editor visual style
- Label the section clearly: `UNASSIGNED PIECES`
- Show SKU name (look up from `skuLib` by id) and unassigned count
- This is read-only/informational — no actions needed on this section

---

## Important Constraints

- Do NOT change `applyEditorRows` logic
- Do NOT change any packing algorithm
- Do NOT change `state` structure
- Re-render of the editor (which already happens on every row/column/layer action) will naturally refresh both features — no additional event wiring needed
- Preserve the existing `localStorage` key (`foam_trailer_loader_v31` or current version) — do NOT bump or reset it

---

## Completion

Notify me when done. No migration required.
