# Prompt 122 — BOL inline editor: free-drag all fields + delivery-time multi-line

## Agent setup (read first)
Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. Assume the **logistics-agent** (BOL generation, `bol-shared.js` single-source coordinate engine, load builder). No db-api-agent involvement: **no migration, no `_worker.js` change.** Positions ride inside the existing `render_overrides` JSON blob and round-trip through the unchanged worker and both consumers (`bol-generator.html`, `load-builder.html`).

## Scope (exactly this — nothing else)
Two changes to the inline BOL editor, both touching **only** `logistics/bol-editor.js` and `logistics/bol-shared.js`:

1. **Free-drag every field.** Each editable field gets a small drag handle. Dragging records a `{dx, dy}` delta **in PDF points** (scale-independent) under a reserved `_pos` sub-key inside `bol._overrides`. `bol-shared.js` applies that offset at every draw site. Double-clicking a field's handle resets that field to its default coordinate. All fields participate: delivery-time, date, BOL #, carrier, trailer #, ship-to block (moves as one unit), special instructions, contact, PO, commodity, and the scrap Yes/No toggle.
2. **Delivery-time multi-line (editor-override only).** Flip `deliveryTime` from `single` to `multiline` in the editor so it becomes a textarea; render the override as wrapped, **bold red** multi-line text. The BOL generator form field and the `delivery_time` DB column stay single-line and unchanged — multi-line exists only as an editor override.

## DO NOT TOUCH
- The value-override model (`overrideKey` → string / line-array / bool). `_pos` is purely additive and never collides with it.
- `drawText` / `drawMultiline` helper internals, `wrapText`, `pickCommodityTier`, the QR-code block (QR is **not** draggable), `buildShipToLines`, `confirmNoBolNumber`.
- `_worker.js`, any `.sql`, the load builder auto-pack algorithm, `STORAGE_KEY`.
- `load-builder.html` / `bol-generator.html` — they already round-trip `bol._overrides` verbatim; **make no edits there.**

## Backward compatibility
Legacy BOLs may carry `_overrides.deliveryTime` as a **string** (from when it was `single`). Both the editor `deriveValue` and the render path below guard with `Array.isArray(...) ? join : String(...)`, so old records still render.

---

## File 1 — `logistics/bol-shared.js` (10 replacements)

### 1A — COORDS.deliveryTime: add lineH + maxW
FIND:
```
    // Delivery time — top-right, bold red
    deliveryTime:  { x: 390, y: 758, size: 24 },
```
REPLACE:
```
    // Delivery time — top-right, bold red (multiline-capable via editor override; P122)
    deliveryTime:  { x: 390, y: 758, size: 24, lineH: 28, maxW: 200 },
```

### 1B — FIELD_MAP: deliveryTime single → multiline
FIND:
```
    { key: 'deliveryTime',  type: 'single',    coord: COORDS.deliveryTime, overrideKey: 'deliveryTime' },
```
REPLACE:
```
    { key: 'deliveryTime',  type: 'multiline', coord: COORDS.deliveryTime, overrideKey: 'deliveryTime' },
```

### 1C — add `off()` position helper + multiline delivery-time render
FIND:
```
      const _ov = bol._overrides || {};

      // ── Delivery time (bold red, top right) ──
      const _deliveryTimeVal = 'deliveryTime' in _ov ? _ov.deliveryTime : bol.delivery_time;
      if (_deliveryTimeVal) {
        page.drawText(String(_deliveryTimeVal), {
          x: COORDS.deliveryTime.x, y: COORDS.deliveryTime.y,
          size: COORDS.deliveryTime.size,
          font: fontBold,
          color: rgb(1, 0, 0),
        });
      }
```
REPLACE:
```
      const _ov = bol._overrides || {};

      // ── Position overrides (P122 free-drag): per-field {dx,dy} deltas in PDF points ──
      const _pos = (_ov && _ov._pos) || {};
      const off = (key, coord) => {
        const p = _pos[key];
        if (!p) return coord;
        return { ...coord, x: coord.x + (p.dx || 0), y: coord.y + (p.dy || 0) };
      };

      // ── Delivery time (bold red, top right; multiline-capable via override — P122) ──
      const _deliveryTimeVal = ('deliveryTime' in _ov)
        ? (Array.isArray(_ov.deliveryTime) ? _ov.deliveryTime.join('\n') : _ov.deliveryTime)
        : bol.delivery_time;
      if (_deliveryTimeVal) {
        const _dc = off('deliveryTime', COORDS.deliveryTime);
        const _dLines = wrapText(String(_deliveryTimeVal), fontBold, _dc.size, _dc.maxW || 200);
        _dLines.forEach((line, i) => {
          page.drawText(line, {
            x: _dc.x,
            y: _dc.y - i * (_dc.lineH || 28),
            size: _dc.size,
            font: fontBold,
            color: rgb(1, 0, 0),
          });
        });
      }
```

