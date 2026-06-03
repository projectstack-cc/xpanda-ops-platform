# P98 — F4d: Packing slips → R2 (`jobs.packing_slip_pdf`)

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **db-api-agent** (lead) and **job-board-agent**, with **admin-auth-agent** for the backfill gate. Foundation Roadmap **Phase F4d**. Same pattern as P97 (F4c) — apply it to packing slips. **Run P96 (F4a) first.** Reuse the `BOL_PHOTOS` bucket with a `packing-slips/` key prefix; no new bucket, no `wrangler.toml` change.

Same fallback + backfill design: new uploads to R2, serve prefers R2 key with legacy base64 fallback, one-time admin backfill, drop the column later/manually.

## 1. Migration — Steve runs MANUALLY in the D1 console. Claude Code must NOT run it.
```sql
-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.
ALTER TABLE jobs ADD COLUMN packing_slip_key TEXT;
```

## 2. Worker — write path (`handleApiJobs`, `_worker.js`)
Packing slips are set both on **create** (~1942, `packing_slip_pdf` from payload) and potentially on **update** — handle both. When a packing slip PDF is provided:
- Decode base64 → bytes → `env.BOL_PHOTOS.put(`packing-slips/${jobId}.pdf`, bytes, { httpMetadata: { contentType: 'application/pdf' } })`.
- Store `packing_slip_key` and set `packing_slip_pdf` NULL. Keep `packing_slip_filename` / `packing_slip_invoice` as-is.
- try/catch around the put; failure shouldn't silently drop the slip.
- The list-columns query (~1759) already excludes `packing_slip_pdf` — keep it excluded. Return `packing_slip_key` (or a boolean) so the 📄 icon logic still knows a slip exists.

## 3. Worker — serve path (`GET /api/jobs/:id/packing-slip`, ~1771)
- If `packing_slip_key` present → `env.BOL_PHOTOS.get(key)` → stream with `Content-Type: application/pdf`, the existing `Content-Disposition: inline; filename="..."`, and `Cache-Control: private, max-age=3600`.
- **Fallback:** if `packing_slip_key` is NULL but `packing_slip_pdf` exists → decode the legacy base64 and stream it (preserves the current behavior for un-backfilled jobs).

## 4. Backfill — extend the P97 admin endpoint
Extend `POST /api/admin/r2-backfill` to also accept `?type=packing-slips`:
- Select up to N jobs where `packing_slip_key IS NULL AND packing_slip_pdf IS NOT NULL AND packing_slip_pdf != ''`.
- For each: decode → R2 put under `packing-slips/${jobId}.pdf` → `UPDATE jobs SET packing_slip_key = ?, packing_slip_pdf = NULL WHERE id = ?`.
- Return `{ ok, migrated, remaining }`; admin-gated; idempotent.

## 5. Deferred (note to Steve, do NOT do now)
After backfill shows `remaining = 0` and slips verified, Steve runs manually: `ALTER TABLE jobs DROP COLUMN packing_slip_pdf;`

## What NOT to change
- Auto-pack. `STORAGE_KEY`. The packing-slip **parser** (`packing-slip-parser.js`) — this is storage only, not parsing. The packing-slip upload UX. Do not add a new R2 bucket or edit `wrangler.toml`. Keep the base64 fallback until the column is dropped.
