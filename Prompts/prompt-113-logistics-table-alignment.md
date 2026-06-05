# Prompt 113 — Logistics shipment tables: fixed column alignment + wrap-not-truncate

## Agent setup
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. Operate as the **logistics-agent** with the **Frontend Designer** agent. Files: `logistics/index.html` and `logistics/logistics-shared.css`.

**Hard constraints:** vanilla HTML/CSS/JS, no build, no frameworks. Use `/shared/tokens.css` variables.

## Problem
The shipments board renders one `<table class="logistics-table">` **per date group**. With default `table-layout: auto`, each table sizes its columns to its own content, so column edges don't line up between date groups, and a long customer name shifts that table's layout. Truncating the customer cell did not fix this (auto layout still redistributes freed width per-table). Desired behavior: **columns are fixed and identical across every shipment table; long text grows the row height, never the column width.**

Note: `.logistics-table` is also used by the **inbound bead inventory table**, which has a *different* column set. So the fixed layout must be scoped to a shipment-only modifier class — do **not** apply it to bare `.logistics-table`.

## Part A — tag the shipment tables (`logistics/index.html`)
Add a modifier class to the shipment day-group table. The 9-column shipment table is the one whose header is `Customer / Method / Carrier / Trailer # / Loads / BDFT / BOL # / Status / Bay / Actions`.

**FIND:**
```html
        <div class="logistics-table-wrap">
          <table class="logistics-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Method / Carrier</th>
```
**REPLACE WITH:**
```html
        <div class="logistics-table-wrap">
          <table class="logistics-table logistics-table--ship">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Method / Carrier</th>
```
If an inbound **shipment** view renders a second table with this same 9-column header, add `logistics-table--ship` to it as well. Do **not** add it to the `Supplier / Bead Type / Weight (lbs) / Ship Date / Carrier …` bead table.

## Part B — fixed layout + column widths + customer wrap (`logistics/logistics-shared.css`)
Insert the following immediately **after** this existing rule:

**FIND (anchor — do not change it):**
```css
.logistics-customer-cell { font-weight: 700; }
```
**REPLACE WITH:**
```css
.logistics-customer-cell { font-weight: 700; }

/* Shipment tables: fixed geometry so columns align across every date group,
   and long customer names grow the row height instead of the column width. */
.logistics-table--ship { table-layout: fixed; }
.logistics-table--ship th:nth-child(1), .logistics-table--ship td:nth-child(1) { width: 20%; }
.logistics-table--ship th:nth-child(2), .logistics-table--ship td:nth-child(2) { width: 12%; }
.logistics-table--ship th:nth-child(3), .logistics-table--ship td:nth-child(3) { width: 8%; }
.logistics-table--ship th:nth-child(4), .logistics-table--ship td:nth-child(4) { width: 6%; }
.logistics-table--ship th:nth-child(5), .logistics-table--ship td:nth-child(5) { width: 9%; }
.logistics-table--ship th:nth-child(6), .logistics-table--ship td:nth-child(6) { width: 8%; }
.logistics-table--ship th:nth-child(7), .logistics-table--ship td:nth-child(7) { width: 11%; }
.logistics-table--ship th:nth-child(8), .logistics-table--ship td:nth-child(8) { width: 7%; }
.logistics-table--ship th:nth-child(9), .logistics-table--ship td:nth-child(9) { width: 19%; }
.logistics-table--ship td, .logistics-table--ship th { overflow: hidden; }
.logistics-table--ship td:first-child {
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
}
```

## Part C — remove any leftover customer-cell truncation
If a `text-overflow: ellipsis`, `white-space: nowrap`, or `max-width` was previously added to the customer column or `.logistics-customer-cell` to force truncation, **remove it** — the cell now wraps and the fixed layout owns the width. (Under `table-layout: fixed` a cell `max-width` is ignored anyway, but delete it for clarity.)

## Verify
- Open the shipments board with multiple date groups: column edges line up **across every group**, regardless of customer-name length.
- A long customer name (e.g. "DiversiTech LEESBURG Branch 11700 · 4016") **wraps onto a second line and grows that row's height**; the Customer column width does not change and neither do the other columns.
- The Build Load / Generate BOL action buttons still fit (stacking vertically in the Actions column is fine).
- The **inbound bead inventory table** is unchanged (no `--ship` modifier, still auto layout).
- Responsive: below 700px the existing `nth-child(n+5)` column-hide still works; remaining columns stay aligned across tables.
- Dark and light both fine.

## Manual / deploy (Steve)
No migration. Deploy; hard-refresh if `sw.js` caches `logistics/index.html`.
