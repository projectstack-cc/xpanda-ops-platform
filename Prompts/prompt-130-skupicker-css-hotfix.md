# Prompt 130 — Hotfix: SKU picker styles never applied (dead `.load-builder-app` scope + class collision)

Read `AGENTS.md` + `xpanda-ops-agents.md`; **logistics-agent**. Edits **only** `/logistics/load-builder.html`. No migration. Follows P129.

## Bug
The P129 picker CSS was written as `.load-builder-app .sku-…`, but **no element in the page has the class `load-builder-app`** (it only ever appears inside CSS selectors). So every picker rule was dead — the category rail rendered as unstyled stacked text and there was no sidebar. The card grid still showed only because a *pre-existing, unscoped* `.sku-grid` (line ~149, `minmax(255px,1fr)`) and `.sku-card` (line ~156) happened to catch the same class names.

## Fix
Make the picker rules **unscoped** (matching the working pattern of `.sku-row` / `.sku-category-header`) and rename the picker classes to a unique `skp-` prefix so they don't collide with the pre-existing `.sku-grid` / `.sku-card`. Two whole-block swaps — one CSS, one JS. **Do not touch** the pre-existing `.sku-grid` (line ~149) or `.sku-card` (line ~156); those belong to other views.

---

## Edit 1 — CSS block

