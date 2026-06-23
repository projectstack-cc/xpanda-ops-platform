# Prompt 170 — BOL multi-load linking foundation (group id + load sequence)

## Required reading (do this first)
1. Read `AGENTS.md` (platform conventions).
2. Read `xpanda-ops-agents.md` (multi-agent definition).
3. This task spans two agents: **db-api-agent** (`_worker.js`, `DB_Migrations/*`) for the migration + worker INSERT, and **logistics-agent** (`logistics/bol-compose.js`) for the shared save funnel. Assume both.

## Context
Today, when a multi-trailer load generates multiple BOLs (load-builder's "Generate BOL" → `BolCompose.open()` → `generateAll()` loops over `trailerData`, one `bols` row per trailer), the resulting BOLs are associated **only by `job_id`**. There is no group token and no per-record load sequence, so the trailers of one shipment can't be queried or displayed as a set, and `is_master_bol` is vestigial (always written `0`, never read).

This prompt adds the **data linkage** in the single shared save path so every multi-load set is linked regardless of which surface created it. Both current and future callers (load-builder now; the logistics-dashboard launcher in the next prompt) benefit. No display changes here — this is the foundation.

All edits are byte-exact find/replace, each verified to appear exactly once at HEAD. Confirm `count == 1` before applying. Do not reflow surrounding code.

---

## Edit 1 — Migration (run manually in D1 BEFORE deploying the worker)
**Create file:** `DB_Migrations/add-bol-group-linking.sql`

```sql
-- Multi-load BOL linking: a shared group id plus per-record load sequence, so the
-- BOLs that make up one multi-trailer shipment can be queried/displayed as a set.
-- SQLite ALTER ADD COLUMN is not idempotent — run this migration exactly once.
-- Run in the Cloudflare D1 Dashboard Console BEFORE deploying the worker.
ALTER TABLE bols ADD COLUMN bol_group_id TEXT;
ALTER TABLE bols ADD COLUMN load_number INTEGER;
ALTER TABLE bols ADD COLUMN load_count INTEGER;
CREATE INDEX IF NOT EXISTS idx_bols_group ON bols (bol_group_id);
```

The bols GET path uses `SELECT * FROM bols`, so these columns surface in API responses automatically once present — no GET change needed.

---

## Edit 2 — Worker INSERT: add the three columns (`_worker.js/routes/bols.js`)
Three discrete edits to the POST `INSERT INTO bols` statement. Column order, placeholder count, and bind order must stay aligned (placeholders go 38 → 41).

### 2a — column list
FIND (exactly once):
```
          package_qty, package_type, weight, delivery_time, job_id, notes, po_number, render_overrides, access_token, shipper_name, created_at
```
REPLACE:
```
          package_qty, package_type, weight, delivery_time, job_id, notes, po_number, render_overrides, access_token, shipper_name,
          bol_group_id, load_number, load_count, created_at
```

### 2b — VALUES placeholders (38 → 41)
FIND (exactly once):
```
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
```
REPLACE:
```
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
```

### 2c — bind args (insert the three group binds immediately before `now`)
FIND (exactly once):
```
        s("notes"), s("po_number"), render_overrides, access_token, shipper_name, now
      ).run();
```
REPLACE:
```
        s("notes"), s("po_number"), render_overrides, access_token, shipper_name,
        payload.bol_group_id ? String(payload.bol_group_id).trim() : null,
        payload.load_number != null ? Number(payload.load_number) : null,
        payload.load_count  != null ? Number(payload.load_count)  : null,
        now
      ).run();
```

Do NOT touch the PUT/UPDATE handler — group identity is set only at creation.

---

## Edit 3 — Shared save funnel stamps the group (`logistics/bol-compose.js`)
`generateAll()` is the single funnel both BOL surfaces use. Mint one shared group id per run (only when the set has more than one record) and stamp a per-record load sequence into each payload.

### 3a — mint the group id before the save loop
FIND (exactly once):
```
    const savedBols = [];
    for (let i = 0; i < bm.trailerData.length; i++) {
```
REPLACE:
```
    const savedBols = [];
    // Link a multi-load BOL set with a shared group id so the trailers of one
    // shipment are queryable/displayable as a set. Singles get no group id.
    const bolGroupId = bm.trailerData.length > 1
      ? ((typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : ('grp-' + Date.now() + '-' + Math.random().toString(36).slice(2)))
      : null;
    for (let i = 0; i < bm.trailerData.length; i++) {
```

### 3b — add the three fields to the per-record payload
FIND (exactly once):
```
          is_master_bol: 0,
          commodity_description: td.commodityDescription,
```
REPLACE:
```
          is_master_bol: 0,
          bol_group_id: bolGroupId,
          load_number: i + 1,
          load_count: bm.trailerData.length,
          commodity_description: td.commodityDescription,
```

---

## Step 4 — Validation
Both modified frontend/worker files are standalone `.js` — run `node --check` directly (no inline-script extraction needed):
- `node --check _worker.js/routes/bols.js`
- `node --check logistics/bol-compose.js`

Confirm both pass before finishing.

---

## What NOT to change
- Do NOT modify the BOL PUT/UPDATE handler, the GET query, `generateBolPdf`, `generateCombinedCopies`, `reviewRecords`, or any rendering code.
- Do NOT touch `bol-shared.js`, `load-builder.html`, `bol-generator.html`, the auto-pack algorithm, or `STORAGE_KEY`.
- Do NOT add a permission key — no new route or module.
- Do NOT repurpose or remove `is_master_bol` in this prompt (left as-is).

## Deliverables summary
- `DB_Migrations/add-bol-group-linking.sql` — new migration (**run manually in D1 before deploying the worker**).
- `_worker.js/routes/bols.js` — 3 INSERT edits (column list, VALUES, binds).
- `logistics/bol-compose.js` — 2 edits (group id mint + payload fields).
- Both `.js` files pass `node --check`.
- No GET change (SELECT * exposes the new columns automatically).