### 1D — standard single fields: wrap coord in off()
FIND:
```
      drawText(_displayDate,                                                           COORDS.date);
      drawText('bolNumber' in _ov   ? _ov.bolNumber   : String(bol.bol_number || ''), COORDS.bolNumber);
      drawText('carrierName' in _ov ? _ov.carrierName : bol.carrier_name,             COORDS.carrierName);
      drawText('trailerNo' in _ov   ? _ov.trailerNo   : bol.trailer_no,               COORDS.trailerNo);
```
REPLACE:
```
      drawText(_displayDate,                                                           off('date', COORDS.date));
      drawText('bolNumber' in _ov   ? _ov.bolNumber   : String(bol.bol_number || ''), off('bolNumber', COORDS.bolNumber));
      drawText('carrierName' in _ov ? _ov.carrierName : bol.carrier_name,             off('carrierName', COORDS.carrierName));
      drawText('trailerNo' in _ov   ? _ov.trailerNo   : bol.trailer_no,               off('trailerNo', COORDS.trailerNo));
```

### 1E — ship-to block (one delta for all 4 lines)
FIND:
```
      shipLines.forEach((line, i) => { if (shipCoords[i]) drawText(line, shipCoords[i]); });
```
REPLACE:
```
      shipLines.forEach((line, i) => { if (shipCoords[i]) drawText(line, off('shipTo', shipCoords[i])); });
```

### 1F — special instructions
FIND:
```
      drawMultiline(
        Array.isArray(_ov.specialInstr) ? _ov.specialInstr.join('\n') : bol.special_instructions,
        COORDS.specialInstr);
```
REPLACE:
```
      drawMultiline(
        Array.isArray(_ov.specialInstr) ? _ov.specialInstr.join('\n') : bol.special_instructions,
        off('specialInstr', COORDS.specialInstr));
```

### 1G — contact info
FIND:
```
      if (_contactVal) drawMultiline(_contactVal, COORDS.contactInfo);
```
REPLACE:
```
      if (_contactVal) drawMultiline(_contactVal, off('contactInfo', COORDS.contactInfo));
```

### 1H — PO number
FIND:
```
      if (_poVal) drawMultiline(_poVal, COORDS.poNumber);
```
REPLACE:
```
      if (_poVal) drawMultiline(_poVal, off('poNumber', COORDS.poNumber));
```

### 1I — scrap X
FIND:
```
      drawText('X', _isScrap ? COORDS.scrapYes : COORDS.scrapNo);
```
REPLACE:
```
      drawText('X', off('scrap', _isScrap ? COORDS.scrapYes : COORDS.scrapNo));
```

### 1J — commodity
FIND:
```
        const _tier = pickCommodityTier(String(_commodityText), font);
        drawMultiline(_commodityText, { ...COORDS.commodity, size: _tier.size, lineH: _tier.lineH });
```
REPLACE:
```
        const _tier = pickCommodityTier(String(_commodityText), font);
        drawMultiline(_commodityText, off('commodity', { ...COORDS.commodity, size: _tier.size, lineH: _tier.lineH }));
```

---

## File 2 — `logistics/bol-editor.js` (8 replacements)

### 2A — deriveValue: drop deliveryTime from single colMap
FIND:
```
      const colMap = {
        deliveryTime: 'delivery_time',
        date:         'date',
```
REPLACE:
```
      const colMap = {
        date:         'date',
```

