# Prompt 05 — Load Builder: SKU Parent Groups in Load Tab

You are working inside the xPanda Operations Platform repository.
Follow all rules in AGENTS.md.

---

## Objective

Add a `parent_group` field to Load Builder SKUs. In the Load tab SKU list, SKUs that share a `parent_group` within the same category are nested under a collapsible parent row instead of being listed flat. SKUs with no `parent_group` continue to render exactly as they do today.

This change is **Load tab only**. The SKUs management tab is not affected.

---

## Scope

**Files to modify:**

1. `_worker.js` — add `parent_group` to schema comment, `mapSkuRow`, POST handler, PUT handler
2. `/logistics/load-builder.html` — add `collapsedParentGroups` to state, update `renderLoadTab` only

**Do NOT modify:**
- `renderSkusTab` or any SKU management UI
- Any packing/algorithm logic
- Shared CSS or header files
- The `STORAGE_KEY` value or localStorage structure

---

## Step 1 — D1 Migration

Do NOT run this. Write it here so I can run it manually in the Cloudflare Dashboard Console:

```sql
ALTER TABLE load_builder_skus ADD COLUMN parent_group TEXT NOT NULL DEFAULT '';
```

---

## Step 2 — `_worker.js`

### Schema comment

Add `parent_group TEXT NOT NULL DEFAULT ''` to the `CREATE TABLE` comment block for `load_builder_skus`, after the `category` line (if present) or after `sort_order`.

### `mapSkuRow`

Add `parent_group` to the returned object:

```js
parent_group: row.parent_group || '',
```

### POST handler

Destructure `parent_group` from `body` alongside `category`:

```js
const { name, sku, length, width, height, weight = 1, notes = "", color = "#D97706", allowRotation = false, category = "", parent_group = "" } = body;
```

Add `parent_group` to the INSERT statement column list and `.bind()` values in the matching position.

### PUT handler

Add `parent_group` to the updatable fields block, same pattern as `category`:

```js
if (parent_group !== undefined) { updates.push("parent_group = ?"); binds.push(parent_group || ""); }
```

---

## Step 3 — `/logistics/load-builder.html`

### State

Add `collapsedParentGroups: {}` to the `state` object alongside `collapsedCategories`.

This key is **not persisted** to localStorage — parent groups expand fresh on each page load, same as categories do today.

### `renderLoadTab` — Load tab SKU list only

The existing render iterates `catKeys`, and for each category renders a collapsible `sku-category-header` + `sku-category-body` containing flat `sku-row` items.

Change the inner loop so that within each category body, SKUs are sub-grouped by `parent_group`:

**Grouping logic:**

```js
// Within each category's SKUs:
// 1. SKUs with parent_group === '' render flat as today (no change)
// 2. SKUs with a parent_group value are grouped under a collapsible parent row
```

Specifically, partition `catSkus` into:
- `ungrouped`: SKUs where `(s.parent_group || '') === ''`
- `parentMap`: a Map of `parent_group → SKU[]` for SKUs that have a `parent_group`

Render order within the category body:
1. Ungrouped SKUs — render exactly as today (no wrapper, no change)
2. Each parent group — render a parent header row followed by the group's child SKUs when expanded

**Parent group header row:**

Style it as a sub-header within the category body — visually lighter than the category header but clearly a collapsible group. Suggested approach: a `div` with a left-indented layout, small chevron (▶/▼), bold group name, and muted count badge. Example:

```
  ▼  1in HB  (3)
```

On click: toggle `state.collapsedParentGroups[cat + '::' + parentGroupName]` and re-render. Use `cat + '::' + parentGroupName` as the key to avoid collisions across categories.

When searching (`isSearching` is true), ignore collapse state and show all children flat — same behavior as existing category collapse.

**Child SKU rows:**

Render each child SKU row identically to how ungrouped rows render today — same `sku-row` class, color dot, SKU code, name, dimensions, per-stack count, +/− cart controls. Add a small left indent (e.g. `paddingLeft: '16px'`) on the row to visually show nesting.

**Default state:**

Parent groups start **expanded** by default (consistent with how categories behave). `collapsedParentGroups` starts as `{}`.

---

## CSS

Add one minimal rule for the parent group sub-header — scope it under `.load-builder-app` to avoid collisions:

```css
.load-builder-app .sku-parent-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--border-light);
}
.load-builder-app .sku-parent-header:hover {
  background: rgba(0,0,0,0.02);
}
```

Do not modify any existing CSS rules.

---

## Constraints

- Load tab render changes only — `renderSkusTab` is untouched
- No algorithm or packing logic changes
- `STORAGE_KEY` (`foam_trailer_loader_v31`) must not change
- SKUs with no `parent_group` render identically to today
- Parent group collapse state lives in `state.collapsedParentGroups` (in-memory only, not persisted)
- When searching, all SKUs show flat regardless of parent group collapse state

---

## Completion

Notify me when done and remind me to run the migration in the Cloudflare Dashboard Console before testing.