FIND:
```css
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
REPLACE:
```css
  /* Master-detail SKU picker (Load tab) */
  .skp-md { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 22px; }
  .skp-rail { flex: 0 0 172px; display: flex; flex-direction: column; gap: 2px; }
  .skp-rail-item { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 8px 10px; border-radius: var(--radius); border: 1px solid transparent; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--text-mid); user-select: none; }
  .skp-rail-item:hover { background: var(--bg); }
  .skp-rail-item.active { background: var(--surface); border-color: var(--border-light); font-weight: 800; }
  .skp-rail-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .skp-rail-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .skp-rail-count { color: var(--text-ghost); font-size: 12px; font-weight: 700; }
  .skp-rail-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
  .skp-detail { flex: 1; min-width: 0; }
  .skp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(184px, 1fr)); gap: 10px; }
  .skp-card { border: 1px solid var(--border-light); border-left: 3px solid transparent; background: var(--surface); padding: 10px 12px; display: flex; flex-direction: column; gap: 7px; min-width: 0; transition: background 0.1s; }
  .skp-card-top { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .skp-card-code { font-family: var(--mono); font-size: 12px; color: var(--text-faint); font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .skp-card-name { font-weight: 700; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .skp-card-meta { font-family: var(--mono); font-size: 12px; color: var(--text-ghost); }
  .skp-card-foot { margin-top: 2px; }
  .skp-card .skp-actions { display: flex; align-items: center; gap: 5px; }
  .skp-subgroup-label { grid-column: 1 / -1; font-size: 12px; font-weight: 800; color: var(--text-muted); padding: 8px 2px 2px; border-bottom: 1px solid var(--border-light); margin-top: 4px; }
  .skp-empty { color: var(--text-faint); font-size: 14px; padding: 24px 4px; }
  @media (max-width: 700px) {
    .skp-md { flex-direction: column; }
    .skp-rail { flex: none; flex-direction: row; flex-wrap: wrap; }
  }
```

## Edit 2 — JS render block (rename classNames to `skp-`)

FIND:
```javascript
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
    card.appendChild(h('div', { className: 'sku-card-meta' }, `${s.length}×${s.width}×${s.height}" · ${perStack}/stack`));
    const foot = h('div', { className: 'sku-card-foot' });
    if (inCart) {
      const actions = h('div', { className: 'sku-actions' });
      actions.appendChild(h('button', { className: 'btn btn-white', style: { padding: '4px 9px', fontSize: '15px', fontWeight: 800 }, onClick: () => { state.cart = state.cart.map(x => x.skuId === s.id ? { ...x, qty: Math.max(0, x.qty - 1) } : x).filter(x => x.qty > 0); render(); } }, '−'));
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
  detail.appendChild(h('input', { className: 'inp', value: state.search, placeholder: 'Search all SKUs…', style: { width: '100%', marginBottom: '12px' }, onInput: e => { state.search = e.target.value; render(); } }));

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
REPLACE:
```javascript
  const isSearching = !!state.search.trim();
  const { groups: mdGroups, catKeys: mdCatKeys } = groupByCategory(sorted);
  const activeCat = (state.activeCategory === 'All' || mdCatKeys.includes(state.activeCategory)) ? state.activeCategory : 'All';

  const buildSkuCard = (s) => {
    const inCart = state.cart.find(c => c.skuId === s.id);
    const perStack = Math.floor(dims.height / s.height);
    const card = h('div', { className: 'skp-card' + (inCart ? ' in-cart' : ''), style: { borderLeftColor: inCart ? s.color : 'transparent', background: inCart ? s.color + '14' : '' } });
    const top = h('div', { className: 'skp-card-top' });
    top.appendChild(h('div', { style: { width: '11px', height: '11px', background: s.color, borderRadius: '50%', flexShrink: '0' } }));
    top.appendChild(h('div', { className: 'skp-card-code' }, s.sku));
    card.appendChild(top);
    card.appendChild(h('div', { className: 'skp-card-name', title: s.name }, s.name));
    card.appendChild(h('div', { className: 'skp-card-meta' }, `${s.length}×${s.width}×${s.height}" · ${perStack}/stack`));
    const foot = h('div', { className: 'skp-card-foot' });
    if (inCart) {
      const actions = h('div', { className: 'skp-actions' });
      actions.appendChild(h('button', { className: 'btn btn-white', style: { padding: '4px 9px', fontSize: '15px', fontWeight: 800 }, onClick: () => { state.cart = state.cart.map(x => x.skuId === s.id ? { ...x, qty: Math.max(0, x.qty - 1) } : x).filter(x => x.qty > 0); render(); } }, '−'));
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

  const md = h('div', { className: 'skp-md' });

  // Category rail (master)
  const rail = h('div', { className: 'skp-rail' });
  const inCartCount = (list) => list.reduce((n, s) => n + (state.cart.some(c => c.skuId === s.id) ? 1 : 0), 0);
  const mkRailItem = (key, label, list) => {
    const active = activeCat === key;
    const item = h('div', { className: 'skp-rail-item' + (active ? ' active' : ''), onClick: () => { state.activeCategory = key; render(); } });
    item.appendChild(h('span', { className: 'skp-rail-label' }, label));
    const right = h('span', { className: 'skp-rail-right' });
    right.appendChild(h('span', { className: 'skp-rail-count' }, String(list.length)));
    const picked = inCartCount(list);
    if (picked) right.appendChild(h('span', { className: 'skp-rail-dot', title: `${picked} in load` }));
    item.appendChild(right);
    return item;
  };
  rail.appendChild(mkRailItem('All', 'All SKUs', sorted));
  mdCatKeys.forEach(cat => rail.appendChild(mkRailItem(cat, cat, mdGroups[cat])));
  md.appendChild(rail);

  // Detail pane (search + card grid)
  const detail = h('div', { className: 'skp-detail' });
  detail.appendChild(h('input', { className: 'inp', value: state.search, placeholder: 'Search all SKUs…', style: { width: '100%', marginBottom: '12px' }, onInput: e => { state.search = e.target.value; render(); } }));

  const grid = h('div', { className: 'skp-grid' });
  if (isSearching) {
    if (!filtered.length) detail.appendChild(h('div', { className: 'skp-empty' }, 'No SKUs match your search.'));
    else filtered.forEach(s => grid.appendChild(buildSkuCard(s)));
  } else {
    const catSkus = activeCat === 'All' ? sorted : (mdGroups[activeCat] || []);
    if (!catSkus.length) {
      detail.appendChild(h('div', { className: 'skp-empty' }, 'No SKUs in this category.'));
    } else {
      catSkus.filter(s => !(s.parent_group || '')).forEach(s => grid.appendChild(buildSkuCard(s)));
      const parentMap = new Map();
      catSkus.filter(s => s.parent_group || '').forEach(s => { if (!parentMap.has(s.parent_group)) parentMap.set(s.parent_group, []); parentMap.get(s.parent_group).push(s); });
      parentMap.forEach((groupSkus, pgName) => {
        grid.appendChild(h('div', { className: 'skp-subgroup-label' }, pgName));
        [...groupSkus].sort((a, b) => a.height - b.height).forEach(s => grid.appendChild(buildSkuCard(s)));
      });
    }
  }
  detail.appendChild(grid);
  md.appendChild(detail);
  cont.appendChild(md);
```

## Verify
- The Load tab shows a left **category sidebar** (All SKUs + each category, count + accent dot when that category has items in the load) beside a **card grid** — i.e. it now matches the approved mockup, not a stacked text list.
- Clicking a category filters the grid; active item highlighted. Add / +/− / qty edits update the LOAD LIST and counter; in-cart cards show the colored left border + tint.
- Search filters across categories; `parent_group` SKUs appear under a labeled subheader.
- The SKUS (library) tab is unchanged — confirm its grid/cards still look right (proves the pre-existing `.sku-grid`/`.sku-card` weren't disturbed).
- Narrow width: sidebar wraps above the grid.

## Deploy
```
git add logistics/load-builder.html
git commit -m "P130: hotfix — SKU picker CSS was dead (.load-builder-app scope doesn't exist) + collided with pre-existing .sku-grid/.sku-card; unscope + rename to skp-*"
git push
```
