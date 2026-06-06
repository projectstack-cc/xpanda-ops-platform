window.BolEditor = (function () {
  'use strict';

  const PDF_JS_URL  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
  const WORKER_URL  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
  const BASELINE_FUDGE = 0; // px added to every input's top — nudge all fields uniformly after visual check

  let _pdfjs = null;

  async function loadPdfJs() {
    if (_pdfjs) return _pdfjs;
    const mod = await import(PDF_JS_URL);
    mod.GlobalWorkerOptions.workerSrc = WORKER_URL;
    _pdfjs = mod;
    return _pdfjs;
  }

  // ── Derive a field's current value from bol, matching generatePdf's derivation ──

  function deriveValue(bol, field) {
    const k  = field.overrideKey;
    const ov = bol._overrides || {};

    if (field.type === 'single') {
      const colMap = {
        date:         'date',
        bolNumber:    'bol_number',
        carrierName:  'carrier_name',
        trailerNo:    'trailer_no',
      };
      return k in ov ? String(ov[k]) : String(bol[colMap[k]] || '');
    }

    if (field.type === 'shipto') {
      return k in ov ? ov[k].join('\n') : BolShared.buildShipToLines(bol).join('\n');
    }

    if (field.type === 'multiline') {
      if (k in ov) return Array.isArray(ov[k]) ? ov[k].join('\n') : String(ov[k]);
      if (k === 'deliveryTime') return bol.delivery_time || '';
      if (k === 'specialInstr') return bol.special_instructions || '';
      if (k === 'contactInfo')  return bol.contact_info || [
        bol.contact_name  ? ('POC: ' + bol.contact_name) : '',
        bol.contact_phone || '',
      ].filter(Boolean).join(' ');
      if (k === 'poNumber') {
        const v = bol.po_number || bol.poNumber || '';
        return v ? 'PO: ' + v : '';
      }
      if (k === 'commodity') return bol.commodity_description || '';
    }

    if (field.type === 'scrap') {
      if (typeof ov[k] === 'boolean') return ov[k];
      return bol.is_scrap_pickup === 1 || bol.is_scrap_pickup === true || bol.is_scrap_pickup === '1';
    }

    return '';
  }

  // ── Yes/No scrap toggle ──

  function buildScrapToggle(initVal) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;display:flex;flex-direction:column;gap:2px;';
    wrap.dataset.scrapValue = String(initVal);

    function setState(val) {
      wrap.dataset.scrapValue = String(val);
      wrap.querySelectorAll('button').forEach(b => {
        const active = (b.dataset.scrapOption === 'yes') === val;
        b.style.background = active ? '#1e293b' : 'var(--card-bg,#fff)';
        b.style.color      = active ? '#fff'    : 'var(--text,#111827)';
      });
    }

    for (const [label, val] of [['Yes', true], ['No', false]]) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.dataset.scrapOption = val ? 'yes' : 'no';
      btn.style.cssText = 'padding:2px 8px;border-radius:4px;cursor:pointer;font-weight:600;border:1px solid var(--border,#d1d5db);';
      btn.style.background = (val === initVal) ? '#1e293b' : 'var(--card-bg,#fff)';
      btn.style.color      = (val === initVal) ? '#fff'    : 'var(--text,#111827)';
      btn.addEventListener('click', () => setState(val));
      wrap.appendChild(btn);
    }
    return wrap;
  }

  // ── Entry point ──

  async function open(bol, mountEl, { onApply, onCancel }) {
    mountEl.innerHTML = '';
    mountEl.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    const loadingEl = document.createElement('div');
    loadingEl.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted,#4b5563);font-size:14px;';
    loadingEl.textContent = 'Loading editor…';
    mountEl.appendChild(loadingEl);

    let pdfPage;
    try {
      const pdfjs = await loadPdfJs();
      const resp  = await fetch('/logistics/assets/BLANK_BOL_Xpanda.pdf');
      if (!resp.ok) throw new Error('BOL template not found');
      const bytes = await resp.arrayBuffer();
      const doc   = await pdfjs.getDocument({ data: bytes }).promise;
      pdfPage     = await doc.getPage(1);
    } catch (e) {
      loadingEl.textContent = 'Editor failed to load: ' + (e.message || String(e));
      return;
    }
    loadingEl.remove();

    // ── Build DOM ──

    const scrollArea = document.createElement('div');
    scrollArea.style.cssText = 'flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:12px;background:var(--bg,#f0f2f5);';
    mountEl.appendChild(scrollArea);

    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'position:relative;display:inline-block;box-shadow:0 2px 8px rgba(0,0,0,0.15);';
    scrollArea.appendChild(canvasWrap);

    const canvas = document.createElement('canvas');
    canvasWrap.appendChild(canvas);

    const actionBar = document.createElement('div');
    actionBar.style.cssText = 'flex-shrink:0;display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border,#d1d5db);background:var(--card-bg,#fff);';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:8px 20px;border-radius:8px;border:1px solid var(--border,#d1d5db);background:var(--card-bg,#fff);cursor:pointer;font-size:14px;font-weight:600;color:var(--text,#111827);';

    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply Changes';
    applyBtn.style.cssText = 'padding:8px 20px;border-radius:8px;border:none;background:#1e293b;color:#fff;cursor:pointer;font-size:14px;font-weight:600;';

    actionBar.appendChild(cancelBtn);
    actionBar.appendChild(applyBtn);
    mountEl.appendChild(actionBar);

    // ── Build input elements ──

    const inputEls      = {}; // overrideKey → DOM element
    const handleEls     = {}; // overrideKey → drag-handle element
    const initialValues = {}; // overrideKey → string | boolean

    // P122: live working copy of position overrides (PDF-point deltas), seeded from saved _pos
    const _savedPos = (bol._overrides && bol._overrides._pos) || {};
    const posOverrides = {}; // overrideKey → { dx, dy }
    for (const _k in _savedPos) {
      if (_savedPos[_k]) posOverrides[_k] = { dx: _savedPos[_k].dx || 0, dy: _savedPos[_k].dy || 0 };
    }

    for (const field of BolShared.FIELD_MAP) {
      const k       = field.overrideKey;
      const initVal = deriveValue(bol, field);
      initialValues[k] = initVal;

      let el;
      if (field.type === 'scrap') {
        el = buildScrapToggle(initVal);
      } else if (field.type === 'single') {
        el = document.createElement('input');
        el.type  = 'text';
        el.value = initVal;
        el.style.cssText = 'position:absolute;box-sizing:border-box;background:rgba(255,255,255,0.88);border:1.5px solid var(--border,#d1d5db);border-radius:4px;padding:1px 4px;font-family:Helvetica,Arial,sans-serif;color:var(--text,#111827);';
      } else {
        el = document.createElement('textarea');
        el.value = initVal;
        el.style.cssText = 'position:absolute;box-sizing:border-box;background:rgba(255,255,255,0.88);border:1.5px solid var(--border,#d1d5db);border-radius:4px;padding:2px 4px;font-family:Helvetica,Arial,sans-serif;color:var(--text,#111827);resize:none;overflow:hidden;';
        el.addEventListener('input', function () {
          this.style.height = 'auto';
          this.style.height = this.scrollHeight + 'px';
        });
      }

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
      if (_renderTask) { try { _renderTask.cancel(); } catch (_) {} _renderTask = null; }

      const logicalW = Math.max(200, scrollArea.clientWidth - 24);
      const logicalH = Math.round(logicalW * BolShared.PAGE.height / BolShared.PAGE.width);
      const s        = logicalW / BolShared.PAGE.width;
      _scale = s;
      const dpr      = window.devicePixelRatio || 1;

      canvas.width        = Math.round(logicalW * dpr);
      canvas.height       = Math.round(logicalH * dpr);
      canvas.style.width  = logicalW + 'px';
      canvas.style.height = logicalH + 'px';
      canvasWrap.style.width  = logicalW + 'px';
      canvasWrap.style.height = logicalH + 'px';

      const ctx = canvas.getContext('2d');
      const vp  = pdfPage.getViewport({ scale: s * dpr });
      _renderTask = pdfPage.render({ canvasContext: ctx, viewport: vp });
      _renderTask.promise.then(() => { _renderTask = null; }).catch(() => {});

      positionAll(s);
    }

    function positionAll(s) {
      const H = BolShared.PAGE.height;
      for (const field of BolShared.FIELD_MAP) {
        const k  = field.overrideKey;
        const el = inputEls[k];
        if (!el) continue;

        if (field.type === 'single') {
          const c = field.coord;
          el.style.left       = Math.round(c.x * s) + 'px';
          el.style.top        = Math.round((H - c.y) * s - c.size * s + BASELINE_FUDGE) + 'px';
          el.style.fontSize   = (c.size * s) + 'px';
          el.style.height     = Math.round((c.size + 6) * s) + 'px';
          el.style.lineHeight = Math.round((c.size + 4) * s) + 'px';
          el.style.width      = Math.round((BolShared.PAGE.width - c.x - 10) * s) + 'px';

        } else if (field.type === 'multiline') {
          const c     = field.coord;
          const lineH = c.lineH || 14;
          const lc    = Math.max(2, (el.value || '').split('\n').length);
          el.style.left       = Math.round(c.x * s) + 'px';
          el.style.top        = Math.round((H - c.y) * s - c.size * s + BASELINE_FUDGE) + 'px';
          el.style.fontSize   = (c.size * s) + 'px';
          el.style.width      = Math.round(c.maxW * s) + 'px';
          el.style.height     = Math.round(lc * lineH * s + 8 * s) + 'px';
          el.style.lineHeight = Math.round(lineH * s) + 'px';

        } else if (field.type === 'shipto') {
          // shipLine1 y=615, shipLine2 y=601, shipLine3 y=587, shipLine4 y=573 — 14pt spacing
          const c1 = field.coords[0];
          const c4 = field.coords[3];
          const topPx    = Math.round((H - c1.y) * s - c1.size * s + BASELINE_FUDGE);
          const bottomPx = Math.round((H - c4.y) * s + c4.size * s);
          el.style.left       = Math.round(c1.x * s) + 'px';
          el.style.top        = topPx + 'px';
          el.style.fontSize   = (c1.size * s) + 'px';
          el.style.width      = Math.round(210 * s) + 'px'; // ship-to block is ~210pt wide
          el.style.height     = (bottomPx - topPx) + 'px';
          el.style.lineHeight = Math.round(14 * s) + 'px'; // 14pt line spacing

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

    // ── Apply ──

    applyBtn.addEventListener('click', () => {
      const overrides = {};

      for (const field of BolShared.FIELD_MAP) {
        const k  = field.overrideKey;
        const el = inputEls[k];
        if (!el) continue;

        if (field.type === 'single') {
          const val = el.value; // no trim — keep parity with deriveValue's String(col || '')
          if (val !== initialValues[k]) overrides[k] = val;

        } else if (field.type === 'shipto') {
          const lines = el.value.split('\n').map(l => l.trimEnd()).filter(l => l.trim()).slice(0, 4);
          const init  = String(initialValues[k] || '').split('\n').map(l => l.trimEnd()).filter(l => l.trim());
          if (lines.join('\n') !== init.join('\n')) overrides[k] = lines;

        } else if (field.type === 'multiline') {
          const lines = el.value.split('\n').map(l => l.trimEnd());
          while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
          const init = String(initialValues[k] || '').split('\n').map(l => l.trimEnd());
          while (init.length && !init[init.length - 1].trim()) init.pop();
          if (lines.join('\n') !== init.join('\n')) overrides[k] = lines;

        } else if (field.type === 'scrap') {
          const val = el.dataset.scrapValue === 'true';
          if (val !== initialValues[k]) overrides[k] = val;
        }
      }

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
    });

    // ── Cancel ──

    cancelBtn.addEventListener('click', () => { cleanup(); onCancel(); });

    // ── Cleanup ──

    function cleanup() {
      if (_renderTask) { try { _renderTask.cancel(); } catch (_) {} _renderTask = null; }
      if (mountEl._ro) { mountEl._ro.disconnect(); delete mountEl._ro; }
      mountEl.innerHTML = '';
      mountEl.style.cssText = '';
    }

    // ── Kick off ──

    const ro = new ResizeObserver(reflow);
    ro.observe(scrollArea);
    mountEl._ro = ro;

    requestAnimationFrame(reflow);
  }

  return { open };

})();
