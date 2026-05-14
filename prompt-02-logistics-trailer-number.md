# Prompt 02 — Logistics Dashboard: Add Trailer Number Field

You are working inside the xPanda Operations Platform repository.
Follow all rules in AGENTS.md.

---

## Objective

Add a `trailer_number` field to the shipments system — DB schema, API handler, dashboard modal, and outbound table display.

---

## Scope

**Files to modify:**

1. `_worker.js` — add `trailer_number` to the shipments POST and PUT handlers
2. `/logistics/index.html` — add field to modal, table header, and row render for outbound shipments

**Do NOT modify:**
- `logistics.sql` (schema file is for reference only — migration runs via Cloudflare Dashboard Console)
- Any other file

---

## Step 1 — D1 Migration

Do NOT run this. Write it here so I can run it manually in the Cloudflare Dashboard Console:

```sql
ALTER TABLE shipments ADD COLUMN trailer_number TEXT NOT NULL DEFAULT '';
```

---

## Step 2 — `_worker.js`

In `handleApiShipments`:

**POST handler** — add `trailer_number` extraction alongside the existing fields:
```js
const trailer_number = String(payload.trailer_number || '').trim();
```
Then add `trailer_number` to the INSERT column list and `.bind()` values in the correct matching position.

**PUT handler** — add `trailer_number` to the updatable fields list using the same pattern as the existing fields (e.g. `carrier`, `bol_number`).

Keep all existing fields and logic untouched.

---

## Step 3 — `/logistics/index.html`

### Modal form

Add a `Trailer #` input field in the outbound fields section, after the `Carrier` field:

```html
<div class="logistics-form-row">
  <label>Trailer #</label>
  <input type="text" id="f-trailer-number" placeholder="Trailer number">
</div>
```

### `clearForm` function

Add `'f-trailer-number'` to the array of field IDs that get cleared on reset.

### `openEditModal` function

Add population of the new field alongside the existing ones:
```js
document.getElementById('f-trailer-number').value = s.trailer_number || '';
```

### `saveShipment` function

Read the field and add to the outbound payload:
```js
payload.trailer_number = document.getElementById('f-trailer-number').value.trim();
```

### Outbound table

Add `<th>Trailer #</th>` after the `Method / Carrier` column header.

In the row render, add the corresponding `<td>` after the method/carrier cell:
```js
<td>${esc(s.trailer_number) || '—'}</td>
```

---

## Completion

Notify me when done and remind me to run the migration in the Cloudflare Dashboard Console before testing.
