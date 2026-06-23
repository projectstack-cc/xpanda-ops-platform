# Prompt 169 — Loading Dashboard / Team View batch (bay coloring, trailer # in header, trailer save bug, status color disambiguation)

## Required reading (do this first)
1. Read `AGENTS.md` (platform conventions).
2. Read `xpanda-ops-agents.md` (multi-agent definition).
3. Assume the **logistics-agent** role (`logistics/*`). This task is **frontend-only**, confined to `logistics/loading.html`, plus bookkeeping in `BACKLOG.md` and `CHANGELOG.md`. No DB migration, no worker change, no new permission key, no other module.

## Context
Knocking out the remaining open items in the BACKLOG "New Batch — Loading Dashboard + Driver + BOL Alignment" cluster. Four are implemented here; three were already satisfied by prior shipped work and are closed in bookkeeping (see step 7).

All edits are byte-exact find/replace. Each `old_str` below was verified to appear **exactly once** in the current HEAD. Confirm `count == 1` for every block before applying. Do not reflow or reformat surrounding code.

---

## Edit 1 — Status color disambiguation (`delivered` collides with `loaded`)
`loaded` and `delivered` are both green (`#10b981` / `#22c55e`), which is the "distinct statuses share the same color" complaint. Re-key `delivered` to teal so all six statuses are visually unique (awaiting=gray, not_started=red, loading=amber, loaded=emerald, in_transit=indigo, delivered=teal).

**File:** `logistics/loading.html`

FIND (exactly once):
```
  delivered:   { bg: '#f0fdf4', border: '#22c55e', text: '#166534', label: 'Delivered' },
```

REPLACE:
```
  delivered:   { bg: '#ccfbf1', border: '#0d9488', text: '#115e59', label: 'Delivered' },
```

---

## Edit 2 — Trailer "needs two saves to stick" bug (root cause + fix)
Root cause: `updateAssignmentTrailer()` PUTs the value but on **success** does not update the in-memory `allAssignments` model and does not re-render. The stale in-memory `trailer_number` reappears on any subsequent re-render (drill in/out, bay switch, dashboard refresh), so it looks like the first save was dropped. Fix: trim the value, and on success patch the in-memory assignment. Keep the failure path's reload.

**File:** `logistics/loading.html`

FIND (exactly once):
```
async function updateAssignmentTrailer(assignmentId, trailerNumber) {
  const { ok, data } = await api.put('/api/loading-assignments', { id: assignmentId, trailer_number: trailerNumber });
  if (!ok) {
    alert(data?.error || 'Failed to update trailer #');
    loadDashboard();
  }
}
```

REPLACE:
```
async function updateAssignmentTrailer(assignmentId, trailerNumber) {
  const trimmed = (trailerNumber || '').trim();
  const { ok, data } = await api.put('/api/loading-assignments', { id: assignmentId, trailer_number: trimmed });
  if (ok) {
    // Persist to the in-memory model so any re-render (drill in/out, bay switch,
    // dashboard refresh) reflects the saved value — fixes the "needs two saves
    // to stick" bug where the stale in-memory value overwrote the input.
    const a = allAssignments.find(x => String(x.id) === String(assignmentId));
    if (a) a.trailer_number = trimmed;
  } else {
    alert(data?.error || 'Failed to update trailer #');
    loadDashboard();
  }
}
```

---

## Edit 3 — Bay coloring + status label + trailer # on the Loading Team View bay list (`renderBayList`)
Color each bay-list item by its active job's loading status (left border + faint status tint, mirroring the assignment-card treatment), add a status-label badge, and surface the active job's trailer number on the top header line. Bump the "Bay N" header text size and add field spacing.

Note: the existing `onmouseenter`/`onmouseleave` inline handlers are removed because they hardcode `var(--card-bg)`, which would clobber the new status tint on mouse-out. The status tint provides the visual structure instead.

**File:** `logistics/loading.html`

