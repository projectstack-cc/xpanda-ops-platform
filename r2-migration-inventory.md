# R2 Migration Inventory — xPanda Ops Platform
_F4a: authoritative inventory of D1 base64/blob columns. Generated 2026-06-03._

---

## Inventory

| Table.column | Stores | Handler | Status |
|---|---|---|---|
| `loading_photos.photo_data` | Loading dock photos (base64 PNG/JPEG) | `handleApiLoadingPhotos` POST ~4665 / GET ~4638 | **in D1** → F4c (P97) ✅ |
| `jobs.packing_slip_pdf` | Packing slip PDF (base64) | `handleApiJobs` POST ~1942 / PUT ~2142 / GET `/packing-slip` ~1771 | **in D1** → F4d (P98) ✅ |
| `bols.signed_bol_photo_key` | Signed BOL delivery photo | P83 driver flow — R2 put ~5139 / serve ~3283 | **already on R2** (key reference only, no blob in D1) |

### Scanned and confirmed NOT storing blobs

| Table / area | Notes |
|---|---|
| `completions` | Safety training completion records — no file columns |
| `scrap_log` | Scrap event entries — no file columns |
| `bols` | Stores `render_overrides` JSON (text, small) and `signed_bol_photo_key` (R2 key) — no base64 blob |
| `loading_assignments` | Status/metadata only |
| `shipments` | Status/metadata, delivery notes |
| `jobs` (other columns) | `packing_slip_filename` and `packing_slip_invoice` are plain text, not blobs |
| `block_inventory`, `molding_log`, `bead_stock` | Inventory records — no file columns |

---

## SQL snippets (Steve runs in the D1 console — do NOT run via Claude Code)

```sql
-- loading_photos.photo_data
SELECT COUNT(*) AS rows,
       SUM(LENGTH(photo_data)) AS total_base64_bytes,
       ROUND(SUM(LENGTH(photo_data)) / 1048576.0, 1) AS approx_MB
FROM loading_photos
WHERE photo_data IS NOT NULL AND LENGTH(photo_data) > 10;
```

```sql
-- jobs.packing_slip_pdf
SELECT COUNT(*) AS rows,
       SUM(LENGTH(packing_slip_pdf)) AS total_base64_bytes,
       ROUND(SUM(LENGTH(packing_slip_pdf)) / 1048576.0, 1) AS approx_MB
FROM jobs
WHERE packing_slip_pdf IS NOT NULL AND packing_slip_pdf != '';
```

```sql
-- Combined D1 blob usage estimate
SELECT
  'loading_photos' AS source,
  COUNT(*) AS rows,
  ROUND(SUM(LENGTH(photo_data)) / 1048576.0, 1) AS approx_MB
FROM loading_photos WHERE photo_data IS NOT NULL AND LENGTH(photo_data) > 10
UNION ALL
SELECT
  'jobs.packing_slip_pdf',
  COUNT(*),
  ROUND(SUM(LENGTH(packing_slip_pdf)) / 1048576.0, 1)
FROM jobs WHERE packing_slip_pdf IS NOT NULL AND packing_slip_pdf != '';
```

---

## Recommended migration order

Migrate largest D1 consumer first (run each SQL snippet above to determine actual sizes before migrating):

1. **`loading_photos.photo_data`** (F4c / P97) — loading dock photos are likely the largest consumer; each photo is a compressed JPEG from a mobile camera. **Completed in P97.**
2. **`jobs.packing_slip_pdf`** (F4d / P98) — packing slip PDFs (one per job). **Completed in P98.**

### Bucket reuse

Both F4c and F4d reuse the existing `BOL_PHOTOS` R2 bucket (already bound in `wrangler.toml`) with key prefixes:
- `loading-photos/` — loading dock photos
- `packing-slips/` — packing slip PDFs
- `signed-bols/` — signed BOL delivery photos (existing, P83)

**No new bucket or `wrangler.toml` change is needed for either migration.**

### Post-migration column drops (manual — Steve runs after verifying backfill)

```sql
-- Only after POST /api/admin/r2-backfill?type=loading-photos returns remaining=0
-- and images are verified:
ALTER TABLE loading_photos DROP COLUMN photo_data;

-- Only after POST /api/admin/r2-backfill?type=packing-slips returns remaining=0
-- and slips are verified:
ALTER TABLE jobs DROP COLUMN packing_slip_pdf;
```

### Remaining F4e candidates

None identified beyond the above. All other tables examined contain only text metadata, JSON blobs (small), or R2 key references. No additional `F4e` follow-up is required.
