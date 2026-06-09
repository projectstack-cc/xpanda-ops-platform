# Prompt 138 — BOL PO number: render + persist (durable fix) + housekeeping

## Mandatory reading (first, before any edit)
1. Read **`AGENTS.md`** in full.
2. Read **`xpanda-ops-agents.md`** in full.
3. Assume these agents for this task:
   - **logistics-agent** — leads `logistics/bol-generator.html`.
   - **db-api-agent** — owns `_worker.js/routes/bols.js` and the `DB_Migrations/` SQL.
   - **qc-agent** — owns the `qc/incident-report.html` + `_worker.js/routes/qc.js` log cleanup.

## What this prompt does
1. Makes the customer **PO number** flow end-to-end on `bol-generator.html`: a form field → payload → PDF render → **persisted** on the saved BOL → rehydrated on edit. (The renderer in `bol-shared.js` already draws `bol.po_number`; today the generator never supplies it and the worker never stores it.)
2. Side effect for free: the **load-builder / BolCompose** path already sends `po_number` on save — once the worker column exists, those BOLs persist PO too. **No change to `load-builder.html` or `bol-compose.js`.**
3. Deletes one 0-byte orphan file.
4. Removes debug `console.log` noise in two shipped paths.

## Hard fences — do NOT change
- Do **not** run, execute, or apply the migration. Write the `.sql` file only. Steve runs it in the Cloudflare D1 console.
- Do **not** touch `bol-shared.js`, `bol-compose.js`, `bol-editor.js`, or `load-builder.html` — the render + load-builder-save sides already work; the column is the only missing piece.
- Do **not** touch `STORAGE_KEY` (`foam_trailer_loader_v31`) or the auto-pack algorithm.
- Do **not** reorder or re-align any existing column lists, bind argument order, or VALUES placeholders beyond the exact single-token insertions specified.

## Validation requirements (apply to every edit)
- Before each find/replace, confirm the search string occurs **exactly once** (`count == 1`) in the target file. If a search string is not unique or not found, **stop and report** — do not guess.
- After editing any `.js` file (`_worker.js/routes/bols.js`, `_worker.js/routes/qc.js`), run `node --check` on it. For the inline `<script>` in `bol-generator.html` / `incident-report.html`, extract the script block to a real temp file (`re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S)`) and `node --check` that temp file. Never pipe via `/dev/stdin`.

---

## Part 1 — DB migration (write file only; Steve runs it manually)

Create **`DB_Migrations/add-po-number-to-bols.sql`**:

```sql
-- Adds the PO / purchase-order column to bols.
-- D1/SQLite has no "ADD COLUMN IF NOT EXISTS" — run once, manually, in the
-- Cloudflare D1 Dashboard Console. Run BEFORE deploying the P138 worker change
-- (the INSERT/UPDATE below reference po_number and will error if the column is absent).
ALTER TABLE bols ADD COLUMN po_number TEXT;
```

> **Deploy ordering note for Steve:** run this migration in the D1 console *before* the new worker deploys.

---

## Part 2 — Worker: `_worker.js/routes/bols.js`

### 2a — INSERT column list (POST handler)
Find:
```
          package_qty, package_type, weight, delivery_time, job_id, notes, render_overrides, access_token, created_at
```
Replace:
```
          package_qty, package_type, weight, delivery_time, job_id, notes, po_number, render_overrides, access_token, created_at
```

### 2b — INSERT VALUES placeholders (add one `?`, 36 → 37)
Find:
```
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
```
Replace:
```
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
```

### 2c — INSERT bind values
Find:
```
        s("notes"), render_overrides, access_token, now
```
Replace:
```
        s("notes"), s("po_number"), render_overrides, access_token, now
```

### 2d — UPDATE SET column list (PUT handler)
Find:
```
          package_qty = ?, package_type = ?, weight = ?, delivery_time = ?, job_id = ?, notes = ?, render_overrides = ?,
```
Replace:
```
          package_qty = ?, package_type = ?, weight = ?, delivery_time = ?, job_id = ?, notes = ?, po_number = ?, render_overrides = ?,
```

### 2e — UPDATE bind values (include the `bolId` line to guarantee uniqueness)
Find:
```
        s("notes"), render_overrides, access_token,
        bolId
```
Replace:
```
        s("notes"), s("po_number"), render_overrides, access_token,
        bolId
```

