# Prompt 241 — Fix multi-load BOLs saving with `job_id = NULL` (frontend + backfill + worker guard)

## Agents
Read **BOTH** `AGENTS.md` **AND** `xpanda-ops-agents.md`.

- **logistics-agent** (§3) — leads. Owns Task 1 (`logistics/load-builder.html`).
- **db-api-agent** (§9) — owns Task 2 (`DB_Migrations/`) and Task 3 (`_worker.js/routes/bols.js`).

Identify both agents at the start.

## Root cause (confirmed in source + D1)

`logistics/load-builder.html:2495`:
```js
if (state.prefillJobData && i === 0) {
```
The job prefill — **including `td.jobId`** — is applied to **trailer index 0 only**. Every other trailer in a multi-load run keeps the initializer value `jobId: null` (line 2486), so `bol-compose.js:625` (`job_id: td.jobId || null`) persists loads 2..N with `job_id = NULL`.

Consequences, all observed on INV 4149:
- Loads 2/3 are structurally invisible to `GET /api/bols?job_id=` → never appear in the shipment modal's Documents section (P240 correctly renders what it's given; there was nothing to give).
- Because those BOLs never surfaced, their driver copies were never pulled up for signing → `bol_documents` has zero rows for loads 2/3. **This is a data-linkage failure, not a floor-protocol failure.**
- The token-preserving dedupe in `routes/bols.js:394` is **gated on `payload.job_id`**, so orphaned rows skip it entirely — which is why each regeneration attempt stacked another row (5 apiece).

BOLs generated from the **logistics dashboard** launcher (`index.html:1016`) are unaffected — it spreads `jobId: job.id` into a `base` used for every `load_count` record. The bug is specific to the load-builder path.

---

## Task 1 — logistics-agent — apply the job prefill to every trailer

File: `logistics/load-builder.html`. Frontend-only.

**Hard fences:** do not touch the auto-pack algorithm (`calcLoading`/`buildRow`/`buildColumn`/`buildDemand`), `STORAGE_KEY` (`foam_trailer_loader_v31`), the dissolve code, or the carry-over loop that follows this block.

### 1a — drop the `i === 0` gate

Anchor (verified `grep -Fc` == 1):
```
    if (state.prefillJobData && i === 0) {
```
Replace with:
```
    if (state.prefillJobData) {
```

### 1b — preserve the per-trailer INV # override

The prefill block unconditionally overwrites `td.invNumber`. `td` is initialized with `invNumber: state.trailerInvNumbers[i] || ''` (per-trailer, user-editable), so once the block runs for every trailer it would clobber that. Keep the job invoice only as a fallback.

Anchor (verified `grep -Fc` == 1):
```
      td.invNumber      = job.invoice_number   || job.packing_slip_invoice || '';
```
Replace with:
```
      td.invNumber      = td.invNumber || job.invoice_number || job.packing_slip_invoice || '';
```

Everything else in the block (ship-to, carrier, contact, PO, delivery time, date) now applies to all trailers — intended: they are all the same job, same ship-to. The carry-over loop immediately below is unchanged and remains harmless (it now copies identical values forward).

---

## Task 2 — db-api-agent — backfill orphaned BOL rows

New file: `DB_Migrations/backfill-bol-job-id.sql`

```sql
-- P241 — Relink multi-load BOL rows that were saved with job_id = NULL.
-- Cause: load-builder applied the job prefill (incl. jobId) to trailer index 0 only, so
-- loads 2..N persisted orphaned. P170's bol_group_id is the recovery key: any orphan in a
-- group where at least one sibling IS linked inherits that sibling's job_id.
-- Idempotent: re-running is a no-op once no NULL job_id rows with a group key remain.

UPDATE bols
   SET job_id = (
         SELECT b2.job_id
           FROM bols b2
          WHERE b2.bol_group_id = bols.bol_group_id
            AND b2.job_id IS NOT NULL
          LIMIT 1
       )
 WHERE job_id IS NULL
   AND bol_group_id IS NOT NULL
   AND EXISTS (
         SELECT 1
           FROM bols b3
          WHERE b3.bol_group_id = bols.bol_group_id
            AND b3.job_id IS NOT NULL
       );
```

Steve runs this **manually in the D1 console**. Verification query to hand him (report it in the prompt output, do not run it yourself):
```sql
SELECT COUNT(*) AS orphans_remaining,
       SUM(CASE WHEN bol_group_id IS NULL THEN 1 ELSE 0 END) AS unrecoverable_pre_p170
  FROM bols WHERE job_id IS NULL;
```
⚠️ **Pre-P170 rows have no `bol_group_id` and cannot be auto-relinked** — they must be fixed by hand or left orphaned. Call this out explicitly.

⚠️ Backfill only restores the **link**. It does **not** create signatures. Loads 2/3 of INV 4149 were genuinely never signed; once relinked they will appear in Documents as "No signed copies yet" and must be re-signed through the normal driver flow.

---

## Task 3 — db-api-agent — worker guard so no path can re-orphan

File: `_worker.js/routes/bols.js`, POST handler.

Anchor (verified `grep -Fc` == 1):
```
    if (payload.job_id && payload.load_number != null) {
```
Insert **immediately above** that line:
```js
    // P241 guard: a BOL arriving with no job_id but a known bol_group_id inherits the group's
    // job link from a already-linked sibling. Belt-and-braces against any client path that
    // fails to send job_id — and it re-arms the token-preserving dedupe below, which is gated
    // on job_id and was therefore skipped entirely for orphaned rows (hence the duplicate rows).
    if (!payload.job_id && payload.bol_group_id) {
      try {
        const sib = await db.prepare(
          "SELECT job_id FROM bols WHERE bol_group_id = ? AND job_id IS NOT NULL LIMIT 1"
        ).bind(String(payload.bol_group_id).trim()).first();
        if (sib && sib.job_id) payload.job_id = sib.job_id;
      } catch (e) {
        console.error('bols POST: bol_group_id job link inheritance failed', e);
      }
    }

```

**Do not** change the INSERT column list, placeholder count, or bind order — the guard only populates `payload.job_id` before the existing code reads it. **Do not** touch `access_token` handling: the dedupe path must keep preserving an existing token (printed QR codes depend on it).

---

## Verification gate (mandatory)
1. Confirm all three anchors matched exactly once (`grep -Fc`) **before** editing.
2. `node --check` on the modified inline script of `logistics/load-builder.html` **and** on `_worker.js/routes/bols.js` — **use a named temp file**; piping via `/dev/stdin` does not work.
3. Reason through: a 3-load build with "Pull from Job" → all three `td.jobId` are set → all three BOL rows persist with `job_id` → the shipment modal's Documents section (P240) lists three cards → regenerating any load hits the dedupe path and **reuses its existing `access_token`**.
4. Reason through: a per-trailer INV # typed into the load builder survives the prefill (not overwritten by the job invoice).

## Deployment order (hard — flag loudly in the output)
**1) Run `backfill-bol-job-id.sql` in the D1 console. 2) Then deploy the worker + frontend.**

## Docs (same commit)
- `CHANGELOG.md` → **Logistics** section, newest-first: a **P241** entry covering all three parts, noting the deployment order and the pre-P170 unrecoverable-orphan caveat.
- `BACKLOG.md` → add a follow-on item if the verification query reports `unrecoverable_pre_p170 > 0` (manual relink of pre-P170 orphans).

## Commit
`Prompts/prompt-241-multiload-bol-job-id-orphans.md` committed alongside the change, on `main`.
