# P97 — F4c: Loading photos → R2 (`loading_photos.photo_data`)

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **db-api-agent** (lead), **logistics-agent**, and **admin-auth-agent** (backfill gate). Foundation Roadmap **Phase F4c** — likely the largest D1 consumer. **Run P96 (F4a) first** to confirm no other blob columns hide here; if F4a surfaced extras, they become a separate F4e prompt.

Follows the proven P83 R2 pattern exactly (`atob` → bytes → `env.BOL_PHOTOS.put(key, bytes, { httpMetadata })`; serve via `env.BOL_PHOTOS.get(key)` streaming). Reuse the existing `BOL_PHOTOS` bucket with a `loading-photos/` key prefix — **no new bucket, no `wrangler.toml` change.**

Design goal: **nothing breaks mid-migration.** New uploads go to R2; the serve path prefers the R2 key and falls back to legacy base64; a one-time admin backfill moves old rows; the base64 column is dropped only later, manually, after verification.

## 1. Migration — Steve runs MANUALLY in the D1 console. Claude Code must NOT run it.
```sql
-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.
ALTER TABLE loading_photos ADD COLUMN photo_key TEXT;
```

## 2. Worker — write path (`handleApiLoadingPhotos` POST, `_worker.js` ~4596)
- Keep the presence/validation checks. After validating, decode base64 → bytes and `env.BOL_PHOTOS.put(`loading-photos/${assignment_id}/${id}.${ext}`, bytes, { httpMetadata: { contentType } })` (derive ext/contentType from the data: PNG if it starts with `iVBOR`, else JPEG — mirror the gallery's existing sniff).
- INSERT with `photo_key` set and **`photo_data` NULL** (stop writing base64 to D1).
- Wrap the R2 put in try/catch returning a 500 `photo_upload_failed` like P83. Keep the `logActivity('create','loading_photo', ...)` call.
- The ~1.5MB guard existed only because of D1; R2 handles larger objects. You may raise it to a sane mobile ceiling (e.g. ~10MB) but keep a guard.

## 3. Worker — serve path (new endpoint)
Add `GET /api/loading-photos/:id/image` that:
- Looks up the row; if `photo_key` present → `env.BOL_PHOTOS.get(photo_key)` and stream bytes (`Content-Type` from `httpMetadata`, `Cache-Control: private, max-age=300`) — same shape as the BOL signed-photo serve (~3219).
- **Fallback:** if `photo_key` is NULL but `photo_data` exists → decode the legacy base64 and stream it. This keeps un-backfilled rows working.
- Register the route prefix so it sits under the existing `logistics.loading` gate.

Also: the single-row GET (~4566) currently returns `photo_data`; stop returning the (now usually null) base64 blob in that payload — return metadata + a boolean like `has_image` instead, so the list/lightbox stop shipping base64 over the wire.

## 4. Frontend — `/shared/photo-gallery.js`
Today thumbnails and the lightbox call `fetchPhoto(id)` and build `data:` URLs from `photo.photo_data` (~lines 60–63, 112). Replace both with a direct image src:
```js
img.src = '/api/loading-photos/' + encodeURIComponent(id) + '/image';
```
Drop the per-id base64 fetch/cache used only to obtain `photo_data` (keep any metadata fetch the list genuinely needs). This both completes the migration and removes a real mobile perf drag.

## 5. One-time backfill endpoint (Claude Code CAN build this — it's runtime, not a D1 migration)
Add an **admin-only** `POST /api/admin/r2-backfill?type=loading-photos` (gate on `X-User-Is-Admin === '1'`) that:
- Selects up to N rows (e.g. 50) where `photo_key IS NULL AND photo_data IS NOT NULL AND photo_data != ''`.
- For each: decode base64 → R2 put under `loading-photos/...` → `UPDATE loading_photos SET photo_key = ?, photo_data = NULL WHERE id = ?`.
- Returns `{ ok, migrated, remaining }` so Steve can call it repeatedly until `remaining = 0`.
- Idempotent and safe to re-run. `logActivity` a summary.

## 6. Deferred (note to Steve, do NOT do now)
After backfill shows `remaining = 0` and images verified, Steve runs manually: `ALTER TABLE loading_photos DROP COLUMN photo_data;`

## What NOT to change
- Auto-pack. `STORAGE_KEY`. The P83 BOL signed-photo flow. The loading dashboard's assignment logic. Do not add a new R2 bucket or edit `wrangler.toml`. Keep the legacy base64 fallback until the column is dropped.
