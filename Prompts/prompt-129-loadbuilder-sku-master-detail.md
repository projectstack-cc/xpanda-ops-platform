# Prompt 129 — Load Builder: master-detail SKU picker (Load tab)
## What
Replace the Load tab's long vertical SKU list with a master-detail picker: a category rail (master) + a responsive SKU card grid (detail) with the existing quantity steppers. Same cart, same Calculate flow, same trailer config above and LOAD LIST below. The separate +SKU / library window is untouched.

## Agent setup
Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. Assume the **logistics-agent**. No migration, no `_worker.js` change, no API change.

## DO NOT TOUCH
The auto-pack engine (`buildDemand`, `calcLoading`, `buildColumn`, etc.), `STORAGE_KEY` (`foam_trailer_loader_v31`), `renderSkusTab` (the library/CRUD view), the trailer-type / runners / auto-downsize / force-trailer cards, the LOAD LIST cart summary + CALCULATE buttons, and `bol-compose.js`. This prompt only swaps the SKU **list** section inside `renderLoadTab` and adds CSS.

## Notes
- Reuses `state.cart`, `state.search`, `getDims`, `getSortedSkus`, `getFiltered`, `groupByCategory` exactly as-is. The qty +/−/input handlers are the same ones from the old rows, now on cards.
- New state field `state.activeCategory` — no initializer needed; when unset it falls back to `'All'`.
- Category collapse (`state.collapsedCategories` / `state.collapsedParentGroups`) is no longer used on the Load tab (the rail replaces it); both remain used/defined elsewhere, so leave them.
- `parent_group` SKUs render as a labeled cluster within the active category (a full-width subheader + their cards), sorted by height. Search matches across all categories.

---

## Deliverable 1 — `/logistics/load-builder.html`: swap the SKU list section in `renderLoadTab`

