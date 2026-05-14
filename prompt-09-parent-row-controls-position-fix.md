# Prompt 09 — Load Builder: Fix Parent Row Cart Controls Position

You are working inside the xPanda Operations Platform repository.
Follow all rules in AGENTS.md.

---

## Objective

The cart controls (`+` button / qty input / `−` button) on parent SKU rows are rendering as a separate element below the row instead of inside the row on the right side. Fix this so the parent row layout is identical to non-parent SKU rows, with controls on the far right.

---

## Scope

**One file only:**

`/logistics/load-builder.html`

Fix is inside `renderLoadTab` only — the parent SKU row construction. Do NOT touch non-parent rows, `renderSkusTab`, algorithms, or any other logic.

---

## What the correct structure must look like

The parent row is a single `div.sku-row` containing all of these as direct children, left to right, in one line:

```
[ chevron btn ] [ color dot ] [ sku code ] [ name ] [ dims ] [ stack ] [ actions div ]
```

The `actions div` (containing the `+` button, or `−` / qty input / `+` when in cart) must be the **last child inside the row div** — not appended after it or outside it.

The `actions div` must have `marginLeft: 'auto'` so it pushes to the far right regardless of how much space the other elements take.

The row div must have:
- `display: 'flex'`
- `alignItems: 'center'`
- `flexWrap: 'nowrap'`

The chevron button must have `flexShrink: 0` so it does not compress.

The `actions div` must have `flexShrink: 0` so it never wraps or compresses.

---

## The likely bug

The `actions` div is being appended to the DOM **after** `row` instead of **into** `row`. Verify that the actions construction ends with:

```js
row.appendChild(actions);   // CORRECT — inside the row
```

NOT:

```js
catBody.appendChild(actions);  // WRONG — outside the row
// or
rowWrapper.appendChild(actions); // WRONG
```

Also verify the `+` button itself is appended into `actions`, and `actions` is appended into `row` before `row` is appended to `catBody`.

---

## Qty input width

While fixing the above, set the qty input width to `54px` on the parent row.

---

## Constraints

- Do NOT change non-parent SKU rows
- Do NOT change `renderSkusTab`, algorithms, state, or `STORAGE_KEY`
- The chevron toggle behavior is correct — do not change it

---

## Completion

Notify me when done. No migration required.
