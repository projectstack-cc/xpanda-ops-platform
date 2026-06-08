# Prompt 136 — Load Builder: restore deleted saved-load functions, un-sticky LOAD LIST, stop scroll-jump on add

## Context

Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. Assume the **logistics-agent** role. `logistics/load-builder.html` only.

Three problems, one of them critical:

1. **CRITICAL — `saveLoad` and `openLoadModal` are undefined.** They are called (the SAVE LOAD and LOAD buttons in `renderResultsTab`, the SAVED LOADS button in `renderTabs`, and indirectly via `prefillFromJob`) but have **no definition** in the file — they were removed as collateral during the BOL re-unification (P125/P126). Because `renderResultsTab()` references `saveLoad` and runs inside `render()` **before** the `.tab-content` visibility toggle, the `ReferenceError` aborts `render()` whenever the cart is non-empty — so CALCULATE LOAD never switches to the Results tab, SAVE LOAD/LOAD/SAVED-LOADS all error, and `prefillFromJob` fails. Restore both functions verbatim (recovered from the pre-removal commit; they depend only on still-present helpers: `api.*`, `showToast`, `h`, `state`, `render`, `prompt`, `confirm`).
2. **LOAD LIST bar should not be sticky.** `.skp-actionbar` is `position: sticky; bottom: 12px` and overlays the page. Make it a normal in-flow card.
3. **Adding a SKU scrolls the picker to the top.** `render()` rebuilds `#tabLoad`, so the internally-scrolling `.skp-grid` resets its scroll to 0 on every add/qty change. Preserve the grid's scroll position across re-render.

## Scope

- One file: `logistics/load-builder.html` (one CSS line, two `renderLoadTab` edits, one function-restore insertion).
- Do **not** touch the auto-pack algorithm, `STORAGE_KEY`, `calcLoading`, `state` shape, or the SKU card/qty stepper markup.

## Methodology (required)

1. Confirm each find-block appears **exactly once** (count == 1). Apply as full-block find/replace.
2. After edits: confirm `grep -c 'function saveLoad'` and `grep -c 'function openLoadModal'` each return 1. Extract the inline `<script>` block(s) and run `node --check`. Do not write if it fails.

---

## Edit 1 — un-sticky the LOAD LIST bar (CSS)

**Find:**
```
  .skp-actionbar { position: sticky; bottom: 12px; z-index: 20; box-shadow: 0 -2px 16px rgba(15,23,42,0.10); }
```
**Replace:**
```
  .skp-actionbar { margin-top: 18px; }
```

## Edit 2 — capture grid scroll before rebuild (`renderLoadTab`)

**Find:**
```
function renderLoadTab() {
  const cont = document.getElementById('tabLoad');
  cont.innerHTML = '';
```
**Replace:**
```
function renderLoadTab() {
  const cont = document.getElementById('tabLoad');
  const _prevGrid = cont.querySelector('.skp-grid');
  const _gridScroll = _prevGrid ? _prevGrid.scrollTop : 0;
  cont.innerHTML = '';
```

## Edit 3 — restore grid scroll after rebuild (`renderLoadTab`)

**Find:**
```
  detail.appendChild(grid);
  md.appendChild(detail);
  cont.appendChild(md);
```
**Replace:**
```
  detail.appendChild(grid);
  md.appendChild(detail);
  cont.appendChild(md);
  grid.scrollTop = _gridScroll;
```

## Edit 4 — restore the deleted functions

Insert both function definitions immediately before `openPullJobPicker`.