FIND (exactly once):
```
  const html = allBays.map(bay => {
    const bayAssignments = allAssignments.filter(a =>
      a.bay_id === bay.id && ['not_started', 'loading', 'loaded'].includes(a.loading_status)
    );
    const jobCount = bayAssignments.length;
    const activeJob = bayAssignments.find(a => a.loading_status === 'loading') || bayAssignments[0];

    return `
      <div class="ld-bay-list-item" onclick="drillIntoBay('${bay.id}')" style="
        display:flex; align-items:center; justify-content:space-between;
        padding:16px; margin-bottom:8px; background:var(--card-bg);
        border:1px solid var(--line); border-radius:12px;
        cursor:pointer; transition:background 0.15s;
      " onmouseenter="this.style.background='var(--surface-2)'" onmouseleave="this.style.background='var(--card-bg)'">
        <div>
          <div style="font-weight:700;font-size:18px;color:var(--text);">Bay ${bay.bay_number}</div>
          ${activeJob
            ? `<div style="font-size:13px;color:var(--muted);margin-top:4px;">
                ${esc(activeJob.customer || 'Unknown')}${activeJob.invoice_number ? ' — INV# ' + esc(activeJob.invoice_number) : ''}
              </div>`
            : `<div style="font-size:13px;color:#9ca3af;margin-top:4px;">No active jobs</div>`
          }
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          ${jobCount > 0
            ? `<span style="background:var(--ghost-bg);color:var(--text);font-size:12px;font-weight:700;padding:4px 10px;border-radius:20px;">${jobCount} job${jobCount > 1 ? 's' : ''}</span>`
            : ''
          }
          <span style="color:#9ca3af;font-size:18px;">›</span>
        </div>
      </div>
    `;
```

REPLACE:
```
  const html = allBays.map(bay => {
    const bayAssignments = allAssignments.filter(a =>
      a.bay_id === bay.id && ['not_started', 'loading', 'loaded'].includes(a.loading_status)
    );
    const jobCount = bayAssignments.length;
    const activeJob = bayAssignments.find(a => a.loading_status === 'loading') || bayAssignments[0];
    const sc = activeJob ? (LD_STATUS_COLORS[activeJob.loading_status] || LD_STATUS_COLORS.awaiting) : null;
    const trailer = activeJob && activeJob.trailer_number ? activeJob.trailer_number : '';

    return `
      <div class="ld-bay-list-item" onclick="drillIntoBay('${bay.id}')" style="
        display:flex; align-items:center; justify-content:space-between;
        padding:16px; margin-bottom:8px;
        background:${sc ? `linear-gradient(0deg, ${sc.border}14, ${sc.border}14), var(--card-bg)` : 'var(--card-bg)'};
        border:1px solid var(--line); border-left:5px solid ${sc ? sc.border : 'var(--line)'};
        border-radius:12px; cursor:pointer; transition:background 0.15s;
      ">
        <div>
          <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
            <span style="font-weight:700;font-size:22px;color:var(--text);">Bay ${bay.bay_number}</span>
            ${trailer
              ? `<span style="font-weight:700;font-size:15px;color:var(--text);background:var(--ghost-bg);padding:3px 10px;border-radius:6px;">🚛 ${esc(trailer)}</span>`
              : ''}
            ${sc
              ? `<span class="ld-status-badge" style="font-size:12px;color:${sc.border};">${sc.label}</span>`
              : ''}
          </div>
          ${activeJob
            ? `<div style="font-size:13px;color:var(--muted);margin-top:6px;">
                ${esc(activeJob.customer || 'Unknown')}${activeJob.invoice_number ? ' — INV# ' + esc(activeJob.invoice_number) : ''}
              </div>`
            : `<div style="font-size:13px;color:#9ca3af;margin-top:6px;">No active jobs</div>`
          }
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          ${jobCount > 0
            ? `<span style="background:var(--ghost-bg);color:var(--text);font-size:12px;font-weight:700;padding:4px 10px;border-radius:20px;">${jobCount} job${jobCount > 1 ? 's' : ''}</span>`
            : ''
          }
          <span style="color:#9ca3af;font-size:18px;">›</span>
        </div>
      </div>
    `;
```

---

## Edit 4 — Trailer # + larger header on the drilled-in single-bay view
Same "trailer # on the header line + larger header text + spacing" treatment for the single-bay detail header. `bayAssignments` is already in scope in `renderBayView()`.

**File:** `logistics/loading.html`

FIND (exactly once):
```
      <div class="ld-bay-single-header">
        <h3>Bay ${bay.bay_number}</h3>
      </div>
```

REPLACE:
```
      <div class="ld-bay-single-header" style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
        <h3 style="font-size:26px; margin:0;">Bay ${bay.bay_number}</h3>
        ${(() => {
          const aj = bayAssignments.find(a => a.loading_status === 'loading') || bayAssignments[0];
          return aj && aj.trailer_number
            ? `<span style="font-weight:700;font-size:16px;color:var(--text);background:var(--ghost-bg);padding:4px 12px;border-radius:6px;">🚛 ${esc(aj.trailer_number)}</span>`
            : '';
        })()}
      </div>
```

---

## Step 5 — Syntax validation (required)
`logistics/loading.html` is HTML with an inline `<script>`. Validate the script after edits:
1. Extract every inline `<script>...</script>` block to a **real temp file** using `re.findall` (do NOT pipe source via `/dev/stdin` — it triggers a false-positive ENOENT).
2. Run `node --check` on each extracted temp file.
3. Confirm clean exit before proceeding. Delete temp files after.

---