Then `node --check _worker.js/routes/bols.js`.

> GET handlers use `SELECT * FROM bols`, so `po_number` round-trips back with no GET change.

---

## Part 3 — Frontend: `logistics/bol-generator.html`

### 3a — Add the PO input field (in "Special Instructions & Contact", after Contact Info)
Find:
```
    <div class="bol-field">
      <label>Contact Info</label>
      <textarea id="f-contact-info" rows="2" placeholder="Additional contact details…"></textarea>
    </div>
  </div>
```
Replace:
```
    <div class="bol-field">
      <label>Contact Info</label>
      <textarea id="f-contact-info" rows="2" placeholder="Additional contact details…"></textarea>
    </div>
    <div class="bol-field">
      <label>PO Number</label>
      <input type="text" id="f-po-number" placeholder="Customer PO #">
    </div>
  </div>
```

### 3b — `collectPayload()` returns `po_number`
Find:
```
    delivery_time:         document.getElementById('f-delivery-time').value.trim(),
    notes:                 document.getElementById('f-notes').value.trim(),
```
Replace:
```
    delivery_time:         document.getElementById('f-delivery-time').value.trim(),
    po_number:             document.getElementById('f-po-number').value.trim(),
    notes:                 document.getElementById('f-notes').value.trim(),
```

### 3c — `prefillFromJob()` maps the job's PO
Find:
```
    if (job.delivery_time)  document.getElementById('f-delivery-time').value = job.delivery_time;
```
Replace:
```
    if (job.delivery_time)  document.getElementById('f-delivery-time').value = job.delivery_time;
    if (job.po_number)      document.getElementById('f-po-number').value     = job.po_number;
```

### 3d — `loadBolIntoForm()` rehydrates PO on edit
Find:
```
  set('f-contact-info',          b.contact_info);
  set('f-commodity',             b.commodity_description);
```
Replace:
```
  set('f-contact-info',          b.contact_info);
  set('f-po-number',             b.po_number);
  set('f-commodity',             b.commodity_description);
```

### 3e — Clear PO on form reset
Find:
```
    'f-delivery-time','f-notes','customer-search',
```
Replace:
```
    'f-delivery-time','f-notes','f-po-number','customer-search',
```

Then extract the inline `<script>` block and `node --check` it.

---

## Part 4 — Housekeeping

### 4a — Delete the 0-byte orphan
Delete **`temp-home.html`** at repo root (confirm 0 bytes and no references before removing).

### 4b — `qc/incident-report.html`: remove the debug log (fires on every submit)
Find:
```
        console.log("Incident payload preview:", payload);
```
Replace with nothing (remove the line). Then extract the inline script block and `node --check`.

### 4c — `_worker.js/routes/qc.js`: quiet the scrap-mirror logs (errors → `console.error`, drop skip/success noise)

Edit 1 — drop the skip log. Find:
```
  if (!url) {
    console.log("SCRAP_MIRROR_URL not set — skipping mirror.");
    return { ok: false, skipped: true };
  }
```
Replace:
```
  if (!url) {
    return { ok: false, skipped: true };
  }
```

Edit 2 — HTTP error → console.error. Find:
```
      console.log("Mirror HTTP error:", resp.status, text);
```
Replace:
```
      console.error("Mirror HTTP error:", resp.status, text);
```

Edit 3 — app error → console.error. Find:
```
      console.log("Mirror app error:", data);
```
Replace:
```
      console.error("Mirror app error:", data);
```

Edit 4 — drop success noise. Find:
```
    console.log("Mirror success:", record.id);
    return { ok: true };
```
Replace:
```
    return { ok: true };
```

Edit 5 — fetch failure → console.error. Find:
```
    console.log("Mirror fetch failed:", err);
```
Replace:
```
    console.error("Mirror fetch failed:", err);
```

Then `node --check _worker.js/routes/qc.js`.

---

## Done criteria
- New file `DB_Migrations/add-po-number-to-bols.sql` exists (not executed).
- `node --check` passes on `_worker.js/routes/bols.js` and `_worker.js/routes/qc.js` and on the extracted `bol-generator.html` + `incident-report.html` script blocks.
- `temp-home.html` removed.
- Report each find/replace as applied with its `count == 1` confirmation. Do not apply the migration. Do not deploy.
