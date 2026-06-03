# P96 — F4a: R2 migration blob inventory (`/r2-migration-inventory.md`)

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **db-api-agent**. Foundation Roadmap **Phase F4a** — the unblocker that drives F4c/F4d order. **Read-only investigation + one new doc. No code changes, no schema changes.**

D1's 500MB ceiling is the existential constraint; base64 inflates stored files ~33%. This prompt produces the authoritative inventory of every base64/blob column still living in D1, so the migration order is driven by data, not guesswork.

## What to produce

Create **`/r2-migration-inventory.md`** at the repo root. For every column in the schema that stores base64 or large blob TEXT, list:
- Table.column
- What it stores (PDF, image, etc.) and which handler writes/reads it
- Current status: `in D1` or `already on R2`
- A ready-to-run SQL snippet (for Steve to execute in the D1 console) to get row count and estimated bytes

## Known targets (verify against the live code, do not assume this is complete)

Enumerate by scanning `DB Migrations/*.sql` and `_worker.js` for base64/blob columns. Confirmed so far:

| Table.column | Stores | Handler | Status |
|---|---|---|---|
| `loading_photos.photo_data` | loading photos (base64 image) | `handleApiLoadingPhotos` (POST ~4596 / GET ~4566) | **in D1** → F4c |
| `jobs.packing_slip_pdf` | packing slip PDF (base64) | `handleApiJobs` (POST ~1942 / GET `/packing-slip` ~1771) | **in D1** → F4d |
| `bols.signed_bol_photo_key` | signed BOL photo | P83 driver flow (R2 put ~5139 / serve ~3219) | **already on R2** (reference, not blob) |

Scan for any others — e.g. a base64 PDF on `completions` (QC final inspection; the agent file notes inspection PDFs are generated client-side, so confirm whether any are persisted), or any `*_base64` / `*_pdf` / `*_data` TEXT column anywhere. Report each found (or explicitly note "none beyond the above").

## SQL snippets to embed in the doc (Steve runs these manually in the D1 console — Claude Code does NOT run them)

For each in-D1 blob column, include the equivalent of:
```sql
-- loading_photos.photo_data
SELECT COUNT(*) AS rows,
       SUM(LENGTH(photo_data)) AS total_base64_bytes,
       ROUND(SUM(LENGTH(photo_data)) / 1048576.0, 1) AS approx_MB
FROM loading_photos
WHERE photo_data IS NOT NULL AND photo_data != '';
```
```sql
-- jobs.packing_slip_pdf
SELECT COUNT(*) AS rows,
       SUM(LENGTH(packing_slip_pdf)) AS total_base64_bytes,
       ROUND(SUM(LENGTH(packing_slip_pdf)) / 1048576.0, 1) AS approx_MB
FROM jobs
WHERE packing_slip_pdf IS NOT NULL AND packing_slip_pdf != '';
```

## Recommendation section

End the doc with a recommended migration order (largest D1 consumer first) and confirm the existing `BOL_PHOTOS` bucket can be reused with key prefixes (`loading-photos/`, `packing-slips/`) so F4c/F4d require no new bucket or `wrangler.toml` change. Flag any column F4c/F4d don't already cover as a new **F4e** follow-up.

## What NOT to change
- Any code, schema, or data. This phase only inventories and documents. The base64 columns stay exactly as they are until F4c/F4d.
