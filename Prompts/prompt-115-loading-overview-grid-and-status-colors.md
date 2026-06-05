# Prompt 115 — Loading Dashboard: overview bay grid (6/5) + status recolor

Read `AGENTS.md` and `xpanda-ops-agents.md` first. This is a visual-only change to the
loading dashboard overview — assume the **logistics-agent** (`xpanda-ops-agents.md`) and the
**Frontend Designer** agent (`agent-frontend-designer.md`).

Scope: **`logistics/loading.html` only.** Frontend only. **No migration. No backend. No JS logic
changes** — only the CSS for the bays grid and the two color entries in `LD_STATUS_COLORS`.

All five find-blocks below are single-source (verified). Apply each as an exact full-line
find/replace. Do not touch the auto-pack algorithm, `STORAGE_KEY`, drag-and-drop handlers, or any
other file.

---

## Edit 1 — Overview bays grid becomes a 6-per-row grid (11 bays → 6 top, 5 bottom)

FIND:
```
    .ld-bays-grid { display: flex; gap: 12px; min-width: max-content; }
```
REPLACE:
```
    .ld-bays-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
```

## Edit 2 — Bay columns fill their grid track instead of a fixed 220px

FIND:
```
    .ld-bay-col { width: 220px; min-width: 220px; background: #f9fafb; border-radius: 12px; border: 1px solid var(--line); }
```
REPLACE:
```
    .ld-bay-col { width: auto; min-width: 0; background: #f9fafb; border-radius: 12px; border: 1px solid var(--line); }
```

## Edit 3 — Mobile: stack the grid to a single column

FIND:
```
      .ld-bays-grid { flex-direction: column; min-width: unset; }
```
REPLACE:
```
      .ld-bays-grid { grid-template-columns: 1fr; }
```

## Edit 4 — Recolor "Not Started" to red

FIND:
```
  not_started: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', label: 'Not Started' },
```
REPLACE:
```
  not_started: { bg: '#fee2e2', border: '#ef4444', text: '#991b1b', label: 'Not Started' },
```

## Edit 5 — Recolor "Loading" (In Progress) to yellow/amber

FIND:
```
  loading:     { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af', label: 'Loading' },
```
REPLACE:
```
  loading:     { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', label: 'Loading' },
```

---

## Result
- The overview "bays" section lays out 6 bays on the top row and the remaining 5 on the bottom
  (was a single horizontal-scroll row). The existing `.ld-bays-scroll` wrapper stays; the grid
  fits within it so there is no horizontal scroll on desktop. On ≤768px it collapses to one column.
- Assignment cards render with **Not Started = red** and **Loading = yellow/amber** consistently
  everywhere `renderAssignmentCard` is used (overview, bay view, yard, transit). `awaiting`,
  `loaded`, `in_transit`, and `delivered` colors are unchanged.

## Verify after editing
- Confirm the change actually deployed to Cloudflare (live page, not just local).
- On the loading dashboard overview, count bays per row (6 / 5) and confirm Not Started cards are
  red and Loading cards are amber.
- Eyeball the narrower bay columns on a ~1024px-wide screen — cards and the trailer input should
  still fit; flag if anything clips.
