# Shipper Auto-Sign #1 — Foundation: store the generating user's display name on the BOL

> Assign a number before committing (likely **P161**). Foundation for the cursive shipper signature.
> Unblocked — no font needed. Reflects HEAD `f792ea7`. Independent of the QR-token prompt (P160);
> order between them doesn't matter (different anchors).

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **db-api-agent** — migration +
`_worker.js/routes/bols.js` POST only. No frontend, no rendering (that's prompt #2).

## Goal
Persist the **display name** of the user who generates a BOL onto the record, so the cursive shipper
signature (prompt #2) renders consistently everywhere — including the public `track/` copies, which
have no session. The name is resolved server-side from the session (`X-User-Id` → `users.display_name`),
authoritative and not client-trusted.

## Files
- `DB_Migrations/add-shipper-name-to-bols.sql` — new (**run in D1 console before deploying**)
- `_worker.js/routes/bols.js` — POST resolves + stores `shipper_name` (4 edits)

---

### File 1 — `DB_Migrations/add-shipper-name-to-bols.sql` (new)

```sql
ALTER TABLE bols ADD COLUMN shipper_name TEXT NOT NULL DEFAULT '';
```

> **Deploy ordering:** Steve runs this in the D1 console **before** deploying the worker.

### Edit 1 — resolve the display name just before the INSERT

FIND (count == 1):
```
    try {
      await db.prepare(`
        INSERT INTO bols (
```
REPLACE:
```
    const shipperUserId = request.headers.get('X-User-Id') || '';
    let shipper_name = '';
    if (shipperUserId) {
      const _su = await db.prepare("SELECT display_name FROM users WHERE id = ?").bind(shipperUserId).first();
      shipper_name = (_su && _su.display_name) ? _su.display_name : '';
    }

    try {
      await db.prepare(`
        INSERT INTO bols (
```

### Edit 2 — add the column to the INSERT list

FIND (count == 1):
```
          package_qty, package_type, weight, delivery_time, job_id, notes, po_number, render_overrides, access_token, created_at
```
REPLACE:
```
          package_qty, package_type, weight, delivery_time, job_id, notes, po_number, render_overrides, access_token, shipper_name, created_at
```

### Edit 3 — add one placeholder to VALUES

FIND (count == 1):
```
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
```
REPLACE:
```
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
```

### Edit 4 — bind the value (in the same position as the column)

FIND (count == 1):
```
        s("notes"), s("po_number"), render_overrides, access_token, now
```
REPLACE:
```
        s("notes"), s("po_number"), render_overrides, access_token, shipper_name, now
```

---

## Verify
- All FINDs `count == 1`.
- `cp _worker.js/routes/bols.js /tmp/bols.mjs && node --check /tmp/bols.mjs`
- **Placeholder/column/bind count must match**: after editing, the column list, the `?` count, and
  the `.bind(...)` arg count are all equal (one more than before). Double-check this — a mismatch
  silently corrupts inserts.
- After the migration + deploy: generate a BOL, then confirm the row's `shipper_name` equals the
  logged-in user's display name (the `track/` lookup already returns `SELECT *`, so it'll be available
  to the renderer in prompt #2).

## What NOT to change
- Do NOT add rendering, fonts, or the shipper coord (prompt #2).
- Do NOT trust a client-provided shipper name — resolve from the session.
- Do NOT touch the PUT path, auto-pack, or `STORAGE_KEY`.

## Deploy
1. Run `DB_Migrations/add-shipper-name-to-bols.sql` in the D1 console.
2. Then:
```
git add DB_Migrations/add-shipper-name-to-bols.sql _worker.js/routes/bols.js
git commit -m "P###: store generating user's display_name as bols.shipper_name (shipper auto-sign foundation)"
git push
```
