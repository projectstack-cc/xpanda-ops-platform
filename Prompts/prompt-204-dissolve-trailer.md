# Prompt 204 — Load Builder: "Dissolve trailer into other trailers" (top-off consolidation)

**Read `AGENTS.md` and `xpanda-ops-agents.md` first.** You are the **Logistics Agent**. This is a
**frontend-only, single-file** change to `logistics/load-builder.html`. No worker change, no DB
migration, no new permission.

## What this feature does
Adds a per-trailer **DISSOLVE → OTHER** button on each trailer card in the Results tab. When pressed,
it tries to relocate that trailer's pieces by **topping off existing stacks on the OTHER trailers**.
A receiving column is eligible when its footprint matches (`row.rowLength === piece length` AND
`col.colWidth === piece width`), it has enough remaining headroom
(`heightCap − col.totalHeight ≥ piece height`), and the receiving trailer stays under `maxWeight`.
Any product may sit on top of any other as long as the footprint matches (this is allowed to create a
mixed stack — it is operator-approved in a preview, never algorithm-decided).

Behavior locked with Steve:
- **Top-off only.** No new stacks, no opening floor/back-of-trailer space.
- **Best-effort.** Place everything that fits; the source trailer shrinks to hold any remainder, and
  is removed only if it reaches zero pieces.
- **Preview → approve → commit.** Operator sees every proposed move and the outcome, then approves.
- Commit modifies the generated load in place, re-renders, and the existing GENERATE BOLs flow picks
  up the new trailer set automatically.

## Why it is safe (architecture)
- It does **NOT** touch the auto-pack algorithm. It only **reuses** `mergeLayers` and
  `buildTrailerStats` to recompute affected trailers — the same recompute path the existing
  **CUSTOMIZE TRAILER** feature already uses (see `state.manualRowsByTrailer[ti] = rebuiltRows;`).
- Persistence rides a new committed-result override (`state.committedTrailers`) consumed by
  `getResult()`. It is auto-invalidated whenever cart / trailer type / runner height / variant change
  (via a signature check inside `getResult`), so every existing reset path
  (`state.manualRowsByTrailer = {}`, CALCULATE, RECALCULATE, type/runner change) drops it for free with
  zero edits to those lines. An explicit **UNDO DISSOLVE** button is also added.

## DO NOT CHANGE (fences)
- `STORAGE_KEY` (`foam_trailer_loader_v31`) — its value and the SKU-library load/save path. Untouched.
- `calcLoading`, `buildColumn`, `buildRow`, `buildTrailerStats`, `mergeLayers` bodies — **read/reuse
  only, no edits.**
- The auto-pack scoring, bundle-qty, rotation, and box-truck-downsize logic.
- `posY`, `colWidth`, `rowWidthUsed`, `rowLength`, `posFromFront` on rows/columns — top-off changes
  height only, never footprint.
- `openBolModal` — it already iterates `result.trailers`; it must not be edited.

---

## Edits — all in `logistics/load-builder.html`

> Before each find/replace, run `grep -cF "<anchor>" logistics/load-builder.html` and confirm the
> count is exactly **1**. (All anchors below were verified `== 1` at authoring time.)

### Edit 1 — new state fields
**Find (exact, count 1):**
```
  currentSavedLoadId: null,
```
**Replace with:**
```
  currentSavedLoadId: null,
  committedTrailers: null,
  committedSig: null,
```