**Find:**
```
async function openPullJobPicker() {
```
**Replace:**
```
async function saveLoad() {
  const customer = (state.prefillJobData?.customer || '').trim();
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const defaultName = customer ? `${customer} — ${dateStr}` : dateStr;
  const name = prompt('Save load as:', state.currentSavedLoadId ? '' : defaultName);
  if (name === null) return;

  const stateJson = {
    trailerType:           state.trailerType,
    trailerInvNumbers:     state.trailerInvNumbers,
    runnerHeight:          state.runnerHeight,
    autoDownsize:          state.autoDownsize,
    forcedTrailers:        state.forcedTrailers,
    forcedMode:            state.forcedMode,
    variant:               state.variant,
    manualRowsByTrailer:   state.manualRowsByTrailer,
    skus:                  state.skus,
    cart:                  state.cart,
    prefillJobId:          state.prefillJobId,
  };

  const payload = {
    name:         name.trim() || defaultName,
    job_id:       state.prefillJobId || null,
    customer:     customer,
    trailer_type: state.trailerType,
    state_json:   JSON.stringify(stateJson),
  };

  try {
    const isUpdate = !!state.currentSavedLoadId;
    const url = isUpdate
      ? '/api/saved-loads/' + encodeURIComponent(state.currentSavedLoadId)
      : '/api/saved-loads';
    const res = isUpdate ? await api.put(url, payload) : await api.post(url, payload);
    const data = res.data;
    if (!res.ok) { showToast('Failed to save load: ' + (res.error || 'Unknown error'), 'error'); return; }
    state.currentSavedLoadId = data.load.id;
    showToast('Load saved.', 'success');
  } catch {
    showToast('Network error saving load.', 'error');
  }
}

async function openLoadModal() {
  let loads = [];
  try {
    const res = await api.get('/api/saved-loads');
    if (!res.ok) { showToast('Failed to load saved loads.', 'error'); return; }
    loads = res.data.loads || [];
  } catch {
    showToast('Network error loading saved loads.', 'error');
    return;
  }

  const backdrop = h('div', { style: { position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.5)', zIndex: '9998', display: 'flex', alignItems: 'center', justifyContent: 'center' } });
  const modal = h('div', { style: { background: '#fff', borderRadius: '12px', padding: '24px', width: '560px', maxWidth: '95vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' } });

  const hdr = h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } });
  hdr.appendChild(h('strong', { style: { fontSize: '16px' } }, 'Saved Loads'));
  hdr.appendChild(h('button', { style: { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }, onClick: () => backdrop.remove() }, '×'));
  modal.appendChild(hdr);

  if (!loads.length) {
    modal.appendChild(h('p', { style: { color: 'var(--text-muted)', fontSize: '14px' } }, 'No saved loads.'));
  } else {
    const list = h('div', { style: { display: 'grid', gap: '8px' } });
    for (const load of loads) {
      const row = h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', cursor: 'pointer', background: '#f9fafb' } });
      const info = h('div', { style: { flex: '1', minWidth: '0' } });
      info.appendChild(h('div', { style: { fontWeight: '700', fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, load.name || '(unnamed)'));
      info.appendChild(h('div', { style: { fontSize: '12px', color: 'var(--text-muted)' } }, `${load.customer || ''}${load.customer && load.trailer_type ? ' · ' : ''}${load.trailer_type || ''} · Saved ${new Date(load.updated_at).toLocaleDateString()}`));
      row.appendChild(info);

      const loadBtn = h('button', { className: 'btn btn-white', style: { padding: '6px 12px', fontSize: '12px', whiteSpace: 'nowrap' } }, 'Load');
      loadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const res = await api.get('/api/saved-loads/' + encodeURIComponent(load.id));
          if (!res.ok) { showToast('Failed to load: ' + (res.error || ''), 'error'); return; }
          const s = JSON.parse(res.data.load.state_json || '{}');
          if (s.trailerType)          state.trailerType          = s.trailerType;
          if (s.trailerInvNumbers)    state.trailerInvNumbers    = s.trailerInvNumbers;
          if (s.runnerHeight != null) state.runnerHeight         = s.runnerHeight;
          if (s.autoDownsize != null) state.autoDownsize         = s.autoDownsize;
          if (s.forcedTrailers)       state.forcedTrailers       = s.forcedTrailers;
          if (s.forcedMode != null)   state.forcedMode           = s.forcedMode;
          if (s.variant != null)      state.variant              = s.variant;
          if (s.manualRowsByTrailer)  state.manualRowsByTrailer  = s.manualRowsByTrailer;
          if (s.skus)                 state.skus                 = s.skus;
          if (s.cart)                 state.cart                 = s.cart;
          if (s.prefillJobId != null) state.prefillJobId         = s.prefillJobId;
          state.currentSavedLoadId = load.id;
          state.editorTrailer = null;
          backdrop.remove();
          render();
          showToast('Load restored.', 'success');
        } catch {
          showToast('Network error loading saved load.', 'error');
        }
      });
      row.appendChild(loadBtn);

      const delBtn = h('button', { className: 'btn btn-red-light', style: { padding: '6px 10px', fontSize: '12px', whiteSpace: 'nowrap' } }, '×');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete saved load "${load.name || '(unnamed)'}"?`)) return;
        try {
          const res = await api.del('/api/saved-loads/' + encodeURIComponent(load.id));
          if (!res.ok) { showToast('Delete failed.', 'error'); return; }
          row.remove();
          if (!list.children.length) list.appendChild(h('p', { style: { color: 'var(--text-muted)', fontSize: '14px' } }, 'No saved loads.'));
        } catch {
          showToast('Network error.', 'error');
        }
      });
      row.appendChild(delBtn);
      list.appendChild(row);
    }
    modal.appendChild(list);
  }

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

async function openPullJobPicker() {
```

## Acceptance

- `saveLoad` and `openLoadModal` are defined exactly once each; no `ReferenceError` in console on load or interaction.
- CALCULATE LOAD switches to the Results tab and renders the load; SAVE LOAD, LOAD, and SAVED LOADS all work; PULL FROM JOB / prefill no longer error.
- The LOAD LIST card scrolls with the page (no longer sticky/overlaying).
- Adding a SKU or changing a qty keeps the SKU grid at its current scroll position (no jump to top).
- `node --check` passes on the inline script.
```
