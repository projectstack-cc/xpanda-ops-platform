# Prompt 14 — Block Calculator: Fix Secondary Part Quantity Display

You are working inside the xPanda Operations Platform repository.
Follow all rules in AGENTS.md.

---

## Objective

Fix the block calculator so that secondary part stat cards display the **ordered quantity**, not the inflated produced quantity. Currently, when blocks needed is driven up by one part's quantity, other parts show a higher-than-ordered number as their headline figure (e.g. ordered 270 but displays 312 because extra blocks were needed for another part).

---

## Scope

**One file only:**

`/production/block-calculator.html`

Change is inside `renderStats` only. Do NOT touch `runFullCalc`, `calcSecondaryPart`, `runPrimaryCalc`, or any other function. The calculation logic is correct — only the display is wrong.

---

## The problem

In `renderStats`, the secondary part stat cards currently do this:

```js
for (const sec of calc.secondaries) {
  if (!sec._qty || sec.totalPieces === 0) continue;
  const produced = calc.blocksNeeded * sec.totalPieces;
  const surplus  = produced - sec._qty;
  cards.push(`<div class="stat-card">
    <div class="stat-num">${produced.toLocaleString()}</div>
    <div class="stat-label">${esc(sec.label)} Produced</div>
    <div class="stat-sublabel">${surplus} surplus (${sec._qty.toLocaleString()} needed)</div>
  </div>`);
}
```

`produced` can exceed `sec._qty` because `blocksNeeded` was set by a different part's quantity constraint. The headline number misleads the user into thinking more pieces are being ordered than were entered.

---

## The fix

Change the secondary stat cards to show the **ordered quantity** (`sec._qty`) as the headline, and show the produced quantity and surplus as sublabel context:

```js
for (const sec of calc.secondaries) {
  if (!sec._qty || sec.totalPieces === 0) continue;
  const produced = calc.blocksNeeded * sec.totalPieces;
  const surplus  = produced - sec._qty;
  cards.push(`<div class="stat-card">
    <div class="stat-num">${sec._qty.toLocaleString()}</div>
    <div class="stat-label">${esc(sec.label)} Ordered</div>
    <div class="stat-sublabel">${produced.toLocaleString()} produced · ${surplus >= 0 ? surplus + ' surplus' : Math.abs(surplus) + ' short'}</div>
  </div>`);
}
```

This change only affects the display — `produced` and `surplus` are still calculated and shown as context, but the ordered quantity is the primary figure the user sees.

---

## Constraints

- Change ONLY this block inside `renderStats` — nothing else
- Do not touch any calculation functions
- Do not change the primary part stat card — only secondary parts

---

## Completion

Notify me when done. No migration required.