### Edit 2 — `getResult()`: committed-result short-circuit + auto-invalidation
**Find (exact, count 1 — the whole current function):**
```
function getResult() {
  const dims = getDims();
  const effectiveDims = state.runnerHeight > 0 ? { ...dims, height: dims.height - state.runnerHeight } : dims;
  const sorted = getSortedSkus();
  const autoResult = calcLoading(state.cart, sorted, effectiveDims, state.variant);
  if (!Object.keys(state.manualRowsByTrailer).length) return autoResult;
  const trailers = autoResult.trailers.map((t, i) => {
    const manualRows = state.manualRowsByTrailer[i];
    return manualRows ? buildTrailerStats(manualRows, dims) : t;
  });
  return { ...autoResult, trailers };
}
```
**Replace with:**
```
function getResult() {
  const sig = dissolveSig();
  if (state.committedTrailers) {
    if (state.committedSig === sig) return state.committedTrailers;
    state.committedTrailers = null;
    state.committedSig = null;
  }
  const dims = getDims();
  const effectiveDims = state.runnerHeight > 0 ? { ...dims, height: dims.height - state.runnerHeight } : dims;
  const sorted = getSortedSkus();
  const autoResult = calcLoading(state.cart, sorted, effectiveDims, state.variant);
  if (!Object.keys(state.manualRowsByTrailer).length) return autoResult;
  const trailers = autoResult.trailers.map((t, i) => {
    const manualRows = state.manualRowsByTrailer[i];
    return manualRows ? buildTrailerStats(manualRows, dims) : t;
  });
  return { ...autoResult, trailers };
}
```

### Edit 3 — insert the dissolve helper block immediately BEFORE `renderResultsTab`
**Find (exact, count 1):**
```
function renderResultsTab() {
```
**Replace with (the entire block below, which ends by re-declaring the same line):**
```
// ─── Dissolve trailer into other trailers (P204) ───────────────────────────────
// Top-off-only consolidation. REUSES mergeLayers + buildTrailerStats only; never
// touches calcLoading/buildColumn/buildRow. See prompt 204.
function dissolveSig() {
  return JSON.stringify({
    c: state.cart.map(x => [x.skuId, x.qty]),
    t: state.trailerType,
    r: state.runnerHeight,
    v: state.variant,
  });
}

function cloneRows(rows) {
  return (rows || []).map(r => ({
    ...r,
    columns: r.columns.map(c => ({ ...c, layers: c.layers.map(l => ({ ...l })) })),
  }));
}

// Recompute a column's height/stacks/mixed/identity/label from its layers (NOT weight).
function recomputeColumnGeom(col) {
  col.layers = mergeLayers(col.layers);
  col.totalHeight = col.layers.reduce((s, l) => s + l.unitHeight * l.count, 0);
  col.stackCount = col.layers.reduce((s, l) => s + l.count, 0);
  col.mixed = col.layers.length > 1;
  col.skuId = col.layers[0].skuId; col.skuName = col.layers[0].skuName;
  col.skuCode = col.layers[0].skuCode; col.color = col.layers[0].color;
  col.unitHeight = col.layers[0].unitHeight;
  col.label = col.layers.map(l => `${l.unitHeight}"`).join(" + ");
  return col;
}

