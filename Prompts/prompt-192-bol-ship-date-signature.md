# Prompt 192 — Auto-populate ship date next to shipper signature (bol-shared.js)

## Required reading (do this first)
1. Read **`AGENTS.md`** (platform-wide rules).
2. Read **`xpanda-ops-agents.md`** and operate as the **logistics-agent**. This task touches the BOL coordinate single-source-of-truth (`logistics/bol-shared.js`), which the logistics-agent owns.

## Source of truth
- Branch: **`main`**. Clone/pull `main` before doing anything; `main` is production. (P191 is already landed on `main` — pull it before starting.)
- File touched: **`logistics/bol-shared.js`** — ONLY this file.
- Frontend-only. **No worker change. No DB migration. No other file.**

## Hard constraints
- Do **not** touch the auto-pack algorithm or anything in `load-builder.html`.
- Do **not** change any `STORAGE_KEY`.
- Do **not** alter any rendering **colors** in `bol-shared.js`.
- Both find/replace blocks below are **byte-exact**. Before each replacement, verify uniqueness:
  - `grep -cF "<anchor>" logistics/bol-shared.js` must return **exactly `1`**. If it is not `1`, STOP and report — do not guess.
- After all edits, run **`node --check logistics/bol-shared.js`** and confirm it passes. (`bol-shared.js` is a plain `.js` file — check it directly.)

---

## Goal
Add the BOL ship date next to the shipper signature: **same Y** as the signature (`48`) and **~70 points to the right** on X (`107`), in the **regular** Helvetica font at **size 10**. Reuse the already-computed `_displayDate` (the same formatted ship/BOL date drawn top-right), so the two dates always agree and any `date` override is respected. `_displayDate` and the `drawText` helper are both already in scope inside the per-BOL render loop where the signature is drawn — reuse them; do not recompute or re-declare.

---

## Edit 1 — add the coord

FIND (exact, count must == 1):
```
    shipperSignature: { x: 37, y: 48, size: 22 },
```
REPLACE:
```
    shipperSignature: { x: 37, y: 48, size: 22 },
    shipperDate:      { x: 107, y: 48, size: 10 },
```

---

## Edit 2 — draw the date after the signature block

FIND (exact, count must == 1):
```
      // ── Shipper signature (cursive, all copies) ──
      if (bol.shipper_name && cursive) {
        page.drawText(String(bol.shipper_name), {
          x: COORDS.shipperSignature.x,
          y: COORDS.shipperSignature.y,
          size: COORDS.shipperSignature.size || 22,
          font: cursive,
          color: black,
        });
      }
```
REPLACE:
```
      // ── Shipper signature (cursive, all copies) ──
      if (bol.shipper_name && cursive) {
        page.drawText(String(bol.shipper_name), {
          x: COORDS.shipperSignature.x,
          y: COORDS.shipperSignature.y,
          size: COORDS.shipperSignature.size || 22,
          font: cursive,
          color: black,
        });
      }

      // ── Ship date next to shipper signature (auto-populated; regular font) ──
      if (_displayDate) drawText(_displayDate, COORDS.shipperDate);
```

Notes:
- `_displayDate` is the existing formatted date string (`'date' in _ov ? String(_ov.date) : formatBolDate(bol.date)`) computed earlier in the same loop iteration. Reuse it as-is.
- The `drawText` helper uses the regular `font` because `COORDS.shipperDate` has no `bold` flag. Size comes from the coord (`10`).
- Date renders on all copies (default/driver/customer), like the signature itself.

---

## Verification checklist (report results)
1. Both FIND anchors returned `grep -cF` count == `1` before replacement.
2. Both replacements applied.
3. `node --check logistics/bol-shared.js` → passes.
4. Confirm no color values, no other file, no worker, and no migration were touched.

## Deliverable
Commit the single-file change to `logistics/bol-shared.js` on `main`.