FIND (the search input + the entire categorized-list block):
```javascript
  // Search
  const searchInp = h('input', { className: 'inp', value: state.search, placeholder: 'Search SKUs…', style: { width: '360px', maxWidth: '100%', marginBottom: '14px' }, onInput: e => { state.search = e.target.value; render(); } });
  cont.appendChild(searchInp);

  // SKU categorized list
  const isSearching = !!state.search.trim();
  const { groups: skuGroups, catKeys } = groupByCategory(filtered);
  const allGroupKeys = groupByCategory(sorted).catKeys;
  const allCollapsed = allGroupKeys.length > 0 && allGroupKeys.every(c => !!state.collapsedCategories[c]);

  const listHeader = h('div', { className: 'flex justify-between items-center', style: { marginBottom: '8px' } });
  listHeader.appendChild(h('div'));
  listHeader.appendChild(h('button', { className: 'btn btn-white', style: { fontSize: '12px', padding: '5px 12px' }, onClick: () => {
    if (allCollapsed) { state.collapsedCategories = {}; }
    else { const nc = {}; allGroupKeys.forEach(c => nc[c] = true); state.collapsedCategories = nc; }
    render();
  }}, allCollapsed ? 'EXPAND ALL' : 'COLLAPSE ALL'));
  cont.appendChild(listHeader);

  const listWrap = h('div', { style: { marginBottom: '22px' } });
  catKeys.forEach(cat => {
    const catSkus = skuGroups[cat];
    if (!catSkus || !catSkus.length) return;
    const isCollapsed = !isSearching && !!state.collapsedCategories[cat];
    const catHdr = h('div', { className: 'sku-category-header', onClick: () => { if (!isSearching) { state.collapsedCategories[cat] = !state.collapsedCategories[cat]; render(); } }});
    catHdr.appendChild(h('span', {}, isCollapsed ? '▶' : '▼'));
    catHdr.appendChild(h('span', {}, cat));
    catHdr.appendChild(h('span', { style: { color: 'var(--text-ghost)', fontWeight: 600, fontSize: '12px' } }, `(${catSkus.length})`));
    listWrap.appendChild(catHdr);
    if (!isCollapsed) {
      const catBody = h('div', { className: 'sku-category-body' });

      const buildSkuRow = (s, extraStyle) => {
        const inCart = state.cart.find(c => c.skuId === s.id);
        const perStack = Math.floor(dims.height / s.height);
        const rowStyle = { ...(extraStyle || {}), borderLeft: inCart ? `3px solid ${s.color}` : '3px solid transparent' };
        if (inCart) rowStyle.background = s.color + '12';
        const row = h('div', { className: 'sku-row', style: rowStyle });
        row.appendChild(h('div', { style: { width: '12px', height: '12px', background: s.color, borderRadius: '50%', flexShrink: '0' } }));
        row.appendChild(h('div', { style: { fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-faint)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.sku));
        row.appendChild(h('div', { style: { fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.name));
        row.appendChild(h('div', { className: 'sku-dim', style: { color: 'var(--text-ghost)', fontSize: '13px', whiteSpace: 'nowrap' } }, `${s.length}×${s.width}×${s.height}"`));
        row.appendChild(h('div', { className: 'sku-stack', style: { color: 'var(--text-ghost)', fontSize: '13px', whiteSpace: 'nowrap' } }, `${perStack}/stack`));
        const actions = h('div', { className: 'sku-actions' });
        if (inCart) {
          actions.appendChild(h('button', { className: 'btn btn-white', style: { padding: '4px 9px', fontSize: '15px', fontWeight: 800 }, onClick: () => { state.cart = state.cart.map(x => x.skuId === s.id ? { ...x, qty: Math.max(0, x.qty - 1) } : x).filter(x => x.qty > 0); render(); } }, '−'));
          const qtyInp = h('input', { type: 'number', min: '1', value: String(inCart.qty), className: 'qty-input-sm', style: { borderColor: s.color }, onChange: e => {
            const v = e.target.value;
            if (v === '' || v === '0') { state.cart = state.cart.filter(x => x.skuId !== s.id); }
            else { const n = parseInt(v, 10); if (!isNaN(n) && n >= 1) state.cart = state.cart.map(x => x.skuId === s.id ? { ...x, qty: n } : x); }
            render();
          }});
          actions.appendChild(qtyInp);
          actions.appendChild(h('button', { className: 'btn btn-white', style: { padding: '4px 9px', fontSize: '15px', fontWeight: 800 }, onClick: () => { const f = state.cart.find(x => x.skuId === s.id); if (f) f.qty++; else state.cart.push({ skuId: s.id, qty: 1 }); render(); } }, '+'));
        } else {
          actions.appendChild(h('button', { className: 'btn btn-white', style: { padding: '4px 12px', fontSize: '13px' }, onClick: () => { state.cart.push({ skuId: s.id, qty: 1 }); render(); } }, '+'));
        }
        row.appendChild(actions);
        return row;
      };

      const ungrouped = catSkus.filter(s => !(s.parent_group || ''));
      const parentMap = new Map();
      catSkus.filter(s => s.parent_group || '').forEach(s => {
        if (!parentMap.has(s.parent_group)) parentMap.set(s.parent_group, []);
        parentMap.get(s.parent_group).push(s);
      });

      ungrouped.forEach(s => catBody.appendChild(buildSkuRow(s)));

      parentMap.forEach((groupSkus, pgName) => {
        if (isSearching) {
          groupSkus.forEach(s => catBody.appendChild(buildSkuRow(s)));
          return;
        }
        const pgKey = cat + '::' + pgName;
        const isPgCollapsed = state.collapsedParentGroups[pgKey] !== false;
        const sortedGroup = [...groupSkus].sort((a, b) => a.height - b.height);
        const parentSku = sortedGroup[0];
        const children = sortedGroup.slice(1);

        const chevron = h('button', {
          className: 'btn-chevron',
          style: { width: '20px', flexShrink: '0' },
          onClick: e => {
            e.stopPropagation();
            state.collapsedParentGroups[pgKey] = (state.collapsedParentGroups[pgKey] === false) ? true : false;
            render();
          }
        }, isPgCollapsed ? '▶' : '▼');
        const parentRow = buildSkuRow(parentSku);
        parentRow.style.display = 'flex';
        parentRow.style.flexWrap = 'nowrap';
        parentRow.style.alignItems = 'center';
        const actionsEl = parentRow.querySelector('.sku-actions');
        if (actionsEl) { actionsEl.style.flexShrink = '0'; actionsEl.style.marginLeft = 'auto'; }
        const qtyInputEl = parentRow.querySelector('.qty-input-sm');
        if (qtyInputEl) qtyInputEl.style.width = '54px';
        parentRow.insertBefore(chevron, parentRow.firstChild);
        catBody.appendChild(parentRow);

        if (!isPgCollapsed) {
          children.forEach(s => catBody.appendChild(buildSkuRow(s, { paddingLeft: '24px' })));
        }
      });

      listWrap.appendChild(catBody);
    }
  });
  cont.appendChild(listWrap);