### 2B — deriveValue: multiline branch handles deliveryTime + array guard
FIND:
```
    if (field.type === 'multiline') {
      if (k in ov) return ov[k].join('\n');
      if (k === 'specialInstr') return bol.special_instructions || '';
```
REPLACE:
```
    if (field.type === 'multiline') {
      if (k in ov) return Array.isArray(ov[k]) ? ov[k].join('\n') : String(ov[k]);
      if (k === 'deliveryTime') return bol.delivery_time || '';
      if (k === 'specialInstr') return bol.special_instructions || '';
```

### 2C — seed position working state
FIND:
```
    const inputEls      = {}; // overrideKey → DOM element
    const initialValues = {}; // overrideKey → string | boolean
```
REPLACE:
```
    const inputEls      = {}; // overrideKey → DOM element
    const handleEls     = {}; // overrideKey → drag-handle element
    const initialValues = {}; // overrideKey → string | boolean

    // P122: live working copy of position overrides (PDF-point deltas), seeded from saved _pos
    const _savedPos = (bol._overrides && bol._overrides._pos) || {};
    const posOverrides = {}; // overrideKey → { dx, dy }
    for (const _k in _savedPos) {
      if (_savedPos[_k]) posOverrides[_k] = { dx: _savedPos[_k].dx || 0, dy: _savedPos[_k].dy || 0 };
    }
```

### 2D — create a drag handle per field
FIND:
```
      inputEls[k] = el;
      canvasWrap.appendChild(el);
    }
```
REPLACE:
```
      inputEls[k] = el;
      canvasWrap.appendChild(el);

      // P122: per-field drag handle (drag to move; double-click to reset position)
      const handle = document.createElement('div');
      handle.title = 'Drag to move · double-click to reset';
      handle.style.cssText = 'position:absolute;width:16px;height:16px;border-radius:4px;'
        + 'background:#1e293b;color:#fff;font-size:11px;line-height:16px;text-align:center;'
        + 'cursor:grab;z-index:5;box-shadow:0 1px 2px rgba(0,0,0,0.3);touch-action:none;user-select:none;';
      handle.textContent = '✥';
      attachDragHandle(handle, k);
      handleEls[k] = handle;
      canvasWrap.appendChild(handle);
    }
```

### 2E — attachDragHandle() + _scale tracker (inserted before reflow)
FIND:
```
    // ── Render + position ──

    let _renderTask = null;

    function reflow() {
```
REPLACE:
```
    // ── Render + position ──

    let _renderTask = null;
    let _scale = 1; // px-per-PDF-point, updated each reflow; used to convert drag deltas

    // P122: pointer-drag a field's box; commits a {dx,dy} point-delta into posOverrides
    function attachDragHandle(handle, k) {
      let startX = 0, startY = 0, baseDx = 0, baseDy = 0, dragging = false;

      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        handle.setPointerCapture(e.pointerId);
        handle.style.cursor = 'grabbing';
        startX = e.clientX;
        startY = e.clientY;
        const cur = posOverrides[k] || { dx: 0, dy: 0 };
        baseDx = cur.dx; baseDy = cur.dy;
      });

      handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const s = _scale || 1;
        // screen px → PDF points; PDF y grows upward, screen y grows downward
        const dx = baseDx + (e.clientX - startX) / s;
        const dy = baseDy - (e.clientY - startY) / s;
        posOverrides[k] = { dx: Math.round(dx), dy: Math.round(dy) };
        positionAll(_scale);
      });

      const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
        handle.style.cursor = 'grab';
        if (posOverrides[k] && posOverrides[k].dx === 0 && posOverrides[k].dy === 0) delete posOverrides[k];
      };
      handle.addEventListener('pointerup', endDrag);
      handle.addEventListener('pointercancel', endDrag);

      // double-click → reset this field to its default coord
      handle.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        delete posOverrides[k];
        positionAll(_scale);
      });
    }

    function reflow() {
```

