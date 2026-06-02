# Prompt 82 — BOL Tracking (P1 of 3): Access Tokens + QR Code + Public Route Infrastructure

## Agents to assume

**Read BOTH `AGENTS.md` AND `xpanda-ops-agents.md`.** Assume:
- **Lead: db-api-agent** — migration, token generation, public route surface, auth gate carve-out, lookup endpoint.
- **Coordinating with: logistics-agent** — QR code on the BOL PDF via `bol-shared.js`; CDN library wiring in `bol-generator.html` and `load-builder.html`.

## Context

Three-phase BOL tracking feature. Drivers scan a QR code on the printed BOL → public web page → first scan confirms pickup (sets shipment `in_transit`), second scan opens the delivery flow (questions + signed-BOL photo). After delivery completes, the link self-expires. This is P1 of 3 — pure infrastructure. The driver-facing pages and state-transition POST endpoints land in **P83**. Push notification wiring lands in **P84**.

**P82 ships:** the access token column + auto-generation on BOL save, the public route surface (no auth required), the read-only lookup endpoint, and the QR code on the BOL PDF. Verifiable end-to-end by printing a BOL, scanning the QR, and hitting a `Loading…` placeholder page that successfully calls the public lookup endpoint.

---

## Part 1 — Migration

Create `DB Migrations/add-bol-access-token.sql`:

```sql
-- BOL tracking: per-BOL access token for the driver QR code (P82).
-- 32 hex chars (128 bits entropy). NULL on legacy rows; auto-filled on next save.
ALTER TABLE bols ADD COLUMN access_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bols_access_token ON bols(access_token) WHERE access_token IS NOT NULL;
```

Steve runs this manually in the Cloudflare D1 Dashboard Console.

---

## Part 2 — Worker changes (`_worker.js`)

### 2a. Token generator helper

Add near the top of the worker, alongside other helpers:

```javascript
function generateAccessToken() {
  const bytes = new Uint8Array(16); // 128 bits
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
```

### 2b. Auto-generate token on BOL POST and PUT

In `POST /api/bols` (around line ~3288), after the existing payload extraction and before the INSERT, add:

```javascript
const access_token = payload.access_token || generateAccessToken();
```