// Pure planner: returns the proposed post-dissolve result + move list. Mutates nothing in state.
function planDissolve(result, srcTi) {
  const dims = getDims();
  const skuById = new Map(state.skus.map(s => [s.id, s]));
  const runner = state.runnerHeight > 0 ? state.runnerHeight : 0;

  // Expand the source trailer's pieces into individual placeable units.
  const src = result.trailers[srcTi];
  const units = [];
  (src.rows || []).forEach((row, ri) => row.columns.forEach((col, ci) => col.layers.forEach((layer, li) => {
    for (let n = 0; n < layer.count; n++) {
      units.push({
        ri, ci, li, length: row.rowLength, width: col.colWidth, unitHeight: layer.unitHeight,
        skuId: layer.skuId, skuName: layer.skuName, skuCode: layer.skuCode, color: layer.color,
        weight: (skuById.get(layer.skuId) || {}).weight || 0,
      });
    }
  })));

  // Mutable receiving trailers (everything except the source).
  const receivers = result.trailers.map((t, ti) => {
    if (ti === srcTi) return null;
    const tDims = t.downsizedDims || dims;
    const heightCap = (t.downsizedDims ? t.downsizedDims.height : dims.height) - runner;
    return { ti, maxWeight: tDims.maxWeight, heightCap, runWeight: t.usedWeight || 0, rows: cloneRows(t.rows) };
  });

  const moves = [];
  const placedKeys = [];
  for (const u of units) {
    let placed = false;
    for (const rec of receivers) {
      if (!rec) continue;
      for (const row of rec.rows) {
        if (row.rowLength !== u.length) continue;
        for (const col of row.columns) {
          if (col.colWidth !== u.width) continue;
          if ((rec.heightCap - col.totalHeight) < u.unitHeight) continue;
          if (rec.runWeight + u.weight > rec.maxWeight) continue;
          col.layers.push({ skuId: u.skuId, skuName: u.skuName, skuCode: u.skuCode, color: u.color, unitHeight: u.unitHeight, count: 1 });
          recomputeColumnGeom(col);
          col.totalWeight += u.weight;
          row.totalUnits += 1;
          row.totalWeight += u.weight;
          rec.runWeight += u.weight;
          moves.push({ skuCode: u.skuCode, skuName: u.skuName, unitHeight: u.unitHeight, toTrailer: rec.ti });
          placedKeys.push(`${u.ri}|${u.ci}|${u.li}`);
          placed = true; break;
        }
        if (placed) break;
      }
      if (placed) break;
    }
  }

  // Shrink the source trailer: subtract placed units, drop empties.
  const placedCounts = {};
  placedKeys.forEach(k => { placedCounts[k] = (placedCounts[k] || 0) + 1; });
  const srcRows = cloneRows(src.rows);
  srcRows.forEach((row, ri) => row.columns.forEach((col, ci) => {
    col.layers.forEach((layer, li) => { layer.count -= (placedCounts[`${ri}|${ci}|${li}`] || 0); });
    col.layers = col.layers.filter(l => l.count > 0);
  }));
  srcRows.forEach(row => {
    row.columns = row.columns.filter(c => c.layers.length);
    row.columns.forEach(col => {
      recomputeColumnGeom(col);
      col.totalWeight = col.layers.reduce((s, l) => s + ((skuById.get(l.skuId) || {}).weight || 0) * l.count, 0);
    });
    row.totalUnits = row.columns.reduce((s, c) => s + c.stackCount, 0);
    row.totalWeight = row.columns.reduce((s, c) => s + c.totalWeight, 0);
  });
  const srcRowsLeft = srcRows.filter(row => row.columns.length);

  // Assemble survivors in original order; drop the source if fully dissolved.
  const survivors = [];
  result.trailers.forEach((t, ti) => {
    if (ti === srcTi) {
      if (srcRowsLeft.length) survivors.push({ oldTi: ti, rows: srcRowsLeft, carry: t });
    } else {
      const rec = receivers.find(r => r && r.ti === ti);
      survivors.push({ oldTi: ti, rows: rec.rows, carry: t });
    }
  });

  const invMap = {};
  const oldToNew = {};
  const trailers = survivors.map((sv, newTi) => {
    const stats = buildTrailerStats(sv.rows, dims);
    if (sv.carry.downsizedType) { stats.downsizedType = sv.carry.downsizedType; stats.downsizedDims = sv.carry.downsizedDims; }
    if (sv.carry.forcedType) stats.forcedType = sv.carry.forcedType;
    invMap[newTi] = state.trailerInvNumbers[sv.oldTi] || '';
    oldToNew[sv.oldTi] = newTi;
    return stats;
  });

  // Recompute top-level totals over survivors (mirrors calcLoading's tail).
  const floorArea = dims.length * dims.width;
  const totalUnits = trailers.reduce((s, t) => s + t.totalUnits, 0);
  const totalStacks = trailers.reduce((s, t) => s + t.totalStacks, 0);
  const mixedStacks = trailers.reduce((s, t) => s + t.mixedStacks, 0);
  const totalWeight = trailers.reduce((s, t) => s + t.usedWeight, 0);
  const utilization = trailers.length ? trailers.reduce((s, t) => s + t.usedFloorArea / floorArea, 0) / trailers.length : 0;
  const warnings = [];
  trailers.forEach((t, i) => { if (t.usedWeight / dims.maxWeight > 0.95) warnings.push(`Trailer ${i + 1} is near weight limit.`); });

  const resultAfter = { trailers, warnings, totalWeight, utilization, totalUnits, totalStacks, mixedStacks };
  return { resultAfter, invMap, oldToNew, moves, placedCount: moves.length, leftoverCount: units.length - moves.length, srcDissolved: !srcRowsLeft.length, srcTi };
}