### 2F — record scale each reflow
FIND:
```
      const s        = logicalW / BolShared.PAGE.width;
      const dpr      = window.devicePixelRatio || 1;
```
REPLACE:
```
      const s        = logicalW / BolShared.PAGE.width;
      _scale = s;
      const dpr      = window.devicePixelRatio || 1;
```

### 2G — apply offset + pin handle at end of positionAll loop
FIND:
```
        } else if (field.type === 'scrap') {
          const c = field.coords.yes;
          el.style.left     = Math.round((c.x - 35) * s) + 'px';
          el.style.top      = Math.round((H - c.y) * s - c.size * s + BASELINE_FUDGE) + 'px';
          el.style.fontSize = (c.size * s) + 'px';
          el.querySelectorAll('button').forEach(b => {
            b.style.fontSize = Math.round(c.size * s * 0.75) + 'px';
          });
        }
      }
    }
```
REPLACE:
```
        } else if (field.type === 'scrap') {
          const c = field.coords.yes;
          el.style.left     = Math.round((c.x - 35) * s) + 'px';
          el.style.top      = Math.round((H - c.y) * s - c.size * s + BASELINE_FUDGE) + 'px';
          el.style.fontSize = (c.size * s) + 'px';
          el.querySelectorAll('button').forEach(b => {
            b.style.fontSize = Math.round(c.size * s * 0.75) + 'px';
          });
        }

        // P122: apply drag offset (PDF points → px; y inverted) then pin the handle
        const _p = posOverrides[k];
        if (_p) {
          el.style.left = (parseFloat(el.style.left) + _p.dx * s) + 'px';
          el.style.top  = (parseFloat(el.style.top)  - _p.dy * s) + 'px';
        }
        const _hx = parseFloat(el.style.left);
        const _hy = parseFloat(el.style.top);
        const _handle = handleEls[k];
        if (_handle) {
          _handle.style.left = Math.max(0, _hx - 2) + 'px';
          _handle.style.top  = Math.max(0, _hy - 18) + 'px';
        }
      }
    }
```

### 2H — fold _pos into overrides on Apply
FIND:
```
      if (Object.keys(overrides).length > 0) {
        bol._overrides = overrides;
      } else {
        delete bol._overrides;
      }

      cleanup();
      onApply(bol);
```
REPLACE:
```
      // P122: attach position deltas (skip zero entries)
      const _posOut = {};
      for (const pk in posOverrides) {
        const pv = posOverrides[pk];
        if (pv && (pv.dx || pv.dy)) _posOut[pk] = { dx: pv.dx, dy: pv.dy };
      }
      if (Object.keys(_posOut).length > 0) overrides._pos = _posOut;

      if (Object.keys(overrides).length > 0) {
        bol._overrides = overrides;
      } else {
        delete bol._overrides;
      }

      cleanup();
      onApply(bol);
```

---

## Verify after editing
- `node --check logistics/bol-shared.js` and `node --check logistics/bol-editor.js` both pass.
- **BOL generator:** open a saved BOL → review → Edit. Each field shows a dark ✥ handle at its top-left. Drag delivery-time, ship-to, and the scrap toggle to new spots; Apply; the generated PDF reflects the moved positions. Reopen the saved BOL → positions persist (came back through `render_overrides`).
- **Delivery-time:** type two lines in the delivery-time box → Apply → PDF shows two bold-red lines. The BOL generator form's delivery-time input is still a single-line field (unchanged).
- **Reset:** double-click a moved field's handle → it snaps back to default; Apply with everything reset → `render_overrides` clears to null for that BOL.
- **Load builder:** Build Load → review → Edit shows the same handles; drag + multi-line behave identically (shared engine); saved load BOL persists `_pos`.
- **Regression:** a BOL with no edits renders byte-for-byte as before (no `_pos`, no offset). QR code position unchanged. A legacy BOL whose `_overrides.deliveryTime` is a plain string still renders without error.

## Deploy
Commit and push so Cloudflare Pages rebuilds. No D1 migration. No worker change.
```
git add logistics/bol-shared.js logistics/bol-editor.js
git commit -m "P122: BOL editor free-drag all fields + delivery-time multiline (override-only)"
git push
```
