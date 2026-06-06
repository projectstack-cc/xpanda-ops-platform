window.BolCompose = (function () {
  'use strict';

  // ── Self-contained DOM helper (copy of load-builder's h(); kept local so this
  //    module carries no dependency on any consuming page's internals) ──
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'className') el.className = v;
    else if (k === 'innerHTML') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  children.flat(Infinity).forEach(c => {
    if (c == null || c === false) return;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  });
  return el;
}

  // ── Modal styles, lifted verbatim from load-builder.html (P123). Injected once
  //    at load so any consumer gets identical BOL-modal styling without owning the CSS. ──
  const STYLE_ID = 'bol-compose-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = `
  /* BOL Modal ─────────────────────────────────────────────────── */
  .bol-backdrop {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(15,23,42,0.5);
    display: flex; align-items: center; justify-content: center;
  }
  .bol-modal {
    background: var(--surface); border-radius: var(--radius-lg);
    max-width: 680px; width: 95vw; max-height: 90vh; overflow-y: auto;
    box-shadow: 0 20px 60px rgba(15,23,42,0.3);
    display: flex; flex-direction: column;
  }
  .bol-modal-header {
    padding: 20px 24px 16px; border-bottom: 1px solid var(--border-light);
    position: sticky; top: 0; background: var(--surface); z-index: 1; flex-shrink: 0;
  }
  .bol-modal-body { padding: 20px 24px; flex: 1; }
  .bol-modal-footer {
    padding: 14px 24px; border-top: 1px solid var(--border-light);
    display: flex; align-items: center; justify-content: space-between;
    position: sticky; bottom: 0; background: var(--surface); flex-shrink: 0;
  }
  .bol-source-tabs { display: flex; gap: 4px; margin-bottom: 16px; flex-wrap: wrap; }
  .bol-search-results {
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface); box-shadow: 0 4px 16px rgba(15,23,42,0.1);
    max-height: 200px; overflow-y: auto; margin-top: 4px;
  }
  .bol-search-item {
    padding: 10px 14px; cursor: pointer;
    border-bottom: 1px solid var(--border-light); font-size: 14px;
  }
  .bol-search-item:hover { background: var(--bg); }
  .bol-search-item:last-child { border-bottom: none; }
  .bol-confirm-msg { font-size: 13px; color: var(--green); font-weight: 600; margin-bottom: 12px; }
  .bol-form-group { margin-bottom: 12px; }
  .bol-form-group .form-label { display: block; margin-bottom: 4px; }
  .bol-city-row { display: grid; grid-template-columns: 1fr 60px 90px; gap: 8px; }
  .bol-freight-row { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
  .bol-progress-list, .bol-success-list { list-style: none; padding: 0; margin: 12px 0; }
  .bol-progress-list li, .bol-success-list li {
    padding: 8px 0; font-size: 14px; border-bottom: 1px solid var(--border-light);
  }
  @media (max-width: 600px) {
    .bol-modal { border-radius: 0; width: 100vw; max-height: 100vh; }
    .bol-city-row { grid-template-columns: 1fr; }
  }
`;
    document.head.appendChild(el);
  }

  injectStyles();

  // ── Public API ──
  // open() is wired in P124 (render extraction). Scaffold only for P123: this module
  // currently just owns h() and the injected styles. Load builder still uses its own
  // openBolModal/renderBolModal in this phase.
  function open() {
    throw new Error('BolCompose.open is not wired until P124 (render extraction).');
  }

  return { open, _h: h, _injectStyles: injectStyles };

})();
