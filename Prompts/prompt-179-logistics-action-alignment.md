# Prompt 179 — Logistics dashboard: fix action-button column alignment

## Required reading
1. Read `AGENTS.md` and `xpanda-ops-agents.md`.
2. Assume the **logistics-agent** role. Files: `logistics/index.html`, `logistics/logistics-shared.css`. Frontend only.

## Context
The outbound shipments table is `.logistics-table--ship` with `table-layout: fixed` and forced per-column widths. The ACTIONS column (col 9) is 19% with `overflow: hidden`. The "Build Load" + "Generate BOL" button pair is wider than that forced width, so it overflows/wraps and the column misaligns. Fix: widen the ACTIONS column (borrowing from two narrow numeric columns) and let the buttons wrap gracefully, right-aligned. Widths are tunable — eyeball after.

All edits byte-exact, each count==1. Confirm before applying.

## Edit 1 — Actions cell becomes a graceful flex container (`logistics/index.html`)
FIND (exactly once):
```
    <td style="text-align:right;">${actionsHtml}</td>
```
REPLACE:
```
    <td><div class="logistics-actions-cell">${actionsHtml}</div></td>
```

## Edit 2 — Add the actions-cell flex style (`logistics/logistics-shared.css`)
FIND (exactly once):
```
.logistics-table--ship td:first-child {
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
}
```
REPLACE:
```
.logistics-table--ship td:first-child {
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
}
.logistics-actions-cell {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
}
```

## Edit 3 — Rebalance the forced column widths (`logistics/logistics-shared.css`)
Give ACTIONS room (19%→23%), taking 2% from BDFT (col 5) and 2% from BOL # (col 6). Total stays 100%.

FIND (exactly once):
```
.logistics-table--ship th:nth-child(5), .logistics-table--ship td:nth-child(5) { width: 9%; }
```
REPLACE:
```
.logistics-table--ship th:nth-child(5), .logistics-table--ship td:nth-child(5) { width: 7%; }
```

FIND (exactly once):
```
.logistics-table--ship th:nth-child(6), .logistics-table--ship td:nth-child(6) { width: 8%; }
```
REPLACE:
```
.logistics-table--ship th:nth-child(6), .logistics-table--ship td:nth-child(6) { width: 6%; }
```

FIND (exactly once):
```
.logistics-table--ship th:nth-child(9), .logistics-table--ship td:nth-child(9) { width: 19%; }
```
REPLACE:
```
.logistics-table--ship th:nth-child(9), .logistics-table--ship td:nth-child(9) { width: 23%; }
```

## Validation
`logistics/index.html` inline scripts: extract via `re.findall` to temp files, `node --check` each (do NOT pipe via `/dev/stdin`). CSS needs no check.

## Manual sanity (Steve)
- Outbound list: "Build Load" + "Generate BOL" sit on one line in the ACTIONS column, right-aligned, no clipping; rows with "View BOL" line up the same. If a row still wraps, nudge col 9 a couple points higher.

## What NOT to change
- Do NOT change the buttons' classes/labels or `buildActionButtons`.
- Do NOT touch other columns' widths beyond cols 5, 6, 9, or any other file.

## Deliverables
- `logistics/index.html` — actions cell wrapped in `.logistics-actions-cell`.
- `logistics/logistics-shared.css` — flex rule + col 5/6/9 width rebalance.
- Inline scripts pass `node --check`.
