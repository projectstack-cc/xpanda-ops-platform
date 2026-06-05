# Prompt 116 — Loading Dashboard: show loading started/completed times in the detail view

Read `AGENTS.md` and `xpanda-ops-agents.md` first. This is a frontend display-only change —
assume the **logistics-agent** (`xpanda-ops-agents.md`).

Scope: **`logistics/loading.html` only.** Frontend only. **No migration. No backend change.**

Context (already true — do not re-implement): the worker writes `started_at`, `loaded_at`,
`in_transit_at`, `delivered_at` onto `loading_assignments` on each status transition, and the
loading GET selects `la.*`, so every assignment object already carries these fields client-side.
This prompt only **displays** them in the shipping-info detail modal (`populateShippingInfo`).

Both find-blocks are single-source (verified). Apply as exact find/replace. Do not touch any other
function or file.

---

## Edit 1 — Add a timestamp formatter alongside the existing `row` helper

FIND:
```
  const row = (label, value) => value
    ? `<div style="display:flex;gap:8px;margin-bottom:6px;"><span style="min-width:110px;color:#6b7280;font-weight:600;">${esc(label)}:</span><span>${esc(value)}</span></div>`
    : '';
```
REPLACE:
```
  const row = (label, value) => value
    ? `<div style="display:flex;gap:8px;margin-bottom:6px;"><span style="min-width:110px;color:#6b7280;font-weight:600;">${esc(label)}:</span><span>${esc(value)}</span></div>`
    : '';

  const fmtTs = (ts) => {
    if (!ts) return '';
    const d = new Date(String(ts).replace(' ', 'T'));
    return isNaN(d.getTime()) ? '' : d.toLocaleString();
  };
```

## Edit 2 — Insert the two timestamp rows between Method and Notes

FIND:
```
    ${row('Carrier', job.carrier)}
    ${row('Method', job.method)}
    ${row('Notes', job.notes)}
```
REPLACE:
```
    ${row('Carrier', job.carrier)}
    ${row('Method', job.method)}
    ${row('Loading Started', fmtTs(a.started_at))}
    ${row('Loading Completed', fmtTs(a.loaded_at))}
    ${row('Notes', job.notes)}
```

---

## Result
In the shipping-info detail modal (opened by clicking an INV# link on a loading card), two rows
appear after "Method": **Loading Started** (from `started_at`) and **Loading Completed**
(from `loaded_at`), formatted in local time. Because `row(...)` only renders when its value is
truthy and `fmtTs` returns `''` for null/empty, the rows are hidden until the timestamps exist
(i.e. until the card has actually entered Loading / been marked Loaded).

## Verify after editing
- Confirm the change actually deployed to Cloudflare (live page).
- Open an assignment that has already been started and loaded — both rows show with sensible
  local times. Open one still in Not Started — neither row shows.
