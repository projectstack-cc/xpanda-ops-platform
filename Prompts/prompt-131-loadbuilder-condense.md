# Prompt 131 — Load Builder: condense the Load tab (bounded grid + sticky action bar + Advanced disclosure)

Read `AGENTS.md` + `xpanda-ops-agents.md`; **logistics-agent**. Edits **only** `/logistics/load-builder.html`. No migration. Follows P130.

## Goal
Stop the page from growing into a long scroll. Three changes, layout only — cart logic and the auto-pack engine are untouched:
1. The SKU card grid scrolls **inside a fixed-height frame** (`max-height: 46vh`), so the page is the same height whether a category has 5 SKUs or 120.
2. The **LOAD LIST + Calculate** card becomes a **sticky bottom bar** (always visible while picking).
3. **Force Trailer Sizes** moves behind a collapsed **"Advanced"** disclosure (rarely used; reclaims top space).

## DO NOT TOUCH
The auto-pack engine, `STORAGE_KEY` (`foam_trailer_loader_v31`), the trailer-type / runners / auto-downsize controls, the cart contents/handlers, `renderSkusTab`, `bol-compose.js`. New state field `state.showAdvanced` needs no initializer (falsy = collapsed).

---

### Edit 1 — CSS: bound the grid; add action-bar + toggle styles
FIND:
```css
  .skp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(184px, 1fr)); gap: 10px; }
```
REPLACE:
```css
  .skp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(184px, 1fr)); gap: 10px; align-content: start; max-height: 46vh; overflow-y: auto; border: 1px solid var(--border-light); border-radius: var(--radius); padding: 10px; }
  .skp-adv-toggle { margin-bottom: 18px; }
  .skp-actionbar { position: sticky; bottom: 12px; z-index: 20; box-shadow: 0 -2px 16px rgba(15,23,42,0.10); }
```

### Edit 2 — JS: open the Advanced disclosure around Force Trailer Sizes
FIND:
```javascript
  // Forced trailer sizes panel
  const forcedCard = h('div', { className: 'card mb-18' });
```
REPLACE:
```javascript
  // Advanced — Force Trailer Sizes (collapsed by default to keep the page short)
  const advToggle = h('button', { className: 'btn btn-white skp-adv-toggle', onClick: () => { state.showAdvanced = !state.showAdvanced; render(); } }, (state.showAdvanced ? '▾ ' : '▸ ') + 'ADVANCED · FORCE TRAILER SIZES');
  cont.appendChild(advToggle);
  if (state.showAdvanced) {
  const forcedCard = h('div', { className: 'card mb-18' });
```

### Edit 3 — JS: close the Advanced disclosure
FIND:
```javascript
  cont.appendChild(forcedCard);
```
REPLACE:
```javascript
  cont.appendChild(forcedCard);
  }
```

### Edit 4 — JS: make the LOAD LIST / Calculate card sticky
FIND:
```javascript
    const cartCard = h('div', { className: 'card' });
```
REPLACE:
```javascript
    const cartCard = h('div', { className: 'card skp-actionbar' });
```

---

## Verify
- A tall category (e.g. Holey Board) no longer stretches the page — its cards scroll inside the bordered grid frame; the page stays short.
- The LOAD LIST + CALCULATE bar stays pinned at the bottom of the viewport while you scroll/pick; CALCULATE and RECALCULATE DIFFERENT still work.
- "ADVANCED · FORCE TRAILER SIZES" shows collapsed by default; clicking it reveals the force-sizes panel (toggle ▸/▾); the OFF/ON + per-trailer rows behave exactly as before when expanded.
- Add / +/− / qty edits, search, category rail, dark/light themes — all unchanged.
- Tablet/narrow width: grid still scrolls internally; sticky bar still visible.

## Note (no action needed)
If `Force Trailer Sizes` is ON and you then collapse Advanced, the forced behavior still applies though hidden — expand Advanced to see/disable it. Acceptable for now; flag if you want the toggle label to indicate an active forced state.

## Deploy
```
git add logistics/load-builder.html
git commit -m "P131: condense Load tab — fixed-height scrolling SKU grid, sticky LOAD LIST/Calculate bar, Force Trailer Sizes behind Advanced disclosure"
git push
```
