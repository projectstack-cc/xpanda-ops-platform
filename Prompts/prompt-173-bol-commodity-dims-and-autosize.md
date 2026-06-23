# Prompt 173 — BOL commodity: stop duplicating the structured dimensions field + fix commodity font auto-size for long lists

## Required reading (do this first)
1. Read `AGENTS.md` (platform conventions).
2. Read `xpanda-ops-agents.md` (multi-agent definition).
3. Two concerns, two agents:
   - **job-board-agent** (`jobs/*`) — Edit 1, the dimensions duplication, lives in `jobs/index.html` (parse-review line-item assembly).
   - **logistics-agent** (`logistics/*`) — Edit 2, the commodity font auto-size ladder, lives in `logistics/bol-shared.js`.

No DB migration, no worker change, no permission key. Frontend only.

Both edits are byte-exact find/replace, each verified to appear exactly once at HEAD. Confirm `count == 1` before applying. Do not reflow surrounding code.

---

## Edit 1 — Stop appending the structured `dimensions` field to the line-item description (`jobs/index.html`)

### Why
The packing-slip parser already captures dimensions **inside the description text** for SKU-less customer parts (e.g. description = `Custom block 24x36x8`), and *separately* extracts them into the structured `dimensions` field. During parse-review, the description is rebuilt as `description + dimensions`, producing `Custom block 24x36x8 24x36x8`. That merged string is saved on the job and is what every BOL commodity path renders, so the dimensions show up duplicated on the BOL.

The fix is to **not** append the structured `dimensions` field to the description. The description renders verbatim (its inline dims are preserved), and the dedicated Dims input still shows the structured value at job entry, and `dimensions` is still saved on the line item (used for part matching) — it just stops being concatenated into the description.

This affects jobs created **after** this change only; existing jobs already have the merged description saved (no backfill, by decision).

### Change
FIND (exactly once):
```
      if (li.label) descParts.push('– ' + li.label);
      if (li.dimensions && !li.label) descParts.push(li.dimensions);
      const desc = descParts.filter(Boolean).join(' ').trim();
```
REPLACE:
```
      if (li.label) descParts.push('– ' + li.label);
      const desc = descParts.filter(Boolean).join(' ').trim();
```

Do NOT touch the `dimensions: li.dimensions || ''` field passed to `addLineItemRow` just below — the structured field stays for matching and the Dims input.

---

## Edit 2 — Extend the commodity font auto-size ladder for long lists (`logistics/bol-shared.js`)

### Why
`pickCommodityTier` currently has three tiers and floors at `size: 20, maxLines: Infinity`. Any commodity longer than what fits at size 20 has nowhere smaller to go and overflows the commodity box (worst case: long holey-board POs with a line per thickness). The pre-tier static size was 13, so long lists that used to fit now spill. Extending the ladder downward lets long commodities shrink gracefully instead of overflowing, while keeping the large sizes for short BOLs.

These size/lineH values are a sound starting ladder; they remain visually tunable later via `logistics/bol-test.html`.

### 2a — the tiers array
FIND (exactly once):
```
    const tiers = [
      { size: 26, lineH: 32, maxLines: 2 },
      { size: 22, lineH: 28, maxLines: 5 },
      { size: 20, lineH: 24, maxLines: Infinity },
    ];
```
REPLACE:
```
    const tiers = [
      { size: 26, lineH: 32, maxLines: 2 },
      { size: 22, lineH: 28, maxLines: 4 },
      { size: 18, lineH: 22, maxLines: 7 },
      { size: 15, lineH: 18, maxLines: 11 },
      { size: 12, lineH: 14, maxLines: 18 },
      { size: 10, lineH: 12, maxLines: Infinity },
    ];
```

### 2b — the fallback return (match the new floor)
FIND (exactly once):
```
    return { size: 20, lineH: 24 };
```
REPLACE:
```
    return { size: 10, lineH: 12 };
```

Do NOT change `COORDS.commodity` (the `center: true`, `maxW: 510`, `x`/`y` anchor stay as-is — the ladder only supplies `size`/`lineH`, applied via the existing commodity render block). The dims stripped in Edit 1 also shorten lines, so the two edits compound: fewer wrapped lines → a larger, cleaner tier.

---

## Step 3 — Validation
- `logistics/bol-shared.js` is a standalone `.js`: run `node --check logistics/bol-shared.js`.
- `jobs/index.html` has inline `<script>` blocks: extract each with `re.findall` to **real temp files** (do NOT pipe via `/dev/stdin`), then `node --check` each; confirm **all** pass. Delete temp files after.

---

## Step 4 — Manual sanity (notes for Steve, no action by Claude Code)
- Create a job from a packing slip whose line items have dimensions (e.g. INV 4051): the line-item descriptions no longer show the dimension value twice; the Dims field still holds it.
- Generate a BOL for that job: the commodity block shows the description without the duplicated structured dims.
- Generate a BOL with a long commodity (many lines): the font shrinks to fit inside the commodity box instead of overflowing; short commodities still render large.

---

## What NOT to change
- Do NOT strip dimension patterns from description text anywhere — descriptions render verbatim (SKU-less customer parts legitimately carry dims in the description).
- Do NOT touch the `dimensions` field storage, the Dims input, or part-matching (`matchLineItemToPart`).
- Do NOT change `COORDS.commodity`, `drawMultiline`, `wrapText`, `off()`, or any other BOL field rendering.
- Do NOT touch the worker, migrations, `load-builder.html`, `bol-compose.js`, or `bol-generator.html`.

## Deliverables summary
- `jobs/index.html` — remove the structured-dims append (one line).
- `logistics/bol-shared.js` — extend `pickCommodityTier` ladder + matching fallback.
- `bol-shared.js` passes `node --check`; `jobs/index.html` inline scripts pass `node --check` via temp-file extraction.