## Step 6 — Visual sanity (manual notes for Steve, no action by Claude Code)
- Team View bay list: each bay tinted by active-job status, status badge + trailer pill on the header line; "No active jobs" bays stay neutral.
- Drill into a bay: larger "Bay N" header with trailer pill alongside.
- Set a trailer # once on a bay card, drill out and back in — value persists (no second save needed).
- All six status colors are now distinct.

---

## Step 7 — Bookkeeping (BACKLOG.md + CHANGELOG.md)
This batch closes the **entire** "New Batch — Loading Dashboard + Driver + BOL Alignment" section. Four items ship in P169; three were already satisfied by prior shipped work and are closed here:
- "On Mark In Transit, clear the trailer input field" — already satisfied: the trailer `<input>` only renders for `not_started/loading/loaded`; at `in_transit` the card re-renders to a read-only span, so the field is gone.
- "Human-error fallback (driver QR → force In Transit)" — already satisfied: `_worker.js/routes/public.js handleApiPublicBolPickup` unconditionally sets `loading_assignments.loading_status='in_transit'` on pickup (shipped with the P82–P84 driver tracking work).
- "DocuSign on the driver pages" — superseded/satisfied by native driver + customer signature capture (P154–P155). Closing the DocuSign approach for the driver flow.

### 7a — CHANGELOG.md
**File:** `CHANGELOG.md`

FIND (exactly once):
```
## Logistics

- **P166**
```

REPLACE:
```
## Logistics

- **P169** — Loading Team View batch: (1) bay-list items color-tinted by active-job loading status with status-label badge (`renderBayList`); (2) active-job trailer # surfaced on the bay-list header line and on the drilled-in single-bay header, with larger header text + field spacing; (3) fix trailer "needs two saves to stick" — `updateAssignmentTrailer` now patches the in-memory `allAssignments` model on success so re-renders no longer overwrite the input with a stale value; (4) status-color disambiguation — `delivered` re-keyed emerald→teal (`#0d9488`) so all six statuses are unique. Frontend-only, `logistics/loading.html`. Also closes the rest of the "New Batch — Loading Dashboard + Driver + BOL Alignment" cluster: trailer-input-clear-on-transit and driver-QR-force-in-transit verified already-shipped (card re-render / `public.js` pickup handler), and DocuSign-on-driver-pages superseded by native signature capture (P154–P155).
- **P166**
```

### 7b — BACKLOG.md
Remove the now-fully-closed section. **File:** `BACKLOG.md`

FIND (exactly once) and DELETE entirely (replace with empty string):
```
### New Batch — Loading Dashboard + Driver + BOL Alignment

- [ ] On **Mark In Transit**, clear the trailer input field on the loading dashboard.
- [ ] **Human-error fallback:** if a driver scans the QR to begin transit while the trailer was **not** marked loaded, force the trailer card into **In Transit**.
- [ ] DocuSign on the driver pages.
- [ ] **Bay coloring on Loading Team View** — color-code bays to reflect current loading status at a glance; surface the status label on each bay so all bay states are visible in one view.
- [ ] **Trailer # in Loading Team View header** — move trailer number to the top header line alongside the other key fields; add appropriate spacing between all header fields for visual differentiation; increase header text size.
- [ ] **Trailer number requires two inputs to stick (bay view bug)** — trailer number field on the bay card does not persist on the first save; user must enter it a second time. Investigate the save/blur handler and any optimistic-update race that might be discarding the first write.
- [ ] **Status colors incomplete / ambiguous** — status badge colors don't always display correctly if the standard event sequence is not followed; some distinct statuses share the same color. Audit all status → color mappings and assign unique, unambiguous colors; add a guard so color is derived from status value only (not from prior UI state).

```

---

## What NOT to change
- Do NOT touch the `LD_STATUS_COLORS` keys other than `delivered` (Edit 1 only changes that one row's hex values).
- Do NOT modify the Mark Loaded checklist flow, photo gallery, drag-and-drop handlers (`onCardDragStart`, `onQueueDrop`, touch drag), `advanceStatus`, `moveToYard`, or `renderAssignmentCard` beyond what is specified.
- Do NOT touch any other file: no `bol-shared.js`, no `load-builder.html`, no auto-pack algorithm, no `STORAGE_KEY` (`foam_trailer_loader_v31`), no worker routes, no migrations, no admin pages.
- Do NOT add a DB migration or permission key — there is no schema or auth change.
- Do NOT reformat or reflow unrelated code.

## Deliverables summary
- `logistics/loading.html` — 4 edits (status color, trailer save fix, bay-list coloring/header, single-bay header).
- `CHANGELOG.md` — P169 entry added.
- `BACKLOG.md` — "New Batch — Loading Dashboard + Driver + BOL Alignment" section removed.
- Inline script passes `node --check`.