```
REPLACE:
```javascript
  // Master-detail SKU picker (rail + card grid). Reuses state.cart / state.search.
  const isSearching = !!state.search.trim();
  const { groups: mdGroups, catKeys: mdCatKeys } = groupByCategory(sorted);
  const activeCat = (state.activeCategory === 'All' || mdCatKeys.includes(state.activeCategory)) ? state.activeCategory : 'All';

  const buildSkuCard = (s) => {
    const inCart = state.cart.find(c => c.skuId === s.id);
    const perStack = Math.floor(dims.height / s.height);
    const card = h('div', { className: 'sku-card' + (inCart ? ' in-cart' : ''), style: { borderLeftColor: inCart ? s.color : 'transparent', background: inCart ? s.color + '14' : '' } });
    const top = h('div', { className: 'sku-card-top' });
    top.appendChild(h('div', { style: { width: '11px', height: '11px', background: s.color, borderRadius: '50%', flexShrink: '0' } }));
    top.appendChild(h('div', { className: 'sku-card-code' }, s.sku));
    card.appendChild(top);
    card.appendChild(h('div', { className: 'sku-card-name', title: s.name }, s.name));
    card.appendChild(h('div', { className: 'sku-card-meta' }, `${s.length}\u00d7${s.width}\u00d7${s.height}" \u00b7 ${perStack}/stack`));
    const foot = h('div', { className: 'sku-card-foot' });
    if (inCart) {
      const actions = h('div', { className: 'sku-actions' });
      actions.appendChild(h('button', { className: 'btn btn-white', style: { padding: '4px 9px', fontSize: '15px', fontWeight: 800 }, onClick: () => { state.cart = state.cart.map(x => x.skuId === s.id ? { ...x, qty: Math.max(0, x.qty - 1) } : x).filter(x => x.qty > 0); render(); } }, '\u2212'));
      const qtyInp = h('input', { type: 'number', min: '1', value: String(inCart.qty), className: 'qty-input-sm', style: { borderColor: s.color }, onChange: e => {
        const v = e.target.value;
        if (v === '' || v === '0') { state.cart = state.cart.filter(x => x.skuId !== s.id); }
        else { const n = parseInt(v, 10); if (!isNaN(n) && n >= 1) state.cart = state.cart.map(x => x.skuId === s.id ? { ...x, qty: n } : x); }
        render();
      }});
      actions.appendChild(qtyInp);
      actions.appendChild(h('button', { className: 'btn btn-white', style: { padding: '4px 9px', fontSize: '15px', fontWeight: 800 }, onClick: () => { const f = state.cart.find(x => x.skuId === s.id); if (f) f.qty++; else state.cart.push({ skuId: s.id, qty: 1 }); render(); } }, '+'));
      foot.appendChild(actions);
    } else {
      foot.appendChild(h('button', { className: 'btn btn-white', style: { padding: '5px 14px', fontSize: '13px' }, onClick: () => { state.cart.push({ skuId: s.id, qty: 1 }); render(); } }, '+ ADD'));
    }
    card.appendChild(foot);
    return card;
  };

  const md = h('div', { className: 'sku-md' });

  // Category rail (master)
  const rail = h('div', { className: 'sku-rail' });
  const inCartCount = (list) => list.reduce((n, s) => n + (state.cart.some(c => c.skuId === s.id) ? 1 : 0), 0);
  const mkRailItem = (key, label, list) => {
    const active = activeCat === key;
    const item = h('div', { className: 'sku-rail-item' + (active ? ' active' : ''), onClick: () => { state.activeCategory = key; render(); } });
    item.appendChild(h('span', { className: 'sku-rail-label' }, label));
    const right = h('span', { className: 'sku-rail-right' });
    right.appendChild(h('span', { className: 'sku-rail-count' }, String(list.length)));
    const picked = inCartCount(list);
    if (picked) right.appendChild(h('span', { className: 'sku-rail-dot', title: `${picked} in load` }));
    item.appendChild(right);
    return item;
  };
  rail.appendChild(mkRailItem('All', 'All SKUs', sorted));
  mdCatKeys.forEach(cat => rail.appendChild(mkRailItem(cat, cat, mdGroups[cat])));
  md.appendChild(rail);

  // Detail pane (search + card grid)
  const detail = h('div', { className: 'sku-detail' });
  detail.appendChild(h('input', { className: 'inp', value: state.search, placeholder: 'Search all SKUs\u2026', style: { width: '100%', marginBottom: '12px' }, onInput: e => { state.search = e.target.value; render(); } }));

  const grid = h('div', { className: 'sku-grid' });
  if (isSearching) {
    if (!filtered.length) detail.appendChild(h('div', { className: 'sku-empty' }, 'No SKUs match your search.'));
    else filtered.forEach(s => grid.appendChild(buildSkuCard(s)));
  } else {
    const catSkus = activeCat === 'All' ? sorted : (mdGroups[activeCat] || []);
    if (!catSkus.length) {
      detail.appendChild(h('div', { className: 'sku-empty' }, 'No SKUs in this category.'));
    } else {
      catSkus.filter(s => !(s.parent_group || '')).forEach(s => grid.appendChild(buildSkuCard(s)));
      const parentMap = new Map();
      catSkus.filter(s => s.parent_group || '').forEach(s => { if (!parentMap.has(s.parent_group)) parentMap.set(s.parent_group, []); parentMap.get(s.parent_group).push(s); });
      parentMap.forEach((groupSkus, pgName) => {
        grid.appendChild(h('div', { className: 'sku-subgroup-label' }, pgName));
        [...groupSkus].sort((a, b) => a.height - b.height).forEach(s => grid.appendChild(buildSkuCard(s)));
      });
    }
  }
  detail.appendChild(grid);
  md.appendChild(detail);
  cont.appendChild(md);