function commitDissolve(plan) {
  state.committedTrailers = plan.resultAfter;
  state.committedSig = dissolveSig();
  state.trailerInvNumbers = plan.invMap;
  state.manualRowsByTrailer = {};
  state.editorTrailer = null;
  render();
}

function openDissolvePreview(srcTi) {
  const plan = planDissolve(getResult(), srcTi);
  const backdrop = h('div', { style: { position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.5)', zIndex: '4000', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' } });
  const box = h('div', { className: 'card', style: { maxWidth: '520px', width: '100%', maxHeight: '80vh', overflowY: 'auto' } });
  box.appendChild(h('div', { style: { fontWeight: 900, fontSize: '18px', marginBottom: '10px', color: 'var(--accent)' } }, `DISSOLVE TRAILER ${srcTi + 1}`));
  const summary = plan.srcDissolved
    ? `All ${plan.placedCount} pcs relocated — Trailer ${srcTi + 1} will be removed.`
    : (plan.placedCount
        ? `${plan.placedCount} pcs relocated · ${plan.leftoverCount} pcs stay on Trailer ${srcTi + 1} (no compatible space).`
        : `No compatible space on other trailers — nothing can be moved.`);
  box.appendChild(h('div', { style: { fontSize: '14px', marginBottom: '12px', color: 'var(--text-muted)', fontWeight: 600 } }, summary));
  if (plan.moves.length) {
    const agg = {};
    plan.moves.forEach(m => { const k = `${m.skuCode}|${m.unitHeight}|${m.toTrailer}`; agg[k] = agg[k] || { ...m, n: 0 }; agg[k].n++; });
    const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '14px' } });
    Object.values(agg).forEach(m => list.appendChild(h('div', { style: { fontSize: '13px' } }, `${m.n} × ${m.unitHeight}" ${m.skuName} (${m.skuCode}) → Trailer ${(plan.oldToNew[m.toTrailer] ?? m.toTrailer) + 1}`)));
    box.appendChild(list);
  }
  const btns = h('div', { className: 'flex gap-10 justify-end' });
  btns.appendChild(h('button', { className: 'btn btn-white', onClick: () => backdrop.remove() }, 'CANCEL'));
  const approve = h('button', { className: 'btn btn-dark', onClick: () => { backdrop.remove(); commitDissolve(plan); } }, 'APPROVE & COMMIT');
  if (!plan.placedCount) approve.disabled = true;
  btns.appendChild(approve);
  box.appendChild(btns);
  backdrop.appendChild(box);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
}

