# Prompt 133 — Loading dashboard: dark-mode card scheme + Photos/BOL grey-out

## Context

Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. Assume the **logistics-agent** (frontend) and **db-api-agent** (the one SELECT change in `routes/loading.js`).

Three problems on the Loading Dashboard (`logistics/loading.html`):

1. **Cards glow white in dark mode.** `LD_STATUS_COLORS` applies hardcoded light pastel fills (`#f3f4f6`, `#fee2e2`, `#fef3c7`, `#d1fae5`, `#e0e7ff`, `#f0fdf4`) inline on every `.ld-card`, plus several hardcoded hover/drop colors (`#fff`, `#f9fafb`, `#dbeafe`, `#f3f4f6`) and pale button fills. None flip with the theme.
2. **Cards should match the SKU card scheme** (`.skp-card` in `load-builder.html`): themed `var(--surface)` background, `1px solid var(--line)` border, colored left border, faint status tint — instead of solid pastel fills.
3. **Photos and View BOL buttons** should render disabled (greyed) when nothing is attached.

Tokens come from `shared/tokens.css` (imported via `logistics-shared.css`) and flip on `:root[data-theme="dark"]`. Dark values: `--surface #1a1d29`, `--surface-2 #232634`, `--card-bg #1a1d29`, `--line #2d3142`, `--text #f3f4f6`, `--muted #9ca3af`, `--ghost-bg #232634`, `--accent #cbd5e1`, `--accent-soft #232634`. The fix routes hardcoded hexes through these tokens. Status color-coding (P115) is preserved via the colored left border + a faint status tint + the badge color.

## Scope

- `logistics/loading.html` (CSS in `<style>`, plus `renderAssignmentCard` and `renderBayList` inline markup).
- `_worker.js/routes/loading.js` (one SELECT — add two columns).
- No migration. No CSS class renames. Do not touch `LD_STATUS_COLORS` values, the auto-pack/load-builder code, or modal styling.

## Methodology (required)

1. For every find-block, confirm it appears **exactly once** (`grep -c` / count == 1) before applying. Several hardcoded hexes recur across the file — each block below carries enough surrounding text to be unique; do not shorten them.
2. Apply each as a full-block find/replace.
3. After edits: extract the inline `<script>` block(s) from `logistics/loading.html` and run `node --check`; run `node --check` on `_worker.js/routes/loading.js`. Do not write if either fails.

---

## PART A — Backend: expose photo/BOL presence (`_worker.js/routes/loading.js`)

**Find:**
```
        SELECT la.*, j.customer, j.invoice_number, j.po_number, j.ship_date, j.ship_to_company,
               j.ship_to_city, j.ship_to_state, j.carrier, j.method, j.load_count,
               lb.bay_number, lb.label as bay_label
        FROM loading_assignments la
```

**Replace:**
```
        SELECT la.*, j.customer, j.invoice_number, j.po_number, j.ship_date, j.ship_to_company,
               j.ship_to_city, j.ship_to_state, j.carrier, j.method, j.load_count,
               lb.bay_number, lb.label as bay_label,
               (SELECT COUNT(*) FROM loading_photos lp WHERE lp.job_id = la.job_id) AS photo_count,
               (SELECT COUNT(*) FROM bols b WHERE b.job_id = la.job_id) AS bol_count
        FROM loading_assignments la
```

---

## PART B — CSS token fixes (`logistics/loading.html` `<style>`)

**B1 — view toggle (no white inactive tabs)**

Find:
```
    .ld-view-btn { padding: 6px 14px; font-size: 12px; font-weight: 600; border: none; background: #fff; color: #6b7280; cursor: pointer; }
    .ld-view-btn.active { background: #1e293b; color: #fff; }
```
Replace:
```
    .ld-view-btn { padding: 6px 14px; font-size: 12px; font-weight: 600; border: none; background: var(--surface); color: var(--muted); cursor: pointer; }
    .ld-view-btn.active { background: var(--accent); color: var(--bg); }
```

**B2 — bay column surface**

Find:
```
    .ld-bay-col { width: auto; min-width: 0; background: #f9fafb; border-radius: 12px; border: 1px solid var(--line); }
```
Replace:
```
    .ld-bay-col { width: auto; min-width: 0; background: var(--surface-2); border-radius: 12px; border: 1px solid var(--line); }
```

**B3 — card surface + border (match `.skp-card`)**

Find:
```
    .ld-card { padding: 6px 8px; border-radius: 6px; margin-bottom: 6px; border: 1px solid transparent; }
```
Replace:
```
    .ld-card { padding: 6px 8px; border-radius: 6px; margin-bottom: 6px; border: 1px solid var(--line); background: var(--surface); transition: background 0.1s; }
```

**B4 — card text tokens**

Find:
```
    .ld-card-header strong { font-size: 12px; color: #111827; }
```
Replace:
```
    .ld-card-header strong { font-size: 12px; color: var(--text); }
```

Find:
```
    .ld-card-subtext { font-size: 10px; color: #6b7280; margin-bottom: 2px; }
```
Replace:
```
    .ld-card-subtext { font-size: 10px; color: var(--muted); margin-bottom: 2px; }
```

**B5 — Assign button**

Find:
```
    .ld-btn-assign { padding: 4px 10px; border: 1px solid #3b82f6; background: #eff6ff; color: #1e40af; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; }
```
Replace:
```
    .ld-btn-assign { padding: 4px 10px; border: 1px solid var(--line); background: var(--accent-soft); color: var(--text); border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; }
```

**B6 — BOL / Photos buttons (neutral + disabled state)**

