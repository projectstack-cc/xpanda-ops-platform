# Prompt 134 — Load Builder: condense Load-tab options + fix active-tab dark-mode button

## Context

Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. Assume the **logistics-agent** (frontend) role; this is Load Builder UI only.

Two things on `logistics/load-builder.html`, Load tab:

1. **Active-tab button is unreadable in dark mode.** The LOAD/SKUS/RESULTS tab buttons use `btn-dark` when active: `.btn-dark { background: var(--text); color: #fff; ... }`. In dark mode `--text` is near-white, so the active pill is pale with invisible white text. Fix: set its text to `var(--bg)` (the page background color) — gives dark text on the light pill in dark mode, and the existing dark-pill/white-text result in light mode.

2. **Condense the Load-tab options panel.** Today it's three stacked rows of pill buttons (TRAILER TYPE, RUNNERS, AUTO-DOWNSIZE) plus a separate "ADVANCED · FORCE TRAILER SIZES" disclosure. Replace with one aligned control bar in a single card:
   - TRAILER TYPE → `<select class="inp">` dropdown
   - RUNNERS → `<select class="inp">` dropdown
   - AUTO-DOWNSIZE → compact ON/OFF toggle (unchanged behavior)
   - FORCE SIZES → inline ON/OFF toggle (replaces the "Advanced" disclosure — same feature, no collapse). When ON, the per-trailer editor appears below the bar.
   - Dims readout stays right-aligned.
   - The two long hint lines collapse into one small muted helper line (runner note only when runners > 0).

   The Force Trailer Sizes **feature is retained in full** — only its "Advanced" wrapper/toggle is removed. The options panel is rendered in JS via the `h()` helper (no static HTML).

Desktop-first: the bar is expected to sit on one row on office screens; it wraps gracefully if narrow.

## Scope

- One file: `logistics/load-builder.html` (CSS in `<style>` + the options-panel render block).
- Reuse existing classes (`.inp`, `.btn`, `.btn-accent`, `.btn-white`, `.flex`, `.items-center`, `.flex-wrap`, `.gap-8`, `.card`, `.mb-18`) and existing tokens. Do **not** touch the auto-pack algorithm, `STORAGE_KEY`, `TRAILER_TYPES`, `state` shape, the SKU picker (`skp-*`), or any results/editor code.
- No migration, no worker change.

## Methodology (required)

1. For each find-block, confirm it appears **exactly once** (count == 1) before applying. Apply as full-block find/replace.
2. After edits, extract the inline `<script>` block(s) and run `node --check` on the concatenated script. Do not write if it fails.

---

## Edit 1 — active-tab button text color (CSS)

**Find:**
```
  .btn-dark { background: var(--text); color: #fff; border-color: var(--text); }
```
**Replace:**
```
  .btn-dark { background: var(--text); color: var(--bg); border-color: var(--text); }
```

## Edit 2 — option-label class (CSS)

The `.skp-adv-toggle` rule becomes unused (its button is removed). Repurpose that line as the new option-label class.

**Find:**
```
  .skp-adv-toggle { margin-bottom: 18px; }
```
**Replace:**
```
  .lb-opt-label { color: var(--accent); font-weight: 800; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
```

## Edit 3 — replace the options panel render block (JS)

