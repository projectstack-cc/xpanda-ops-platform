# FIX — Signature stamp is squished (double the signature box height)

> Assign a number before committing. Reflects HEAD `7f419d0`.

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent** —
`track/index.html` only. No worker, no migration.

## Change
The signature images are stamped into 16pt-tall boxes, crushing the ~600×180 pad. Double the **height**
of the customer and carrier signature slots (16 → 32). Width and the date slot are unchanged. Overlap
with surrounding BOL text is acceptable (matches a real hand-signed BOL).

> pdf-lib's origin is bottom-left, so increasing `h` grows the signature **upward** from its current
> baseline `y`. If you later want it centered or lower, nudge `y` in `bol-test`.

### Edit 1 — `track/index.html`

FIND (count == 1):
```
  const SLOTS = {
    customer: { x: 380, y: 175, w: 160, h: 16 },
    carrier:  { x: 390, y: 45,  w: 110, h: 16 },
    date:     { x: 513, y: 45,  w: 58,  h: 16 },
  };
```
REPLACE:
```
  const SLOTS = {
    customer: { x: 380, y: 175, w: 160, h: 32 },
    carrier:  { x: 390, y: 45,  w: 110, h: 32 },
    date:     { x: 513, y: 45,  w: 58,  h: 16 },
  };
```

---

## Verify
- FIND `count == 1`. Extract the `track/index.html` script to a temp `.js` and `node --check`.
- Complete a fresh delivery and open the signed copies from the Documents section: the customer and
  carrier signatures are about twice as tall and no longer squished.

## What NOT to change
- Do NOT change widths, the date slot, the stamping logic, or the worker.

## Deploy
```
git add track/index.html
git commit -m "P###: double BOL signature stamp box height (16→32) so signatures aren't squished"
git push
```
