# Load Builder — Remaining Space Text + D1 SKU Storage + Runner Support

You are working inside the xPanda Operations Platform repository. Follow all rules defined in AGENTS.md.

---


## Feature 3: Runner (Dunnage) Support for Forklift Offloading

### Context

When foam blocks are loaded onto a trailer, they sometimes need **runners** (wooden boards / dunnage) placed underneath each vertical stack so a forklift can slide its forks under the stack for offloading at the destination. Runners sit flat on the trailer floor and consume vertical height from each column.

The two standard runner sizes are:
- **3" runner** (actual height: 3 inches)
- **4" runner** (actual height: 4 inches)

### UI Changes

#### Runner selector on the LOAD tab

Add a runner option in the **trailer type selector card** (the card at the top of the LOAD tab that already has the trailer type buttons and dimension display). Place it on a new row below the trailer type buttons:

- Label: `RUNNERS` (same style as the "TRAILER TYPE" label — small, uppercase, bold, accent-colored)
- Three toggle buttons in a button group:
  - `NONE` (default, selected)
  - `3" RUNNERS`
  - `4" RUNNERS`
- When a runner size is selected, show a subtle info line: `Runner height deducted from available stacking height (108" → 105")` (or whatever the adjusted height is) — this helps the user understand the impact

#### Runner state

Add to the app state:
```js
runnerHeight: 0  // 0 = none, 3 = 3" runners, 4 = 4" runners
```

This is a global setting per calculation (not per-SKU). It applies to ALL columns in the trailer.

### Algorithm Changes

Runners reduce the **effective stacking height** for every column. The change is simple and surgical:

#### In `buildColumn`

The line that calculates max stack count currently uses `dims.height`:
```js
const maxBase = Math.min(baseDemand.remaining, Math.floor(dims.height / baseSku.height));
```

And the remaining height calculation:
```js
const remainH = dims.height - totalHeight;
```

Both of these should use an **effective height** that accounts for runners:
```js
const effectiveHeight = dims.height - runnerHeight;
const maxBase = Math.min(baseDemand.remaining, Math.floor(effectiveHeight / baseSku.height));
```

The `runnerHeight` value needs to flow into the algorithm. The cleanest approach: pass it as part of the `dims` object. Before calling `calcLoading`, create a modified dims:
```js
const effectiveDims = { ...dims, height: dims.height - state.runnerHeight };
```

Then the entire algorithm uses `effectiveDims` without any other changes — the runner height is simply subtracted from available height before anything runs.

**Important:** The runner height should NOT be subtracted in `buildTrailerStats` or any display functions. The trailer's actual height is still 108" (or whatever the trailer type specifies). The runner only affects how many blocks can stack. The stats should still show the real trailer dimensions.

#### In `getFullTrailerThreshold`

This function also uses `dims.height` to determine if a SKU has enough demand to fill a trailer. It should also use the effective height (which it will automatically if you pass `effectiveDims` to `calcLoading` and it flows through).

### SVG Changes

#### `buildTopViewSVG` — Runner indicator

When runners are active (`runnerHeight > 0`), add a visual indicator to the SVG:

- At the bottom of each filled column rectangle, draw a thin horizontal bar (3-4px tall in SVG space) in a brown/wood color (`#92400E` or `#A16207`) to represent the runner beneath the stack
- This is purely visual — the runner doesn't take floor area, it just shows that there's dunnage under each stack
- Add a legend note at the bottom of the SVG: `▬ 3" runners` or `▬ 4" runners` (matching the brown color)

#### `buildPrintSvg` — Same runner indicator for print

Apply the same runner visual to the print SVG so packing slips show that runners are expected.

### Results Display

In the trailer stats subtitle line (the one that now shows `% length · % floor · mixed stacks · XX' remaining`), also show the runner info when active:

> `15% length · 9% floor · 0 mixed stacks · 45' 0" remaining · 3" runners`

Style the runner portion with a distinct color (the brown `#92400E` to match the SVG indicator).

### Packing Slip Print

When runners are active, add a line to the printed packing slip header area:

> `⚠ RUNNERS: 3" dunnage required under all stacks`

This alerts the warehouse/delivery team that runners need to be placed before loading.

### Cart interaction

Changing the runner setting should trigger a recalculation if the user is on the Results tab (or has already calculated). If they change runners on the LOAD tab and then click Calculate, the new runner height is used. If they're on Results and change it... actually, the runner selector is only on the LOAD tab, so this is handled naturally — they'd need to recalculate after changing it.

**However:** also add the runner selector to the **Results tab** as a quick-toggle above the stats cards, so users can compare with/without runners without switching tabs. When toggled on the Results tab, it should immediately recalculate and re-render the results.

---


## What NOT to Change

- The trailer loading algorithm logic (calcLoading, buildRow, buildColumn, exactFillHeight) — the only algorithm change is subtracting runner height from effective dims BEFORE passing to calcLoading. Do not modify the algorithm functions themselves.
- The manual trailer editor
- The SVG rendering functions (except the remaining-space text that's already in the SVG — leave that as-is)
- The print packing slip functionality
- The cart management (cart stays in local JS state — it's session-specific, not shared)
- The platform header/footer/shared CSS
- Any files outside of `/logistics/load-builder.html` and `_worker.js`

---

## Rules

- No frameworks. Vanilla HTML, CSS, JavaScript only.
- Follow existing `_worker.js` route patterns exactly (flat if/else, async handlers, `json()` helper)
- UUID generation via `crypto.randomUUID()` matching existing pattern
- No authentication on routes (matching existing pattern)
- The page must still work if the API is unavailable (localStorage fallback)
- All existing functionality must continue to work — adding D1 storage is additive, not a rewrite