**Find:**
```
  // Trailer type selector
  const typeCard = h('div', { className: 'card mb-18' });
  const typeRow = h('div', { className: 'flex items-center gap-10 flex-wrap' });
  typeRow.appendChild(h('span', { style: { color: 'var(--accent)', fontWeight: 800, fontSize: '13px' } }, 'TRAILER TYPE'));
  Object.keys(TRAILER_TYPES).forEach(t => {
    const active = state.trailerType === t;
    typeRow.appendChild(h('button', { className: `btn ${active ? 'btn-accent' : 'btn-white'}`, onClick: () => { state.trailerType = t; state.manualRowsByTrailer = {}; state.editorTrailer = null; render(); } }, t));
  });
  const bdft = Math.round((dims.length * dims.width * dims.height) / 144);
  const dimsLabel = h('span', { style: { marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 600 } }, `${dims.length}"L × ${dims.width}"W × ${dims.height}"H · ${bdft.toLocaleString()} BDFT`);
  typeRow.appendChild(dimsLabel);
  typeCard.appendChild(typeRow);

  const runnerRow = h('div', { className: 'flex items-center gap-10 flex-wrap', style: { marginTop: '10px' } });
  runnerRow.appendChild(h('span', { style: { color: 'var(--accent)', fontWeight: 800, fontSize: '13px' } }, 'RUNNERS'));
  [0, 3, 4].forEach(rh => {
    const label = rh === 0 ? 'NONE' : `${rh}" RUNNERS`;
    runnerRow.appendChild(h('button', { className: `btn ${state.runnerHeight === rh ? 'btn-accent' : 'btn-white'}`, onClick: () => { state.runnerHeight = rh; state.manualRowsByTrailer = {}; state.editorTrailer = null; render(); } }, label));
  });
  if (state.runnerHeight > 0) {
    runnerRow.appendChild(h('span', { style: { fontSize: '13px', color: 'var(--text-faint)', fontWeight: 600 } }, `Runner height deducted from available stacking height (${dims.height}" → ${dims.height - state.runnerHeight}")`));
  }
  typeCard.appendChild(runnerRow);

  const downsizeRow = h('div', { className: 'flex items-center gap-10 flex-wrap', style: { marginTop: '10px' } });
  downsizeRow.appendChild(h('span', { style: { color: 'var(--accent)', fontWeight: 800, fontSize: '13px' } }, 'AUTO-DOWNSIZE'));
  ['ON', 'OFF'].forEach(v => {
    const active = state.autoDownsize === (v === 'ON');
    downsizeRow.appendChild(h('button', { className: `btn ${active ? 'btn-accent' : 'btn-white'}`, onClick: () => { state.autoDownsize = v === 'ON'; render(); } }, v));
  });
  downsizeRow.appendChild(h('span', { style: { fontSize: '13px', color: 'var(--text-faint)', fontWeight: 600 } }, 'Auto-downsize last trailer to 26ft Box Truck when it fits'));
  typeCard.appendChild(downsizeRow);
  cont.appendChild(typeCard);

  // Advanced — Force Trailer Sizes (collapsed by default to keep the page short)
  const advToggle = h('button', { className: 'btn btn-white skp-adv-toggle', onClick: () => { state.showAdvanced = !state.showAdvanced; render(); } }, (state.showAdvanced ? '▾ ' : '▸ ') + 'ADVANCED · FORCE TRAILER SIZES');
  cont.appendChild(advToggle);
  if (state.showAdvanced) {
  const forcedCard = h('div', { className: 'card mb-18' });
  const forcedHdr = h('div', { className: 'flex items-center gap-10 flex-wrap' });
  forcedHdr.appendChild(h('span', { style: { color: 'var(--accent)', fontWeight: 800, fontSize: '13px' } }, 'FORCE TRAILER SIZES'));
  ['OFF', 'ON'].forEach(v => {
    const active = state.forcedMode === (v === 'ON');
    forcedHdr.appendChild(h('button', { className: `btn ${active ? 'btn-accent' : 'btn-white'}`, onClick: () => { state.forcedMode = v === 'ON'; render(); } }, v));
  });
  forcedCard.appendChild(forcedHdr);
  if (state.forcedMode) {
    const forcedBody = h('div', { style: { marginTop: '12px', display: 'grid', gap: '8px' } });
    state.forcedTrailers.forEach((ft, fti) => {
      const ftRow = h('div', { className: 'flex items-center gap-8 flex-wrap' });
      const typeSelect = h('select', { className: 'inp', style: { width: '200px', padding: '8px 10px' }, onChange: e => { state.forcedTrailers[fti].type = e.target.value; render(); } });
      Object.keys(TRAILER_TYPES).forEach(t => {
        const opt = h('option', { value: t }, t);
        if (ft.type === t) opt.selected = true;
        typeSelect.appendChild(opt);
      });
      ftRow.appendChild(typeSelect);
      const countInput = h('input', { type: 'number', min: '1', max: '10', className: 'inp', value: String(ft.count), style: { width: '70px', padding: '8px 10px' }, onInput: e => { state.forcedTrailers[fti].count = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)); } });
      ftRow.appendChild(countInput);
      ftRow.appendChild(h('span', { style: { fontSize: '13px', color: 'var(--text-muted)' } }, ft.count === 1 ? 'trailer' : 'trailers'));
      ftRow.appendChild(h('button', { className: 'btn btn-red-light', onClick: () => { state.forcedTrailers.splice(fti, 1); render(); } }, '×'));
      forcedBody.appendChild(ftRow);
    });
    forcedBody.appendChild(h('button', { className: 'btn btn-white', style: { marginTop: '4px' }, onClick: () => { state.forcedTrailers.push({ type: state.trailerType, count: 1 }); render(); } }, '+ ADD TRAILER'));
    forcedCard.appendChild(forcedBody);
  }
  cont.appendChild(forcedCard);
  }
