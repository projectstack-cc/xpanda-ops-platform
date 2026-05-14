# Prompt 07 — Load Builder: Parent Group Render Fix

You are working inside the xPanda Operations Platform repository.
Follow all rules in AGENTS.md.

---

## Objective

Fix the parent group rendering in the Load tab SKU list. Currently all SKUs in a group (including the whole-inch parent) are hidden under the group header. The correct behavior is:

- The whole-inch SKU (the one whose `sku` value matches the parent group's whole-inch entry) renders as a **full, always-visible SKU row** with its own cart controls
- The chevron toggle (▶/▼) lives on the **left side of that parent SKU row**, not on a separate header row
- Clicking the chevron expands/collapses the fractional variant children (`.25`, `.5`, `.75`)
- Children are **collapsed by default**
- The separate group header row (e.g. the plain "1in HB" label row) is **removed entirely** — the parent SKU row replaces it

---

## Scope

**One file only:**

`/logistics/load-builder.html`

Change is inside `renderLoadTab` only — specifically the parent group rendering block. Do NOT touch:
- Any ungrouped SKU rendering
- `renderSkusTab`
- Any algorithm or state logic
- `collapsedParentGroups` initialization (keep it, children still collapsed by default)

---

## Current behavior (to replace)

Currently within each category, parent groups render as:
1. A standalone group header row showing the group name + chevron + count
2. When expanded: all SKUs in the group (including the whole-inch parent) as children

---

## New behavior

Within each category, for each `parent_group`:

1. **Identify the parent SKU** — the SKU in the group where `s.parent_group` matches and it is the whole-inch entry. The reliable way to identify it: it is the SKU with the **lowest `height`** in the group (e.g. `1in HB` group → `HB-01` at height 1 is the parent).

2. **Render the parent SKU as a normal SKU row** with one addition: a chevron button on the far left of the row that toggles `state.collapsedParentGroups[cat + '::' + parentGroupName]`.
   - Chevron shows `▶` when children are collapsed, `▼` when expanded
   - The rest of the row is identical to any other SKU row: color dot, SKU code, name, dims, stack count, cart controls
   - This row is **always visible** — it is never hidden by collapse state

3. **Render the child SKUs** (the remaining 3 fractional variants) only when the group is **not** collapsed. Add a small left indent (`paddingLeft: '24px'`) to visually nest them under the parent.

4. **Default state**: `collapsedParentGroups` starts as `{}` — but children should be collapsed by default. Change the collapse check so that a group is considered collapsed when `state.collapsedParentGroups[key] !== false` (i.e. collapsed unless explicitly opened). This means an absent key = collapsed, and toggling sets it to `false` (open) or back to `true` (closed).

---

## Chevron button style

Add the chevron as the first element in the parent SKU row, before the color dot:

```js
const chevron = h('button', {
  className: 'btn-chevron',
  onClick: e => {
    e.stopPropagation();
    const key = cat + '::' + parentGroupName;
    state.collapsedParentGroups[key] = (state.collapsedParentGroups[key] === false) ? true : false;
    render();
  }
}, isCollapsed ? '▶' : '▼');
row.appendChild(chevron);
```

Add one CSS rule scoped under `.load-builder-app`:

```css
.load-builder-app .btn-chevron {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-ghost);
  padding: 0 4px;
  flex-shrink: 0;
  line-height: 1;
}
.load-builder-app .btn-chevron:hover {
  color: var(--text-muted);
}
```

---

## Search behavior

When `isSearching` is true, ignore collapse state and render all SKUs flat as today — no chevrons, no grouping. This is unchanged from the existing implementation.

---

## Constraints

- Do NOT change `STORAGE_KEY`
- Do NOT modify `collapsedParentGroups` in the state definition — just change how the collapsed check works in the render
- Do NOT touch any other part of the file

---

## Completion

Notify me when done. No migration required.
