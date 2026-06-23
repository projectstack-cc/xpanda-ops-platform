# P150 — Reject Duplicate Invoice Numbers at Job Creation

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **db-api-agent** (`_worker.js/routes/jobs.js`)
+ **job-board-agent** (verify the create flow surfaces the error). No migration.

## Goal
Two jobs can currently be created with the same `invoice_number`. Reject a create when a
non-archived job already has that invoice number, with a clear 409 error. This also guards the
future QuickBooks auto-intake, where created/updated webhooks can re-fire for the same invoice.

Scope: **creation only** (the POST/INSERT path). Editing is not guarded here.

## File
- `_worker.js/routes/jobs.js` — 1 insertion before the `INSERT INTO jobs`

---

### Edit — duplicate guard before insert

FIND (count == 1):
```
    try {
      await db.prepare(`
        INSERT INTO jobs (
          id, status, customer, po_number, invoice_number, ship_date, ship_day,
```

REPLACE:
```
    // Reject duplicate invoice numbers (also guards future QB auto-intake webhook re-fires).
    if (invoice_number) {
      const dupe = await db.prepare(
        "SELECT id FROM jobs WHERE invoice_number = ? AND status != 'archived' LIMIT 1"
      ).bind(invoice_number).first();
      if (dupe) {
        return json({ ok: false, error: `A job with invoice # ${invoice_number} already exists.`, code: 'duplicate_invoice' }, 409);
      }
    }

    try {
      await db.prepare(`
        INSERT INTO jobs (
          id, status, customer, po_number, invoice_number, ship_date, ship_day,
```

---

## Verify
- FIND `count == 1`.
- `cp _worker.js/routes/jobs.js /tmp/jobs.mjs && node --check /tmp/jobs.mjs`
- Confirm `json` and `invoice_number` are both in scope at this point in the POST handler (they are —
  `json` is used throughout and `invoice_number` is parsed earlier in this handler).
- **job-board-agent check:** confirm the job-create flow in `jobs/index.html` (both manual create and
  packing-slip upload create) shows the API error message to the user on a non-OK response. If it
  swallows the error, surface `error` from the response. Do NOT add a frontend dedupe — server is the
  source of truth.

## What NOT to change
- Do NOT guard the PUT/update path (out of scope; backlog item is "at job creation").
- Do NOT add a migration or a UNIQUE constraint (archived jobs may legitimately share old numbers).
- Do NOT touch auto-pack, `STORAGE_KEY`, or unrelated handlers.

## Deploy
```
git add _worker.js/routes/jobs.js
git commit -m "P150: reject duplicate invoice_number at job creation (409); guards QB auto-intake re-fires"
git push
```