```

**Replace:**
```
  // ── Options bar: trailer type + runners (dropdowns), auto-downsize + force-sizes (toggles) ──
  const optLabel = (txt) => h('span', { className: 'lb-opt-label' }, txt);
  const optGroup = (...kids) => { const g = h('div', { className: 'flex items-center gap-8' }); kids.forEach(k => g.appendChild(k)); return g; };

  const typeCard = h('div', { className: 'card mb-18' });
  const optBar = h('div', { className: 'flex items-center flex-wrap', style: { gap: '20px' } });

  // Trailer type dropdown
  const typeSel = h('select', { className: 'inp', style: { width: 'auto', minWidth: '170px' }, onChange: e => { state.trailerType = e.target.value; state.manualRowsByTrailer = {}; state.editorTrailer = null; render(); } });
  Object.keys(TRAILER_TYPES).forEach(t => {
    const opt = h('option', { value: t }, t);
    if (state.trailerType === t) opt.selected = true;
    typeSel.appendChild(opt);
  });
  optBar.appendChild(optGroup(optLabel('TRAILER TYPE'), typeSel));

  // Runners dropdown
  const runnerSel = h('select', { className: 'inp', style: { width: 'auto', minWidth: '120px' }, onChange: e => { state.runnerHeight = parseInt(e.target.value, 10) || 0; state.manualRowsByTrailer = {}; state.editorTrailer = null; render(); } });
  [0, 3, 4].forEach(rh => {
    const opt = h('option', { value: String(rh) }, rh === 0 ? 'None' : `${rh}" Runners`);
    if (state.runnerHeight === rh) opt.selected = true;
    runnerSel.appendChild(opt);
  });
  optBar.appendChild(optGroup(optLabel('RUNNERS'), runnerSel));

  // Auto-downsize ON/OFF
  const downsizeGroup = optGroup(optLabel('AUTO-DOWNSIZE'));
  ['ON', 'OFF'].forEach(v => {
    const active = state.autoDownsize === (v === 'ON');
    downsizeGroup.appendChild(h('button', { className: `btn ${active ? 'btn-accent' : 'btn-white'}`, onClick: () => { state.autoDownsize = v === 'ON'; render(); } }, v));
  });
  optBar.appendChild(downsizeGroup);

  // Force sizes ON/OFF (replaces the Advanced disclosure)
  const forceGroup = optGroup(optLabel('FORCE SIZES'));
  ['ON', 'OFF'].forEach(v => {
    const active = state.forcedMode === (v === 'ON');
    forceGroup.appendChild(h('button', { className: `btn ${active ? 'btn-accent' : 'btn-white'}`, onClick: () => { state.forcedMode = v === 'ON'; render(); } }, v));
  });
  optBar.appendChild(forceGroup);

  // Dims readout (right-aligned)
  const bdft = Math.round((dims.length * dims.width * dims.height) / 144);
  optBar.appendChild(h('span', { style: { marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 600 } }, `${dims.length}"L × ${dims.width}"W × ${dims.height}"H · ${bdft.toLocaleString()} BDFT`));
  typeCard.appendChild(optBar);

  // Condensed helper line
  const optHints = ['Auto-downsizes last trailer to 26ft Box Truck when it fits'];
  if (state.runnerHeight > 0) optHints.push(`Runner height deducted from stacking height (${dims.height}" → ${dims.height - state.runnerHeight}")`);
  typeCard.appendChild(h('div', { style: { marginTop: '10px', fontSize: '12px', color: 'var(--text-faint)', fontWeight: 600 } }, optHints.join('  ·  ')));

  // Force-sizes editor (inline, shown when ON)
  if (state.forcedMode) {
    const forcedBody = h('div', { style: { marginTop: '14px', display: 'grid', gap: '8px' } });
    state.forcedTrailers.forEach((ft, fti) => {
      const ftRow = h('div', { className: 'flex items-center gap-8 flex-wrap' });
      const typeSelect = h('select', { className: 'inp', style: { width: '200px', padding: '8px 10px' }, onChange: e => { state.forcedTrailers[fti].type = e.target.value; render(); } });
      Object.keys(TRAILER_TYPES).forEach(t => {
        const opt = h('option', { value: t }, t);
        if (ft.type === t) opt.selected = true;
        typeSelect.appendChild(opt);
      });
      ftRow.appendChild(typeSelect);
      const countInput = h('input', { type: 'number', min: '1', max: '10', className: 'inp', value: String(ft.count), style: { width: '70px', padding: '8px 10px' }, onInput: e => { state.forcedTrailers[fti].count = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)); } });
      ftRow.appendChild(countInput);
      ftRow.appendChild(h('span', { style: { fontSize: '13px', color: 'var(--text-muted)' } }, ft.count === 1 ? 'trailer' : 'trailers'));
      ftRow.appendChild(h('button', { className: 'btn btn-red-light', onClick: () => { state.forcedTrailers.splice(fti, 1); render(); } }, '×'));
      forcedBody.appendChild(ftRow);
    });
    forcedBody.appendChild(h('button', { className: 'btn btn-white', style: { marginTop: '4px' }, onClick: () => { state.forcedTrailers.push({ type: state.trailerType, count: 1 }); render(); } }, '+ ADD TRAILER'));
    typeCard.appendChild(forcedBody);
  }
  cont.appendChild(typeCard);
```

## Acceptance

- Active tab (LOAD/SKUS/RESULTS) is readable in both light and dark mode.
- Load-tab options sit in one aligned bar: TRAILER TYPE and RUNNERS are dropdowns; AUTO-DOWNSIZE and FORCE SIZES are ON/OFF toggles; dims readout right-aligned; single muted helper line beneath.
- No "Advanced" disclosure remains. Turning FORCE SIZES ON shows the per-trailer editor (type dropdown + count + add/remove) below the bar, with identical behavior to before.
- Changing trailer type or runners updates dims/BDFT and clears manual rows exactly as before; auto-downsize and force-mode behavior unchanged.
- `node --check` passes on the inline script.
```
