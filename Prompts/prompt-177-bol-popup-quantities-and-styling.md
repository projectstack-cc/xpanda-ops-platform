# Prompt 177 — BOL popup: remove QUANTITIES panel + make styling self-contained so it's identical in both places

## Required reading (do this first)
1. Read `AGENTS.md` (platform conventions).
2. Read `xpanda-ops-agents.md` (multi-agent definition).
3. Assume the **logistics-agent** role. Single file: `logistics/bol-compose.js`. Frontend only. No DB, no worker, no permission key.

## Context
`BolCompose` is one component used in two places (load-builder and the logistics dashboard launcher), so it must look and behave identically in both. Two problems:

1. **QUANTITIES panel (remove it):** P171 added an editable Pieces/Stacks/Weight panel to the modal. It's unnecessary clutter (the header already summarizes pcs/stacks, and load-builder derives these from the pack). Remove it entirely.
2. **Styling mismatch (fix it):** the modal renders `.panel`, `.panel-title`, `.inp`, `.btn`, `.btn-dark`, `.btn-white` elements, but `bol-compose.js`'s injected CSS only defines its own `.bol-*` classes — it relies on the **host page** to provide those generic classes. Load-builder defines them in its inline `<style>`; `logistics/index.html` does not, so the dashboard popup renders unstyled (plain boxes, no cards). Fix: move those class styles into `bol-compose.js`'s injected CSS, scoped under `.bol-modal`, so the component carries its own complete styling and looks the same on every host page.

Both edits are byte-exact, each verified to appear exactly once at HEAD. Confirm `count == 1` before applying.

---

## Edit 1 — Remove the QUANTITIES panel
FIND (exactly once):
```
    body.appendChild(commPanel);

    // Quantities — editable so a BOL can be generated without a packed load.
    // Load-builder pre-fills these from the pack; the dashboard launcher leaves
    // them blank for the user to enter.
    const qtyPanel = h('div', { className: 'panel', style: { marginBottom: '14px' } });
    qtyPanel.appendChild(h('div', { className: 'panel-title' }, 'QUANTITIES'));
    const qtyRow = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' } });
    [['Pieces', 'totalPieces'], ['Stacks', 'totalStacks'], ['Weight (lb)', 'totalWeight']].forEach(([lbl, field]) => {
      const cell = h('div', {});
      cell.appendChild(h('label', { style: { display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '4px', fontWeight: 600 } }, lbl));
      const inp = h('input', { type: 'number', className: 'inp', min: '0' });
      inp.value = (td[field] === 0 || td[field]) ? td[field] : '';
      inp.addEventListener('input', e => { td[field] = e.target.value === '' ? '' : Number(e.target.value); });
      cell.appendChild(inp);
      qtyRow.appendChild(cell);
    });
    qtyPanel.appendChild(qtyRow);
    body.appendChild(qtyPanel);

    // Carry-over checkbox (pages 2+)
```
REPLACE:
```
    body.appendChild(commPanel);

    // Carry-over checkbox (pages 2+)
```

---

## Edit 2 — Make the modal self-styled (inject `.panel`/`.inp`/`.btn` scoped to `.bol-modal`)
These definitions mirror load-builder's exactly, scoped under `.bol-modal` so they only affect the modal (no global leakage) and win by specificity wherever a host page also defines the generic classes (identical values, so no visual change on load-builder). Token fallbacks are included so the modal is correct even on a host page missing a token.

FIND (exactly once):
```
  .bol-progress-list li, .bol-success-list li {
    padding: 8px 0; font-size: 14px; border-bottom: 1px solid var(--border-light);
  }
  @media (max-width: 600px) {
```
REPLACE:
```
  .bol-progress-list li, .bol-success-list li {
    padding: 8px 0; font-size: 14px; border-bottom: 1px solid var(--border-light);
  }
  .bol-modal .panel {
    background: var(--bg, #f0f2f5);
    border: 1px solid var(--border-light, var(--border, #e2e8f0));
    padding: 12px; border-radius: 12px; margin-bottom: 12px;
  }
  .bol-modal .panel-title {
    color: var(--text-faint, #94a3b8); font-size: 12px; font-weight: 800;
    margin-bottom: 8px; letter-spacing: 0.5px;
  }
  .bol-modal .inp {
    background: var(--surface, #ffffff);
    border: 1px solid var(--border, #cbd5e1);
    color: var(--text, #0f172a);
    padding: 10px 12px;
    font-family: var(--font, inherit);
    font-size: 15px;
    border-radius: var(--radius, 10px);
    width: 100%;
  }
  .bol-modal .inp:focus { outline: 2px solid var(--blue, #2563eb); outline-offset: -1px; }
  .bol-modal .btn {
    padding: 10px 16px; cursor: pointer;
    font-family: var(--font, inherit); font-size: 14px; font-weight: 700;
    border-radius: var(--radius, 10px); border: 1px solid transparent;
    transition: opacity 0.15s, transform 0.1s; white-space: nowrap;
  }
  .bol-modal .btn:hover { opacity: 0.88; }
  .bol-modal .btn:active { transform: scale(0.97); }
  .bol-modal .btn-dark { background: var(--text, #0f172a); color: var(--bg, #ffffff); border-color: var(--text, #0f172a); }
  .bol-modal .btn-white { background: var(--surface, #ffffff); color: var(--text-mid, #475569); border-color: var(--border, #cbd5e1); }
  @media (max-width: 600px) {
```

---

## Step 3 — Validation
`logistics/bol-compose.js` is standalone `.js`: run `node --check logistics/bol-compose.js`. Confirm clean.

## Step 4 — Manual sanity (notes for Steve)
- Open the BOL popup from the **logistics dashboard** ("BOL Generator") and from **load-builder** ("Generate BOL"): they now look identical — grey commodity card, styled inputs, dark/white buttons.
- No QUANTITIES panel in either.
- Load-builder BOL output is unchanged (totals still come from the pack); dashboard/manual BOLs simply omit piece/stack/weight entry.

## What NOT to change
- Do NOT touch `generateAll`, `reviewRecords`, `open`, the commodity panel, or any field logic.
- Do NOT add global (unscoped) `.panel`/`.inp`/`.btn` rules — keep them scoped to `.bol-modal`.
- Do NOT touch `bol-shared.js`, `load-builder.html`, `logistics/index.html`, the worker, or any other file.

## Deliverables summary
- `logistics/bol-compose.js` — QUANTITIES panel removed; `.bol-modal`-scoped `.panel`/`.panel-title`/`.inp`/`.btn`/`.btn-dark`/`.btn-white` added to injected CSS.
- Passes `node --check`.