function renderResultsTab() {
```

### Edit 4 — DISSOLVE button on each trailer card
**Find (exact, count 1):**
```
    tRight.appendChild(h('button', { className: 'btn btn-blue-light', onClick: () => { state.editorTrailer = state.editorTrailer === ti ? null : ti; render(); } }, state.editorTrailer === ti ? 'CLOSE CUSTOMIZE' : 'CUSTOMIZE TRAILER'));
```
**Replace with:**
```
    tRight.appendChild(h('button', { className: 'btn btn-blue-light', onClick: () => { state.editorTrailer = state.editorTrailer === ti ? null : ti; render(); } }, state.editorTrailer === ti ? 'CLOSE CUSTOMIZE' : 'CUSTOMIZE TRAILER'));
    if (result.trailers.length > 1) tRight.appendChild(h('button', { className: 'btn btn-white', onClick: () => openDissolvePreview(ti) }, 'DISSOLVE → OTHER'));
```

### Edit 5 — UNDO DISSOLVE button in the results top button row
**Find (exact, count 1):**
```
  topBtns.appendChild(h('button', { className: 'btn btn-white', onClick: () => { state.manualRowsByTrailer = {}; state.editorTrailer = null; state.variant = 0; render(); } }, 'RESET VARIANTS'));
```
**Replace with:**
```
  topBtns.appendChild(h('button', { className: 'btn btn-white', onClick: () => { state.manualRowsByTrailer = {}; state.editorTrailer = null; state.variant = 0; render(); } }, 'RESET VARIANTS'));
  if (state.committedTrailers) topBtns.appendChild(h('button', { className: 'btn btn-red-light', onClick: () => { state.committedTrailers = null; state.committedSig = null; render(); } }, 'UNDO DISSOLVE'));
```

### Edit 6 — persist committed result in `saveLoad` stateJson
**Find (exact, count 1):**
```
    manualRowsByTrailer:   state.manualRowsByTrailer,
```
**Replace with:**
```
    manualRowsByTrailer:   state.manualRowsByTrailer,
    committedTrailers:     state.committedTrailers,
    committedSig:          state.committedSig,
```

### Edit 7 — restore committed result on load
**Find (exact, count 1):**
```
          if (s.manualRowsByTrailer)  state.manualRowsByTrailer  = s.manualRowsByTrailer;
```
**Replace with:**
```
          if (s.manualRowsByTrailer)  state.manualRowsByTrailer  = s.manualRowsByTrailer;
          state.committedTrailers = s.committedTrailers || null;
          state.committedSig      = s.committedSig || null;
```

---

## Validation (run before declaring done)
1. Re-confirm each anchor matched exactly once (you grep'd before editing).
2. Extract the inline `<script>` to a real temp file and syntax-check it (do NOT pipe via
   `/dev/stdin`):
   ```bash
   python3 - <<'PY'
   import re, pathlib
   html = pathlib.Path("logistics/load-builder.html").read_text()
   blocks = re.findall(r"<script\b[^>]*>(.*?)</script>", html, re.S)
   big = max(blocks, key=len)
   pathlib.Path("/tmp/lb_check.js").write_text(big)
   print("extracted", len(big), "chars")
   PY
   node --check /tmp/lb_check.js && echo "SYNTAX OK"
   ```
3. Sanity-confirm the new symbols exist exactly once each:
   ```bash
   for s in dissolveSig planDissolve commitDissolve openDissolvePreview recomputeColumnGeom; do
     printf '%-22s ' "$s"; grep -c "function $s" logistics/load-builder.html; done
   ```

## BACKLOG / CHANGELOG (same commit)
- **CHANGELOG.md** — add to the top of the **## Logistics** section (newest-first, above the P192
  entry):
  > - **P204** — Load Builder "Dissolve trailer into other trailers": per-trailer `DISSOLVE → OTHER`
  >   button (shown when >1 trailer) tops off existing compatible stacks on the other trailers
  >   (footprint match `rowLength`+`colWidth`, any product, gated by remaining headroom and receiving
  >   `maxWeight`). Best-effort — places what fits, shrinks the source in place, removes it only when
  >   emptied. Preview modal (per-SKU move list + outcome) → APPROVE & COMMIT. Commit writes a new
  >   `state.committedTrailers` override consumed by `getResult()` and auto-invalidated by a
  >   cart/type/runner/variant signature; `UNDO DISSOLVE` button reverts; persisted in saved-load
  >   `state_json`. Reuses `mergeLayers` + `buildTrailerStats` only — auto-pack algorithm, `STORAGE_KEY`,
  >   and column/row footprints untouched. Frontend-only, `logistics/load-builder.html`.
- **BACKLOG.md** — net-new feature; nothing to remove.

## Manual steps for Steve
- None. No D1 migration, no worker deploy needed — frontend-only, ships on `main`.