Add `access_token` to the INSERT column list and bind position (parallel to how P68's `render_overrides` was added).

In `PUT /api/bols/:id` (around line ~3346), after extracting payload, generate a token if the existing row doesn't have one:

```javascript
// Legacy BOLs without a token get one on next edit. New tokens override never —
// the token is permanent for a given BOL until the shipment is delivered.
let access_token = existing.access_token;
if (!access_token) access_token = generateAccessToken();
```

Add `access_token = ?` to the UPDATE SET clause and bind. **Important:** unlike `render_overrides`, this column must always be written on PUT — the column either has the existing value or a freshly minted one for legacy rows. Never set to null.

### 2c. Auth gate carve-out for public routes

In the worker's auth gate (around lines ~120–160 where static asset short-circuits and the login redirect live), add carve-outs for the new public surfaces. Place these **before** the auth gate redirect logic, alongside the existing `/login.html` and `/sw.js` carve-outs:

```javascript
// Public BOL tracking surface (no auth — drivers aren't platform users).
if (url.pathname === '/track' || url.pathname.startsWith('/track/')) {
  return env.ASSETS.fetch(request);
}
if (url.pathname.startsWith('/api/public/')) {
  // fall through to API dispatch; handler enforces its own access via token
}
```

The first block returns the static asset (the driver page). The second block is a comment-only marker — the API dispatch table picks up `/api/public/*` routes naturally once they're registered. The point is: the auth gate must NOT redirect or 401 on `/api/public/*` paths.

Look at the existing gate logic: it currently redirects unauthenticated requests to `/login.html`. Add `/api/public/` and `/track/` to whatever escape list governs that (likely the existing `ESCAPE_PREFIXES` const around line 153, or wherever public paths are allowlisted).

### 2d. Lookup endpoint

Add a new handler `handleApiPublicBolLookup(request, env)`:

```javascript
async function handleApiPublicBolLookup(request, env) {
  const url = new URL(request.url);
  const token = url.pathname.replace('/api/public/bol-lookup/', '').replace(/\/$/, '');
  if (!token || token.length < 8) {
    return json({ ok: false, error: 'Invalid token' }, 400);
  }

  const db = env.DB;
  const bol = await db.prepare(`
    SELECT bol_number, date, ship_to_company, ship_to_attention, ship_to_street, ship_to_street2,
           ship_to_city, ship_to_state, ship_to_zip, commodity_description, delivery_time,
           carrier_name, trailer_no, job_id, access_token
    FROM bols WHERE access_token = ?
  `).bind(token).first();

  if (!bol) {
    return json({ ok: false, error: 'expired_or_invalid' }, 404);
  }

  // Compute stage from the linked shipment's status (via job_id → shipments).
  let stage = 'issued';
  if (bol.job_id) {
    const shipment = await db.prepare(
      "SELECT status FROM shipments WHERE job_id = ? ORDER BY created_at DESC LIMIT 1"
    ).bind(bol.job_id).first();
    if (shipment) {
      if (shipment.status === 'in_transit') stage = 'in_transit';
      else if (shipment.status === 'delivered') stage = 'delivered';
    }
  }

  // If delivered, return minimal completed payload (don't leak fresh details).
  if (stage === 'delivered') {
    return json({ ok: true, bol: { stage: 'delivered', bol_number: bol.bol_number } });
  }

  // Don't leak the token back; the caller already has it.
  delete bol.access_token;
  return json({ ok: true, bol: { ...bol, stage } });
}
```

### 2e. Register in the F2 route table

In the `API_ROUTES` array, add (place near the auth routes or in a new "Public" section):

```javascript
// Public — no auth required (gated only by unguessable access_token).
{ prefix: '/api/public/bol-lookup', handler: (req, env) => handleApiPublicBolLookup(req, env) },
```

---

## Part 3 — Placeholder `/track/` static asset

Create `track/index.html`. This is a one-page SPA that resolves the token from the URL and shows a placeholder for now. **P83 replaces this file fully** with the real driver pages — but a placeholder ships in P82 so the QR scan loop is verifiable end-to-end.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>BOL Tracking — xPanda</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="/assets/img/favicon.png" sizes="any">
<style>
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f2f5; color: #111827; padding: 24px; min-height: 100vh; box-sizing: border-box; }
  .card { max-width: 480px; margin: 40px auto; background: #fff; border-radius: 16px; padding: 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
  h1 { margin: 0 0 16px 0; font-size: 22px; }
  .muted { color: #6b7280; font-size: 14px; line-height: 1.5; }
  .err { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; padding: 12px; border-radius: 8px; }
</style>
</head>
<body>
<div class="card">
  <h1>BOL Tracking</h1>
  <div id="status" class="muted">Loading…</div>
</div>
<script>
(async function () {
  const token = location.pathname.replace(/^\/track\/?/, '').replace(/\/$/, '');
  const statusEl = document.getElementById('status');
  if (!token) {
    statusEl.innerHTML = '<div class="err">No tracking token in URL.</div>';
    return;
  }
  try {
    const res = await fetch('/api/public/bol-lookup/' + encodeURIComponent(token));
    const data = await res.json();
    if (!res.ok || !data.ok) {
      statusEl.innerHTML = '<div class="err">' + (data.error === 'expired_or_invalid'
        ? 'This tracking link is no longer active. The shipment has been delivered or the link is invalid.'
        : 'Unable to load shipment details. Please try again later.') + '</div>';
      return;
    }
    // P82 placeholder: just show the BOL number and stage.
    // P83 replaces this with the real pickup-confirmation and delivery flows.
    statusEl.innerHTML = '<p><strong>BOL #' + (data.bol.bol_number || '—') + '</strong></p>'
      + '<p>Stage: ' + data.bol.stage + '</p>'
      + '<p class="muted">Driver-facing flow shipping in next deploy.</p>';
  } catch (e) {
    statusEl.innerHTML = '<div class="err">Network error. Please check your connection.</div>';
  }
})();
</script>
</body>
</html>
```

This page is intentionally minimal — proof of concept that the token resolves and the public route works. P83 replaces it entirely.

---

## Part 4 — QR code on the BOL PDF (`logistics/bol-shared.js`)

### 4a. Load the QR library in the two BOL host pages

In `logistics/bol-generator.html`, find the existing pdf-lib script tag (around line 14):

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js"></script>
```

Add immediately after:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
```

Do the same in `logistics/load-builder.html` next to its pdf-lib tag.

`qrcode-generator` by Kazuhiko Arase is a no-DOM library: it generates a module matrix that we draw directly with pdf-lib primitives. ~30KB. Version pinned for reproducibility.

### 4b. New COORDS entry

In the `COORDS` object in `bol-shared.js`, add:

```javascript
    // QR code — driver tracking link (P82). Drawn only when bol.access_token exists.
    qrCode: { x: 510, y: 50, size: 70 },  // bottom-right corner; size is total px box (square)
```

**Starting position is tunable.** Bottom-right corner (x=510, y=50 baseline = 70pt square reaching to y=120) avoids the signature blocks but may need adjustment after the first test print. The QR is square; `size` is its edge length in points.

### 4c. Draw the QR in `generatePdf`

In the per-BOL render loop in `generatePdf`, after the existing draws (commodity, scrap, etc.) and before the loop ends, add:

```javascript
      // ── QR code (driver tracking link) ──
      if (bol.access_token && typeof qrcode === 'function') {
        const trackingUrl = `${window.location.origin}/track/${bol.access_token}`;
        // Type 0 = auto-select smallest version that fits; 'M' = medium error correction.
        const qr = qrcode(0, 'M');
        qr.addData(trackingUrl);
        qr.make();
        const modules = qr.getModuleCount();
        const cellSize = COORDS.qrCode.size / modules;
        for (let r = 0; r < modules; r++) {
          for (let c = 0; c < modules; c++) {
            if (qr.isDark(r, c)) {
              page.drawRectangle({
                x: COORDS.qrCode.x + c * cellSize,
                y: COORDS.qrCode.y + (modules - 1 - r) * cellSize, // flip Y (pdf-lib origin is bottom-left)
                width: cellSize,
                height: cellSize,
                color: black,
              });
            }
          }
        }
      }
```

**Notes:**
- The `typeof qrcode === 'function'` guard means BOLs still render if the QR lib failed to load (defensive — never break BOL generation over a QR issue).
- `window.location.origin` gives the correct host whether on prod, staging, or local dev.
- The QR is drawn as filled rectangles per dark module — no image embedding needed.
- A 70pt QR at typical 25-module density renders ~2.8pt per cell. Crisp at print size.

### 4d. Override path doesn't carry the QR

The override render mode (P68) doesn't need to know about the QR — the QR is drawn unconditionally per-BOL based on `access_token`, regardless of which fields were overridden. The QR draw block above sits outside the override-aware field rendering and runs for every BOL with a token. Confirm by placing it after all field draws (override or not) in the per-BOL section of `generatePdf`.

---

## Scope (strict)

- **Files touched (6 total):** new migration `add-bol-access-token.sql`; new placeholder `track/index.html`; edits to `_worker.js`, `logistics/bol-shared.js`, `logistics/bol-generator.html`, `logistics/load-builder.html`.
- Do NOT add state-transition POST endpoints (those land in P83 with the driver pages).
- Do NOT add push notifications (those land in P84).
- Do NOT touch any other module.
- Do NOT modify `BolEditor` (the inline editor doesn't need to render QR — the preview iframe shows it via the regenerated PDF).

## Manual steps after build

1. Run `DB Migrations/add-bol-access-token.sql` in the Cloudflare D1 Dashboard Console.
2. Commit and deploy.
3. **Backfill existing BOLs (optional, recommended):** open any BOL that lacks a token, click Save (no other changes) — the PUT handler auto-generates a token. Alternatively, run a one-time SQL update in the D1 console:
   ```sql
   -- Caution: only run this if you've reviewed the worker's token format expectations.
   -- For simplicity, leave legacy BOLs untouched; they'll get tokens as they're touched.
   ```
   (Recommendation: leave legacy BOLs untokenized — they get tokens organically as edits flow through.)
4. Verify:
   - Generate a new BOL via the BOL generator. Print/preview it — a QR code appears in the bottom-right corner.
   - Scan the QR with a phone. Browser opens to `/track/<token>` and shows the placeholder card with the BOL number and stage (likely `issued` initially).
   - Try `/track/garbage` directly — should show "tracking link is no longer active."
   - In an incognito window (signed out), visit `/track/<valid-token>` — page loads, no redirect to login. Visit `/jobs/` — redirects to login as expected.
5. The QR position may need a coord nudge after first print — adjust `COORDS.qrCode.x/y/size`.

## After this lands

**P83** replaces `track/index.html` with the real driver pages:
- Stage `issued` → summary view (ship-to, BOL #, line items) + Confirm Pickup button → POST flips shipment to `in_transit`.
- Stage `in_transit` → delivery questions (accepted: yes/no/partial; damages: yes/no + notes) + signed-BOL photo upload to R2 (the F4 pilot) → POST flips shipment to `delivered`, kills the token effectively.

**P84** wires push notification on delivery completion: any user with the new `bol_delivered` notification type enabled receives a push when a driver completes a delivery. Uses the existing `sendPushNotification` helper.
