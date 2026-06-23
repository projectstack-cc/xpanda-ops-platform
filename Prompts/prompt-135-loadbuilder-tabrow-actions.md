# Prompt 135 — Load Builder: Saved Loads / Pull From Job share the tab row

## Context

Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. Assume the **logistics-agent** role. Load Builder UI only (`logistics/load-builder.html`).

The top tabs (LOAD / SKUS / RESULTS) render in `renderTabs()` into `#headerTabs`. SAVED LOADS and PULL FROM JOB render separately in `renderLoadTab()` into `#tabLoad`, so they sit on a second row. Move them into the tab-nav row so all five buttons share one row. Keep them Load-tab-only (current behavior) and right-aligned, so the tabs stay left and the actions sit at the right end of the row. `.lb-tab-nav` is already `display:flex; flex-wrap:wrap; gap:8px`.

## Scope

- One file: `logistics/load-builder.html`, two JS edits. No CSS, no behavior change beyond relocation. Reuse existing `btn btn-white` styling and the existing `openLoadModal()` / `openPullJobPicker()` handlers.

## Methodology (required)

1. Confirm each find-block appears **exactly once** (count == 1) before applying; apply as full-block find/replace.
2. After edits, extract the inline `<script>` block(s) and run `node --check`. Do not write if it fails.

## Edit 1 — append the two action buttons into the tab row (Load tab only)

**Find:**
```
  [["load", `LOAD${state.cart.length ? ` (${totalPcs})` : ""}`], ["skus", "SKUS"], ["results", "RESULTS"]].forEach(([id, label]) => {
    const active = state.tab === id;
    const btn = h('button', { className: `btn ${active ? 'btn-dark' : 'btn-white'}`, onClick: () => { state.tab = id; render(); } }, label);
    cont.appendChild(btn);
  });
}
```

**Replace:**
```
  [["load", `LOAD${state.cart.length ? ` (${totalPcs})` : ""}`], ["skus", "SKUS"], ["results", "RESULTS"]].forEach(([id, label]) => {
    const active = state.tab === id;
    const btn = h('button', { className: `btn ${active ? 'btn-dark' : 'btn-white'}`, onClick: () => { state.tab = id; render(); } }, label);
    cont.appendChild(btn);
  });
  if (state.tab === 'load') {
    cont.appendChild(h('button', { className: 'btn btn-white', style: { marginLeft: 'auto' }, onClick: () => openLoadModal() }, 'SAVED LOADS'));
    cont.appendChild(h('button', { className: 'btn btn-white', style: { marginLeft: '8px' }, onClick: () => openPullJobPicker() }, 'PULL FROM JOB'));
  }
}
```

## Edit 2 — remove the old buttons from `renderLoadTab()`

**Find:**
```
  // Saved loads button
  const savedLoadsBtn = h('button', { className: 'btn btn-white', style: { marginBottom: '12px' }, onClick: () => openLoadModal() }, 'SAVED LOADS');
  cont.appendChild(savedLoadsBtn);

  // Pull from Job button
  const pullJobBtn = h('button', { className: 'btn btn-white', style: { marginBottom: '12px', marginLeft: '8px' }, onClick: () => openPullJobPicker() }, 'PULL FROM JOB');
  cont.appendChild(pullJobBtn);

```

**Replace:** (empty — remove the block)

## Acceptance

- On the Load tab, LOAD / SKUS / RESULTS sit at the left and SAVED LOADS / PULL FROM JOB at the right end of the same row.
- On SKUS / RESULTS tabs, only the three tabs show (unchanged).
- Both action buttons work exactly as before (open saved-loads modal / pull-from-job picker).
- `node --check` passes on the inline script.
```
