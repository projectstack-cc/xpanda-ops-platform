# Prompt 180 — Siplast Product toggle on the BOL generator

## Required reading
1. Read `AGENTS.md` and `xpanda-ops-agents.md`.
2. Two agents: **db-api-agent** (`DB_Migrations/*`, `_worker.js/routes/bols.js`) and **logistics-agent** (`logistics/bol-compose.js`, `logistics/bol-shared.js`).

## Context
Add a "Siplast Product?" checkbox to the BOL modal. When checked and saved, the BOL is flagged Siplast; at render, each commodity line's SKU (inside parens) is prefixed with "Siplast" — e.g. `(HB-10)` → `(Siplast HB-10)`. Persisted on the `bols` row so it shows on every copy and on re-view.

All edits byte-exact, each count==1. Confirm before applying.

## Edit 1 — Migration (run in D1 BEFORE deploying the worker)
**Create** `DB_Migrations/add-siplast-to-bols.sql`:
```sql
-- Siplast flag on BOLs. When set, the SKU in each commodity line is prefixed
-- "Siplast" at render. SQLite ALTER ADD COLUMN is not idempotent — run once.
-- Run in the Cloudflare D1 Dashboard Console BEFORE deploying the worker.
ALTER TABLE bols ADD COLUMN siplast INTEGER DEFAULT 0;
```
The bols GET path is `SELECT *`, so the column surfaces automatically.

## Edit 2 — Worker INSERT carries `siplast` (`_worker.js/routes/bols.js`)
### 2a — column list (add `siplast` after `is_master_bol`)
FIND (exactly once):
```
          freight_terms, is_scrap_pickup, third_party_bill_to, special_instructions, contact_info, is_master_bol,
```
REPLACE:
```
          freight_terms, is_scrap_pickup, third_party_bill_to, special_instructions, contact_info, is_master_bol, siplast,
```
### 2b — VALUES placeholder (41 → 42)
FIND (exactly once):
```
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
```
REPLACE:
```
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
```
### 2c — bind (add `siplast` right after the `is_master_bol` bind)
FIND (exactly once):
```
        payload.is_master_bol ? 1 : 0,
        s("commodity_description"), s("handling_unit_qty"), s("handling_unit_type"),
```
REPLACE:
```
        payload.is_master_bol ? 1 : 0,
        payload.siplast ? 1 : 0,
        s("commodity_description"), s("handling_unit_qty"), s("handling_unit_type"),
```
(The PUT/UPDATE handler is intentionally left alone — `siplast` is set at creation and preserved on edit.)

## Edit 3 — Modal state default (`logistics/bol-compose.js`)
FIND (exactly once):
```
      hideQr: false,
    };
```
REPLACE:
```
      hideQr: false,
      siplast: false,
    };
```

## Edit 4 — Save payload carries the flag (`logistics/bol-compose.js`)
FIND (exactly once):
```
          is_master_bol: 0,
          bol_group_id: bolGroupId,
```
REPLACE:
```
          is_master_bol: 0,
          siplast: BM.siplast ? 1 : 0,
          bol_group_id: bolGroupId,
```

## Edit 5 — "Siplast Product?" checkbox in the modal (`logistics/bol-compose.js`)
Add it right after the existing hide-dimensions checkbox in the commodity panel.
FIND (exactly once):
```
    hideDimsLabel.appendChild(hideDimsCheck);
    hideDimsLabel.appendChild(document.createTextNode('Part # and qty only (hide dimensions)'));
    commPanel.appendChild(hideDimsLabel);
```
REPLACE:
```
    hideDimsLabel.appendChild(hideDimsCheck);
    hideDimsLabel.appendChild(document.createTextNode('Part # and qty only (hide dimensions)'));
    commPanel.appendChild(hideDimsLabel);

    const siplastLabel = h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#6b7280', cursor: 'pointer', marginTop: '6px' } });
    const siplastCheck = h('input', { type: 'checkbox' });
    siplastCheck.checked = !!BM.siplast;
    siplastCheck.addEventListener('change', e => { BM.siplast = e.target.checked; });
    siplastLabel.appendChild(siplastCheck);
    siplastLabel.appendChild(document.createTextNode('Siplast Product?'));
    commPanel.appendChild(siplastLabel);
```

## Edit 6 — Render prefixes the SKU when flagged (`logistics/bol-shared.js`)
FIND (exactly once):
```
      const _commodityText = Array.isArray(_ov.commodity) ? _ov.commodity.join('\n') : bol.commodity_description;
      if (_commodityText) {
        const _tier = pickCommodityTier(String(_commodityText), font);
        drawMultiline(_commodityText, off('commodity', { ...COORDS.commodity, size: _tier.size, lineH: _tier.lineH }));
      }
```
REPLACE:
```
      let _commodityText = Array.isArray(_ov.commodity) ? _ov.commodity.join('\n') : bol.commodity_description;
      if (_commodityText && bol.siplast) {
        // Siplast products: prefix the SKU inside parens, e.g. (HB-10) -> (Siplast HB-10)
        _commodityText = String(_commodityText).replace(/\(([^)]+)\)/g, '(Siplast $1)');
      }
      if (_commodityText) {
        const _tier = pickCommodityTier(String(_commodityText), font);
        drawMultiline(_commodityText, off('commodity', { ...COORDS.commodity, size: _tier.size, lineH: _tier.lineH }));
      }
```

## Validation
- `node --check _worker.js/routes/bols.js`
- `node --check logistics/bol-compose.js`
- `node --check logistics/bol-shared.js`

## Manual sanity (Steve)
- Run the migration in D1, deploy worker.
- BOL modal shows "Siplast Product?" (unchecked default). Generate without it → unchanged. Check it → commodity SKUs render as `(Siplast HB-10)`, and re-viewing the saved BOL keeps the prefix.

## What NOT to change
- Do NOT add `siplast` to the PUT/UPDATE handler.
- Do NOT alter the commodity text for non-Siplast BOLs, the hide-dims toggle, or any other field.

## Deliverables
- `DB_Migrations/add-siplast-to-bols.sql` (run before deploy).
- `_worker.js/routes/bols.js` — INSERT carries `siplast`.
- `logistics/bol-compose.js` — state default, save payload, checkbox.
- `logistics/bol-shared.js` — SKU prefix at render when `bol.siplast`.
- All `.js` pass `node --check`.