Find:
```
    .ld-btn-bol { background: #f0f9ff; color: #0369a1; border: 1px solid #bae6fd; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .ld-btn-bol:hover { background: #e0f2fe; }
```
Replace:
```
    .ld-btn-bol { background: var(--ghost-bg); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .ld-btn-bol:hover { background: var(--surface-2); }
```

Find:
```
    .ld-btn-photos { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .ld-btn-photos:hover { background: #fde68a; }
```
Replace:
```
    .ld-btn-photos { background: var(--ghost-bg); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .ld-btn-photos:hover { background: var(--surface-2); }
    .ld-btn-bol:disabled, .ld-btn-photos:disabled { opacity: 0.4; cursor: default; }
    .ld-btn-bol:disabled:hover, .ld-btn-photos:disabled:hover { background: var(--ghost-bg); }
```

**B7 — job-result hover**

Find:
```
    .ld-job-result:hover { background: #f3f4f6; }
```
Replace:
```
    .ld-job-result:hover { background: var(--ghost-bg); }
```

**B8 — drop-hover highlights**

Find:
```
    .ld-drop-zone.ld-drop-hover { background: #dbeafe; }
    .ld-bay-body.ld-drop-hover { background: #dbeafe; }
    .ld-queue.ld-drop-hover { background: #dbeafe; border-radius: 8px; outline: 2px dashed #3b82f6; outline-offset: 2px; }
```
Replace:
```
    .ld-drop-zone.ld-drop-hover { background: var(--surface-2); }
    .ld-bay-body.ld-drop-hover { background: var(--surface-2); }
    .ld-queue.ld-drop-hover { background: var(--surface-2); border-radius: 8px; outline: 2px dashed #3b82f6; outline-offset: 2px; }
```

---

## PART C — `renderAssignmentCard` / `renderBayList` (inline markup)

**C1 — card surface + faint status tint (SKU treatment); badge uses vivid border color**

Find:
```
    <div class="ld-card" ${dragAttrs} style="border-left:4px solid ${sc.border};background:${sc.bg};" data-assignment-id="${a.id}">
```
Replace:
```
    <div class="ld-card" ${dragAttrs} style="border-left:4px solid ${sc.border};background:linear-gradient(0deg, ${sc.border}1f, ${sc.border}1f), var(--surface);" data-assignment-id="${a.id}">
```

Find:
```
        <span class="ld-status-badge" style="color:${sc.text};">${sc.label}</span>
```
Replace:
```
        <span class="ld-status-badge" style="color:${sc.border};">${sc.label}</span>
```

**C2 — BOL button disabled when no BOL; Photos button disabled when no photos**

Find:
```
        ${a.loading_status !== 'awaiting'
          ? `<button class="ld-btn-bol" onclick="viewBolForJob('${a.job_id}')">View BOL</button>`
          : ''}
        <button class="ld-btn-photos" onclick="photoGallery.openLightbox({ jobId: '${a.job_id}' })">📷 Photos</button>
```
Replace:
```
        ${a.loading_status !== 'awaiting'
          ? `<button class="ld-btn-bol" ${(a.bol_count > 0) ? `onclick="viewBolForJob('${a.job_id}')"` : 'disabled title="No BOL generated"'}>View BOL</button>`
          : ''}
        <button class="ld-btn-photos" ${(a.photo_count > 0) ? `onclick="photoGallery.openLightbox({ jobId: '${a.job_id}' })"` : 'disabled title="No photos attached"'}>📷 Photos</button>
```

**C3 — overview bay drop highlight**

Find:
```
          ondragover="event.preventDefault(); this.style.background='#dbeafe';"
          ondragleave="this.style.background='';"
          ondrop="onBayDrop(event, '${bay.id}'); this.style.background='';">
```
Replace:
```
          ondragover="event.preventDefault(); this.style.background='var(--surface-2)';"
          ondragleave="this.style.background='';"
          ondrop="onBayDrop(event, '${bay.id}'); this.style.background='';">
```

**C4 — bay-list item hover (no white-on-leave)**

Find:
```
      " onmouseenter="this.style.background='#f9fafb'" onmouseleave="this.style.background='#fff'">
```
Replace:
```
      " onmouseenter="this.style.background='var(--surface-2)'" onmouseleave="this.style.background='var(--card-bg)'">
```

**C5 — bay-list job-count pill**

Find:
```
            ? `<span style="background:#dbeafe;color:#1e40af;font-size:12px;font-weight:700;padding:4px 10px;border-radius:20px;">${jobCount} job${jobCount > 1 ? 's' : ''}</span>`
```
Replace:
```
            ? `<span style="background:var(--ghost-bg);color:var(--text);font-size:12px;font-weight:700;padding:4px 10px;border-radius:20px;">${jobCount} job${jobCount > 1 ? 's' : ''}</span>`
```

---

## Acceptance

- Dark mode: no card, button, hover, or drop highlight renders bright white/pastel; everything reads on the dark surface.
- Cards match the SKU treatment — `var(--surface)` base, `var(--line)` border, colored status left border, faint status tint; status badge text is the vivid status color and legible in both themes.
- Status color-coding (awaiting/not_started/loading/loaded/in_transit/delivered) still distinguishable at a glance in both themes.
- "View BOL" is disabled/greyed when the job has no BOL (`bol_count === 0`); "📷 Photos" is disabled/greyed when the job has no photos (`photo_count === 0`); both clickable when present.
- Light mode unchanged in spirit (tokens resolve to the prior light palette).
- `node --check` passes on the inline script and on `routes/loading.js`.
