# P90 — Logistics card header parity + Loading dashboard INV# sort

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **logistics-agent**. Frontend-only — no DB, no API, no permission changes.

Two small independent changes. Trace each to the exact function before editing; do not refactor surrounding code.

---

## Task A — Logistics dashboard row header parity (`logistics/index.html`)

The loading dashboard cards were recently changed (P72) so the card lead shows **INV# + load count** primary and **customer** secondary, truncated to 20 chars. Canonical reference is `renderAssignmentCard()` in `logistics/loading.html` (~lines 502–525):

```js
${a.invoice_number
  ? `<a ... class="ld-inv-link" ...>INV# ${esc(a.invoice_number)}</a>`
  : ...}
${(a.load_count || 1) > 1
  ? `<span ...>Load ${a.load_number || 1} of ${a.load_count}</span>` : ''}
...
${esc(truncate(a.customer || 'Unknown', 20))}
```

Apply the same treatment to the outbound shipment rows on the logistics dashboard. The render function is **`buildOutboundRow(s)`** in `logistics/index.html` (~line 760). Today its first cell leads with customer:

```js
<td class="logistics-customer-cell">
  ${esc(s.customer) || '<span ...>—</span>'}
  ${jobLink ? `<br>${jobLink}` : ''}
</td>
```

Change that first cell so it leads with **INV#** (from the linked job — `buildOutboundRow` already resolves `linkedJob` via `allOpenJobs.find(j => j.id === s.job_id)`, use `linkedJob?.invoice_number`), then **load count** (`s.load_count`, only show "Load count: N" / a badge when `> 1`, matching the loading card's "Load X of Y" treatment), then **customer** as a secondary line truncated to 20 chars.

- Use the existing `truncate()` helper already present in `logistics/index.html` if defined there; otherwise use `utils.truncate` from `shared-utils.js`. Do **not** write a new truncation function.
- If a separate card/list view of outbound shipments also exists, apply the same lead treatment there for consistency. The calendar pill view (`renderShipmentCalendar`) is out of scope — leave it.
- Keep the existing `jobLink` anchor.

## Task B — Loading dashboard card sort by INV# (`logistics/loading.html`)

In **`renderOverview()`** (~line 340) the card arrays are built by filtering `allAssignments`:
- `awaiting` (~line 343)
- per-bay `bayAssignments` (~line 348)
- `transit` (~line 379)
- `delivered` (~line 383)

Sort each of these arrays by **`invoice_number` in ascending natural/numeric order** before `.map(... renderAssignmentCard ...)`. Apply the same sort to the equivalent arrays in **`renderBayView()`**.

- **Do NOT use `parseInt` on the INV#.** Invoice numbers can carry suffixes like `"3942-01"`; `parseInt` drops the suffix and misorders (same class of bug as the BOL number suffix issue). Use a natural/segmented comparator, e.g. `localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })` on the string INV#, with blank/missing INV# sorted last.
- Add a small **sort dropdown** above the dashboard with options: `INV# ↑` (default), `INV# ↓`, `Date added`. "Date added" sorts by `created_at`. Store the selection in a module-level variable and re-`renderDashboard()` on change. **In-memory only — do not add a new `localStorage` key.**

---

## What NOT to change
- The auto-pack algorithm. The `STORAGE_KEY` (`foam_trailer_loader_v31`).
- Card data model, the assignment fetch/filter logic, `renderAssignmentCard`'s internal markup (Task B only reorders the arrays feeding it), any API/route, or permissions.