```

## Deliverable 2 — `/logistics/load-builder.html`: add the picker CSS

FIND (the existing SKU `@media (max-width: 600px)` block):
```css
  @media (max-width: 600px) {
    .sku-row { grid-template-columns: 16px 60px 1fr 110px; }
    .sku-row .sku-dim, .sku-row .sku-stack { display: none; }
    .sku-row-manage { grid-template-columns: 16px 60px 1fr auto; }
    .sku-row-manage .sku-dim, .sku-row-manage .sku-cat-tag { display: none; }
  }
```
REPLACE (same block, followed by the new picker styles):
```css
  @media (max-width: 600px) {
    .sku-row { grid-template-columns: 16px 60px 1fr 110px; }
    .sku-row .sku-dim, .sku-row .sku-stack { display: none; }
    .sku-row-manage { grid-template-columns: 16px 60px 1fr auto; }
    .sku-row-manage .sku-dim, .sku-row-manage .sku-cat-tag { display: none; }
  }

  /* Master-detail SKU picker (Load tab) */
  .load-builder-app .sku-md { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 22px; }
  .load-builder-app .sku-rail { flex: 0 0 172px; display: flex; flex-direction: column; gap: 2px; }
  .load-builder-app .sku-rail-item { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 8px 10px; border-radius: var(--radius); border: 1px solid transparent; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--text-mid); user-select: none; }
  .load-builder-app .sku-rail-item:hover { background: var(--bg); }
  .load-builder-app .sku-rail-item.active { background: var(--surface); border-color: var(--border-light); font-weight: 800; }
  .load-builder-app .sku-rail-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .load-builder-app .sku-rail-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .load-builder-app .sku-rail-count { color: var(--text-ghost); font-size: 12px; font-weight: 700; }
  .load-builder-app .sku-rail-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
  .load-builder-app .sku-detail { flex: 1; min-width: 0; }
  .load-builder-app .sku-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(184px, 1fr)); gap: 10px; }
  .load-builder-app .sku-card { border: 1px solid var(--border-light); border-left: 3px solid transparent; background: var(--surface); padding: 10px 12px; display: flex; flex-direction: column; gap: 7px; min-width: 0; transition: background 0.1s; }
  .load-builder-app .sku-card-top { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .load-builder-app .sku-card-code { font-family: var(--mono); font-size: 12px; color: var(--text-faint); font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .load-builder-app .sku-card-name { font-weight: 700; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .load-builder-app .sku-card-meta { font-family: var(--mono); font-size: 12px; color: var(--text-ghost); }
  .load-builder-app .sku-card-foot { margin-top: 2px; }
  .load-builder-app .sku-card .sku-actions { display: flex; align-items: center; gap: 5px; }
  .load-builder-app .sku-subgroup-label { grid-column: 1 / -1; font-size: 12px; font-weight: 800; color: var(--text-muted); padding: 8px 2px 2px; border-bottom: 1px solid var(--border-light); margin-top: 4px; }
  .load-builder-app .sku-empty { color: var(--text-faint); font-size: 14px; padding: 24px 4px; }
  @media (max-width: 700px) {
    .load-builder-app .sku-md { flex-direction: column; }
    .load-builder-app .sku-rail { flex: none; flex-direction: row; flex-wrap: wrap; }
  }
```

## Verify
- Inline JS parses (no console errors on load); SKUs populate, Calculate Load still works (regression guard from P128).
- Load tab shows the category rail (All SKUs + each category, with counts and an accent dot when that category has items in the load) and a card grid on the right.
- Clicking a category filters the grid; the active item is highlighted.
- Add / +/− / typing a qty on a card updates the LOAD LIST and the LOAD tab counter exactly as before; in-cart cards show the colored left border + tint.
- Search filters across all categories; clearing search returns to the selected category.
- `parent_group` SKUs appear under a labeled subheader within their category.
- Narrow width (tablet portrait): rail wraps above the grid; grid reflows to fewer columns.
- Dark and light themes both render correctly.

## Deploy
```
git add logistics/load-builder.html
git commit -m "P129: Load Builder SKU picker — master-detail (category rail + card grid) replaces the long list; reuses cart + auto-pack untouched"
git push
```
