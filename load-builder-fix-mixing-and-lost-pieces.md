# Load Builder — Fix Aggressive Mixing + Lost Pieces Bug

You are working inside the xPanda Operations Platform repository. Follow all rules defined in AGENTS.md.

---

## Context

The Load Builder at `/logistics/load-builder.html` has two bugs that need fixing in the `calcLoading` algorithm.

---

## Bug 1: Mixing Is Still Too Aggressive

### Symptoms

With a load of multiple SKU sizes (e.g., 9", 7", 5", 3", 2"), the stack breakdown shows patterns like:

```
9" - 2 · 7" - 12 · 3" - 2
7" - 5 · 5" - 14 · 3" - 1
5" - 20 · 5" - 1 · 3" - 1
```

Three or more sizes are being mixed into single stacks. This should not happen during the main loading pass. Pure stacks should be the norm, with mixing only at the transition point when a size runs out.

### Root Cause Analysis

The `buildColumn` function (around line 474) has an `allowMixing` parameter, and Pass 1 calls it with `allowMixing = false`. However, look at the scoring loop:

```js
for (let baseCount = maxBase; baseCount >= 1; baseCount--) {
```

This loop tries EVERY possible base count from max down to 1. For each `baseCount`, when `allowMixing` is true (Pass 2 or top-off), it calls `exactFillHeight` to fill the remaining height. The problem is the scoring function:

```js
const score = totalHeight * 1000 - waste * 200 - mixedPenalty + preferredBonus;
```

The `mixedPenalty` is only 20 points, while `totalHeight * 1000` dominates. A mixed stack filling 108" scores ~108,000 while a pure stack at 105" scores ~105,000. The penalty of 20 is meaningless — mixing ALWAYS wins because it fills more height.

### Fix

Implement the tolerance threshold rule. In `buildColumn`, after calculating the max pure stack height, check if the gap is acceptable before attempting any mixing:

```js
const maxBase = Math.min(baseDemand.remaining, Math.floor(dims.height / baseSku.height));
if (maxBase <= 0) return null;

const pureHeight = maxBase * baseSku.height;
const gap = dims.height - pureHeight;
const tolerance = baseSku.height; // one block height

// If the pure stack is within one block-height of full, NEVER mix
const shouldMix = allowMixing && (gap >= tolerance);
```

Then use `shouldMix` instead of `allowMixing` in the fill logic:

```js
if (remainH > 0 && shouldMix) {
  // existing exactFillHeight logic
}
```

Additionally, when mixing IS allowed (gap >= tolerance, meaning the SKU is running out), only consider candidate SKUs whose height is at least 50% of the base SKU height. This prevents tiny sizes from being pulled in as caps:

```js
if (remainH > 0 && shouldMix) {
  const minFillHeight = baseSku.height * 0.5;
  let fillPool = tempPool.filter(d => d.sku.height >= minFillHeight);
  // ... then call exactFillHeight with this filtered pool
}
```

Also remove the `baseCount` iteration loop entirely for the pure-stack case. When `shouldMix` is false, the function should simply use `maxBase` as the count and return immediately — no need to try lower base counts. The only reason to try lower counts is to find room for mixed fill, which we are skipping:

```js
if (!shouldMix) {
  // Pure stack: just use maxBase, no iteration needed
  const baseHeight = maxBase * baseSku.height;
  const baseWeight = maxBase * baseSku.weight;
  if (usedWeightSoFar + baseWeight > dims.maxWeight) return null;
  baseDemand.remaining -= maxBase;
  const layers = [{ skuId: baseSku.id, skuName: baseSku.name, skuCode: baseSku.sku,
    color: baseSku.color, unitHeight: baseSku.height, count: maxBase }];
  // ... build and return the column directly
}
```

The `baseCount` iteration loop should only run when `shouldMix` is true, because that is the only case where trying fewer base pieces (to leave room for fill) makes sense.

---

## Bug 2: Lost Pieces — Pieces Silently Dropped After 3+ SKUs

### Symptoms

When loading 3 or more SKU sizes, the total pieces placed across all trailers is LESS than the total pieces in the cart. For example, 1170x 2" blocks are entered but only 1133 appear in the results. The missing 37 pieces do not appear in any trailer or warning.

### Root Cause

In `calcLoading`, the outer `while (demand.some(d => d.remaining > 0))` loop creates trailers. Inside each trailer, after Pass 1 and Pass 2:

```js
if (!rows.length) {
  const stuck = demand.find(d => d.remaining > 0);
  if (stuck) warnings.push(`Could not place remaining ${stuck.sku.name}.`);
  break;  // <-- THIS BREAKS THE ENTIRE OUTER LOOP
}
```

This `break` exits the outer while loop, abandoning all remaining demand. The `break` should only happen if we truly cannot place ANY pieces (infinite loop protection). But there are scenarios where a trailer's Pass 1 produces rows but Pass 2's `if (curX + rowLength > dims.length) continue;` skips remainders that do not fit in the current trailer's remaining length. Those pieces have `remaining > 0` and should spill to a NEW trailer — but they get counted in the next iteration.

The actual piece loss happens more subtly. Look at `buildRow`:

```js
const working = cloneDemand(sortDemandPriority(demand.filter(d => d.remaining > 0 && d.sku.length === rowLength && d.sku.width <= dims.width), variant));
```

This filters demand to ONLY SKUs matching `rowLength`. If there are 3 SKUs (9", 7", 2") and the dominant SKU sets `rowLength = 48`, the working set includes all three. But after `buildRow` completes:

```js
const workingById = new Map(working.map(d => [d.skuId, d.remaining]));
const mergedDemand = cloneDemand(demand).map(d => ({ ...d, remaining: workingById.has(d.skuId) ? workingById.get(d.skuId) : d.remaining }));
```

The `mergedDemand` uses the `working` clone's remaining counts. But `working` was created from a FILTERED subset of demand. If `buildColumn` with `allowMixing = false` placed SOME pieces of SKU-A but the `working` clone was created before those placements... actually, the clone IS updated because `buildColumn` mutates the `working` entries directly (they are passed as `footprintPool`).

Wait — the issue might be simpler. Look at `buildRow` line:

```js
const footprintPool = sortDemandPriority(working.filter(d => d.remaining > 0 && d.sku.length === candidate.sku.length && d.sku.width === candidate.sku.width), variant);
```

This creates ANOTHER filtered subset for `buildColumn`. But `buildColumn` receives `footprintPool` as `pool` and does:

```js
pool.forEach((d, i) => { d.remaining = tempPool[i].remaining; });
```

Since `footprintPool` is a filtered view (not a clone), mutations to its entries DO propagate back to `working`. But `footprintPool` only contains entries matching the candidate's length AND width. If there are entries in `working` that match the length but NOT the width, they would not be in `footprintPool` and would not get their `remaining` updated by `buildColumn`.

Actually, the more likely culprit: `buildColumn` calls `cloneDemand(tempPool)` for `remainingSnapshot`, but `tempPool` is aliased to `pool` (the comment says so: `const tempPool = pool; // alias`). The restore logic `pool.forEach((d, i) => { d.remaining = tempPool[i].remaining; })` is restoring from itself — it is a no-op because `pool === tempPool`. This means every iteration of the `baseCount` loop permanently mutates the pool's remaining counts.

### Fix for Lost Pieces

The `buildColumn` function has a critical aliasing bug. `tempPool` is supposed to be a temporary copy that gets restored after each `baseCount` iteration, but it is just an alias:

```js
const tempPool = pool; // alias (not a clone)
```

The comment even acknowledges it. The restore line:
```js
pool.forEach((d, i) => { d.remaining = tempPool[i].remaining; });
```

...does nothing because `pool[i] === tempPool[i]`. So after trying `baseCount = maxBase` and deducting pieces, those deductions are permanent even when the loop tries `baseCount = maxBase - 1`.

**Fix:** Clone the pool at the start of each `baseCount` iteration so rollback actually works:

```js
for (let baseCount = maxBase; baseCount >= 1; baseCount--) {
  const savedRemaining = pool.map(d => d.remaining); // save state
  // ... all the existing logic ...
  
  // Restore after each iteration
  pool.forEach((d, i) => { d.remaining = savedRemaining[i]; });
  baseDemand.remaining += baseCount;
}

// Apply the best result
if (!best) return null;
pool.forEach((d, i) => { d.remaining = best.remainingSnapshot[i]; });
```

And fix the `remainingSnapshot` to actually clone:

```js
best = { score, totalHeight, totalWeight, layers: layers.map(l => ({ ...l })), remainingSnapshot: pool.map(d => d.remaining) };
```

Then when applying the best:

```js
pool.forEach((d, i) => { d.remaining = best.remainingSnapshot[i]; });
```

This ensures the pool is properly restored between iterations and the best result's state is cleanly applied.

### Additional Safety: Never Silently Drop Pieces

Change the `break` after `if (!rows.length)` to be smarter. Instead of breaking the entire outer loop when no rows are created, check if the remaining demand COULD fit in a fresh trailer:

```js
if (!rows.length) {
  // Check if any remaining pieces could theoretically fit in a trailer
  const canFit = demand.some(d => d.remaining > 0 && d.sku.length <= dims.length && d.sku.width <= dims.width && d.sku.height <= dims.height);
  if (!canFit) {
    // Truly cannot place — warn and break
    demand.filter(d => d.remaining > 0).forEach(d => {
      warnings.push(`Could not place remaining ${d.remaining} pcs of ${d.sku.name}.`);
    });
    break;
  }
  // If pieces could fit but did not get placed (algorithm issue), add a safety trailer
  // This prevents silent piece loss
  warnings.push(`Some pieces could not be optimally placed. Adding overflow trailer.`);
  // Let the loop continue — it will try again with a fresh trailer
}
```

Also add a max trailer safety limit to prevent infinite loops:

```js
if (trailers.length >= 20) {
  demand.filter(d => d.remaining > 0).forEach(d => {
    warnings.push(`${d.remaining} pcs of ${d.sku.name} could not be placed (trailer limit reached).`);
  });
  break;
}
```

---

## Verification

### Test Case 1 — Mixing
**Cart:** 500x 7" blocks, 200x 3" blocks
**Expected:** All 7" stacks are pure (15 per stack = 105", 3" gap is fine). All 3" stacks are pure (36 per stack = 108"). Zero mixed stacks.

### Test Case 2 — Piece Count
**Cart:** 1170x 2" blocks, 500x 7" blocks, 200x 9" blocks
**Expected:** Total pieces across all trailers = 1170 + 500 + 200 = 1870. No pieces lost. May require multiple trailers.

### Test Case 3 — Transition Mixing
**Cart:** 30x 10" blocks (only enough for ~3 stacks at 10 per stack), 100x 8" blocks
**Expected:** 3 pure 10" stacks, then when 10" runs out with a partial stack, it MAY top off with 8" blocks (only if gap >= 10"), then pure 8" stacks for the rest.

---

## What NOT to Change

- The SVG rendering, print, packing slip, UI, or any display code
- The manual trailer editor
- The `exactFillHeight` function itself
- The remainder consolidation approach (Pass 2 structure)
- Runner logic, rotation logic, forced trailers, auto-downsize, categories

---

## Rules

- No frameworks. Vanilla HTML, CSS, JavaScript only.
- Only modify algorithm functions in `/logistics/load-builder.html`
- The page must remain fully functional after changes
