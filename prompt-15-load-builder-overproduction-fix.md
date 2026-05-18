# Prompt 15 — Load Builder: Fix Auto-Pack Over-Production

You are working inside the xPanda Operations Platform repository.
Follow all rules in AGENTS.md.

---

## Objective

The auto-pack is producing more pieces than ordered. When 270 pieces are entered, the pack may commit 333. The cause is in `buildColumn` — when topping off a column to fill a height gap, `exactFillHeight` greedily consumes pieces from other demand items beyond what the order calls for, because it optimizes for maximum height fill regardless of whether those pieces were needed.

The fix: after `exactFillHeight` returns picks for a top-off fill, cap each pick's count so that the total pieces committed never causes any demand item to go below zero remaining (it already does this), BUT also ensure the mixing pass only uses pieces that were going to go on this trailer anyway — not speculatively consume stock that hasn't been committed to this trailer yet.

The simplest correct fix is: **disable void-filling top-offs in `buildColumn` entirely**. Stack the base SKU only. Mixing should only happen when the base SKU itself runs out mid-column — not to fill vertical space with other SKUs.

---

## Scope

**One file only:**

`/logistics/load-builder.html`

Change is inside `buildColumn` only. Do NOT modify `exactFillHeight`, `buildRow`, `buildDemand`, Pass 2, or any other function.

---

## The fix

In `buildColumn`, the mixing pass currently calls `exactFillHeight` to top off columns with other SKUs when there's a height gap. This is the source of over-production.

**Change the `shouldMix` condition to `false` always**, so `buildColumn` always takes the pure stack path:

Find this line:

```js
const shouldMix = allowMixing && (gap >= baseSku.height);
```

Change it to:

```js
const shouldMix = false;
```

This means `buildColumn` will always return a pure stack of the base SKU only, using `maxBase` pieces (capped at `baseDemand.remaining`). No other SKUs will be consumed to fill vertical gaps. The column height may not reach the trailer ceiling — that's the correct trade-off. Pieces are committed exactly as ordered.

Pass 2 (the remainder consolidation loop) already handles leftover pieces after Pass 1 completes, so nothing is lost — any remaining pieces after pure stacking will be picked up and placed in Pass 2.

---

## Constraints

- Change ONLY the `shouldMix` line in `buildColumn`
- Do NOT modify `exactFillHeight`, `buildRow`, `buildTrailerStats`, `buildDemand`, or any other function
- Do NOT change `STORAGE_KEY`
- Do NOT touch Pass 2 logic

---

## Completion

Notify me when done. No migration required.
