# Prompt 83 — BOL Tracking (P2 of 3): Driver Flow + R2 Signed-BOL Photo (F4 Pilot)

## Agents to assume

**Read BOTH `AGENTS.md` AND `xpanda-ops-agents.md`.** Assume:
- **Lead: db-api-agent** — migration, R2 binding, state-transition endpoints, public + internal photo serving.
- **Coordinating with: logistics-agent** — driver-facing `track/index.html` (full rewrite), signed-BOL surface inside the logistics shipment modal.

## Context

P82 shipped: per-BOL access tokens, QR code on the printed BOL, public route surface, lookup endpoint, and a placeholder `track/index.html`. P83 makes it real: the driver scans the QR → confirms pickup → later confirms delivery with a photo of the signed BOL → photo lands in R2 (not D1), shipment marked delivered, token effectively dead.

This is also the **F4 pilot**: first blob type living in R2 instead of D1 base64. The pattern established here — `env.R2.put/get` plus a `<blob>_key TEXT` column on the owning row — is what loading photos and packing slips migrate to in subsequent F4 phases.

**Push notification on delivery is P84.** A `TODO(P84)` comment marker goes where the push hook will land.

---

## Part 1 — R2 binding

### 1a. Create the bucket (Steve, manual)

In the Cloudflare dashboard, create an R2 bucket if it doesn't exist. Suggested name: `xpanda-bol-photos`. **This is a one-time setup Steve does in the dashboard, not via Claude Code.**

### 1b. Update `wrangler.toml`

Add the R2 binding to both the default and `[env.production]` sections (mirroring the D1 pattern already in the file):

```toml
[[r2_buckets]]
binding = "BOL_PHOTOS"
bucket_name = "xpanda-bol-photos"

[[env.production.r2_buckets]]
binding = "BOL_PHOTOS"
bucket_name = "xpanda-bol-photos"
```

If Steve names the bucket differently, the `bucket_name` lines change but the `binding = "BOL_PHOTOS"` identifier stays — that's what the worker code references.

---

## Part 2 — Migration

Create `DB Migrations/add-signed-bol-and-delivery-meta.sql`:

```sql
-- P83: signed-BOL photo (R2 reference) + delivery metadata.

-- BOL: R2 key + upload timestamp for the signed photo.
ALTER TABLE bols ADD COLUMN signed_bol_photo_key TEXT;
ALTER TABLE bols ADD COLUMN signed_bol_uploaded_at TEXT;

-- Shipment: delivery-flow capture from the driver QR.
ALTER TABLE shipments ADD COLUMN delivery_accepted TEXT;        -- 'yes' | 'no' | 'partial'
ALTER TABLE shipments ADD COLUMN delivery_damages INTEGER DEFAULT 0;
ALTER TABLE shipments ADD COLUMN delivery_damage_notes TEXT;
ALTER TABLE shipments ADD COLUMN delivery_recorded_at TEXT;
ALTER TABLE shipments ADD COLUMN delivery_source TEXT;          -- 'driver_qr' for QR-flow deliveries
```

Run manually in D1 console.

---

## Part 3 — Worker: public state-transition endpoints

### 3a. Pickup endpoint

```javascript
async function handleApiPublicBolPickup(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);
  const url = new URL(request.url);
  const token = url.pathname.replace('/api/public/bol-pickup/', '').replace(/\/$/, '');
  if (!token || token.length < 8) return json({ ok: false, error: 'Invalid token' }, 400);

  const db = env.DB;
  const bol = await db.prepare("SELECT job_id, bol_number FROM bols WHERE access_token = ?").bind(token).first();
  if (!bol) return json({ ok: false, error: 'expired_or_invalid' }, 404);

  // Locate the latest shipment linked to this BOL's job.
  const shipment = await db.prepare(
    "SELECT id, status FROM shipments WHERE job_id = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(bol.job_id).first();
  if (!shipment) return json({ ok: false, error: 'no_shipment_linked' }, 404);

  // Idempotency: already in_transit or beyond → return success but report current stage.
  if (shipment.status === 'in_transit' || shipment.status === 'delivered') {
    return json({ ok: true, stage: shipment.status, already: true });
  }

  const now = new Date().toISOString();
  await db.prepare(
    "UPDATE shipments SET status = 'in_transit', in_transit_at = ?, updated_at = ? WHERE id = ?"
  ).bind(now, now, shipment.id).run();

  // Mirror to loading_assignments if present (Logistics dashboard surfaces this).
  await db.prepare(
    "UPDATE loading_assignments SET loading_status = 'in_transit', updated_at = ? WHERE job_id = ? AND loading_status != 'archived'"
  ).bind(now, bol.job_id).run();

  await logActivity(env, null, 'pickup_confirmed', 'shipment', shipment.id, { source: 'driver_qr', bol_number: bol.bol_number });

  return json({ ok: true, stage: 'in_transit' });
}
```

### 3b. Delivery endpoint

```javascript
async function handleApiPublicBolDelivery(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);
  const url = new URL(request.url);
  const token = url.pathname.replace('/api/public/bol-delivery/', '').replace(/\/$/, '');
  if (!token || token.length < 8) return json({ ok: false, error: 'Invalid token' }, 400);

  let payload;
  try { payload = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  // Validate inputs.
  const accepted = payload.accepted;
  if (!['yes', 'no', 'partial'].includes(accepted)) {
    return json({ ok: false, error: 'accepted must be yes|no|partial' }, 400);
  }
  const damages = !!payload.damages;
  const damageNotes = damages ? String(payload.damage_notes || '').slice(0, 2000) : null;
  const photoBase64 = String(payload.signed_photo_base64 || '');
  if (!photoBase64 || photoBase64.length < 100) {
    return json({ ok: false, error: 'signed_photo_base64 is required' }, 400);
  }
  // Cap upload at ~3MB base64 (~2.2MB decoded). Driver photos should be resized client-side.
  if (photoBase64.length > 3 * 1024 * 1024) {
    return json({ ok: false, error: 'Photo too large; please retake.' }, 413);
  }

  const db = env.DB;
  const bol = await db.prepare("SELECT id, job_id, bol_number FROM bols WHERE access_token = ?").bind(token).first();
  if (!bol) return json({ ok: false, error: 'expired_or_invalid' }, 404);

  const shipment = await db.prepare(
    "SELECT id, status FROM shipments WHERE job_id = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(bol.job_id).first();
  if (!shipment) return json({ ok: false, error: 'no_shipment_linked' }, 404);

  if (shipment.status === 'delivered') {
    return json({ ok: true, stage: 'delivered', already: true });
  }
  // Must be in_transit before a delivery POST is valid.
  if (shipment.status !== 'in_transit') {
    return json({ ok: false, error: 'shipment must be in_transit before delivery' }, 409);
  }

  // Decode base64 → bytes → R2 put.
  const photoBytes = Uint8Array.from(atob(photoBase64), c => c.charCodeAt(0));
  const r2Key = `signed-bols/${bol.id}/${Date.now()}.jpg`;
  try {
    await env.BOL_PHOTOS.put(r2Key, photoBytes, {
      httpMetadata: { contentType: 'image/jpeg' },
    });
  } catch (e) {
    return json({ ok: false, error: 'photo_upload_failed', detail: String(e?.message || e) }, 500);
  }

  const now = new Date().toISOString();

  // Update shipment + BOL + loading assignment atomically-as-possible (D1 has no multi-row tx; sequential is acceptable).
  await db.prepare(`
    UPDATE shipments SET
      status = 'delivered',
      delivered_at = ?,
      delivery_accepted = ?,
      delivery_damages = ?,
      delivery_damage_notes = ?,
      delivery_recorded_at = ?,
      delivery_source = 'driver_qr',
      updated_at = ?
    WHERE id = ?
  `).bind(now, accepted, damages ? 1 : 0, damageNotes, now, now, shipment.id).run();

  await db.prepare(
    "UPDATE bols SET signed_bol_photo_key = ?, signed_bol_uploaded_at = ? WHERE id = ?"
  ).bind(r2Key, now, bol.id).run();

  await db.prepare(
    "UPDATE loading_assignments SET loading_status = 'delivered', updated_at = ? WHERE job_id = ? AND loading_status != 'archived'"
  ).bind(now, bol.job_id).run();

  await logActivity(env, null, 'delivery_completed', 'shipment', shipment.id, {
    source: 'driver_qr', bol_number: bol.bol_number, accepted, damages, photo_key: r2Key
  });

  // TODO(P84): trigger push notification to subscribers of 'bol_delivered'.

  return json({ ok: true, stage: 'delivered' });
}
```

### 3c. Internal signed-photo read

The internal photo read is gated by the existing `logistics.bol` permission. Add a new branch inside `handleApiBols` for the path `/api/bols/:id/signed-photo`:

```javascript
// Inside handleApiBols, near the top after parsing the path:
const signedPhotoMatch = url.pathname.match(/^\/api\/bols\/([^\/]+)\/signed-photo$/);
if (signedPhotoMatch) {
  const bolId = signedPhotoMatch[1];
  const row = await env.DB.prepare(
    "SELECT signed_bol_photo_key FROM bols WHERE id = ?"
  ).bind(bolId).first();
  if (!row?.signed_bol_photo_key) return new Response('Not found', { status: 404 });
  const obj = await env.BOL_PHOTOS.get(row.signed_bol_photo_key);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=300',
    },
  });
}
```

Place this branch **before** any existing path matching in `handleApiBols` so it takes priority. The existing `/api/bols` / `/api/bols/:id` GET/POST/PUT/DELETE handling stays unchanged.

### 3d. Register public endpoints in the F2 route table

In the `API_ROUTES` array, add alongside the existing public lookup route:

```javascript
{ prefix: '/api/public/bol-pickup',   handler: (req, env) => handleApiPublicBolPickup(req, env) },
{ prefix: '/api/public/bol-delivery', handler: (req, env) => handleApiPublicBolDelivery(req, env) },
```

The existing public-route auth carve-out from P82 (`/api/public/` bypass) already covers these.

---

## Part 4 — Driver page (full rewrite of `track/index.html`)

Replace the entire P82 placeholder with the real driver SPA. Three stages rendered based on the lookup response: `issued` (pickup), `in_transit` (delivery), `delivered` (done).

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>BOL Tracking — xPanda</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="/assets/img/favicon.png" sizes="any">
<style>
  :root { --primary: #1e40af; --success: #15803d; --danger: #b91c1c; --muted: #6b7280; --border: #d1d5db; --bg: #f0f2f5; --card: #ffffff; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: #111827; padding: 16px; min-height: 100vh; }
  .wrap { max-width: 520px; margin: 16px auto; }
  .card { background: var(--card); border-radius: 16px; padding: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); margin-bottom: 16px; }
  h1 { margin: 0 0 8px 0; font-size: 22px; }
  h2 { margin: 16px 0 8px 0; font-size: 16px; color: var(--muted); }
  .muted { color: var(--muted); font-size: 14px; line-height: 1.5; }
  .row { display: flex; gap: 8px; margin-bottom: 8px; font-size: 14px; }
  .row .label { min-width: 110px; color: var(--muted); font-weight: 600; }
  .btn { display: block; width: 100%; padding: 16px; border-radius: 12px; border: none; font-size: 16px; font-weight: 700; cursor: pointer; margin-top: 16px; }
  .btn-primary { background: var(--primary); color: #fff; }
  .btn-primary:disabled { opacity: 0.6; cursor: wait; }
  .btn-success { background: var(--success); color: #fff; }
  .err { background: #fef2f2; color: var(--danger); border: 1px solid #fecaca; padding: 12px; border-radius: 8px; }
  .ok { background: #f0fdf4; color: var(--success); border: 1px solid #bbf7d0; padding: 12px; border-radius: 8px; }
  label.field { display: block; margin: 16px 0 4px 0; font-weight: 600; font-size: 14px; }
  .radio-group { display: flex; gap: 8px; }
  .radio-group label { flex: 1; padding: 12px; border: 2px solid var(--border); border-radius: 10px; text-align: center; cursor: pointer; font-weight: 600; }
  .radio-group label.checked { border-color: var(--primary); background: #eff6ff; color: var(--primary); }
  .radio-group input { display: none; }
  textarea, input[type="text"] { width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 16px; font-family: inherit; }
  textarea { min-height: 80px; resize: vertical; }
  .photo-area { margin-top: 8px; }
  .photo-preview { width: 100%; max-height: 320px; object-fit: contain; background: #f3f4f6; border-radius: 8px; display: none; }
  .photo-input { display: none; }
  .photo-btn { display: block; width: 100%; padding: 14px; border: 2px dashed var(--border); border-radius: 10px; text-align: center; background: #fafafa; cursor: pointer; font-weight: 600; color: var(--muted); }
  .line-items { background: #f9fafb; padding: 12px; border-radius: 8px; font-size: 13px; }
  .line-items div { margin-bottom: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1 id="title">BOL Tracking</h1>
    <div id="content" class="muted">Loading…</div>
  </div>
</div>

<script>
(function () {
  const token = location.pathname.replace(/^\/track\/?/, '').replace(/\/$/, '');
  const contentEl = document.getElementById('content');
  const titleEl = document.getElementById('title');

  if (!token) {
    contentEl.innerHTML = '<div class="err">No tracking token in URL.</div>';
    return;
  }

  let currentBol = null;

  async function load() {
    contentEl.innerHTML = '<div class="muted">Loading…</div>';
    try {
      const res = await fetch('/api/public/bol-lookup/' + encodeURIComponent(token));
      const data = await res.json();
      if (!res.ok || !data.ok) {
        contentEl.innerHTML = '<div class="err">' + (data.error === 'expired_or_invalid'
          ? 'This tracking link is no longer active.'
          : 'Unable to load shipment details.') + '</div>';
        return;
      }
      currentBol = data.bol;
      render();
    } catch {
      contentEl.innerHTML = '<div class="err">Network error. Check your connection and refresh.</div>';
    }
  }

  function render() {
    if (currentBol.stage === 'delivered') return renderDelivered();
    if (currentBol.stage === 'in_transit') return renderDelivery();
    return renderPickup();
  }

  function fmtAddress(b) {
    const parts = [b.ship_to_company, b.ship_to_attention && ('attn: ' + b.ship_to_attention)].filter(Boolean);
    const street = [b.ship_to_street, b.ship_to_street2].filter(Boolean).join(', ');
    if (street) parts.push(street);
    const csz = [b.ship_to_city, b.ship_to_state, b.ship_to_zip].filter(Boolean).join(', ');
    if (csz) parts.push(csz);
    return parts.map(p => '<div>' + escapeHtml(p) + '</div>').join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Stage 1: Pickup confirmation ──────────────────────────────────────
  function renderPickup() {
    titleEl.textContent = 'Confirm Pickup';
    const b = currentBol;
    contentEl.innerHTML = `
      <div class="row"><div class="label">BOL #</div><div><strong>${escapeHtml(b.bol_number || '—')}</strong></div></div>
      <div class="row"><div class="label">Date</div><div>${escapeHtml(b.date || '—')}</div></div>
      <h2>Ship To</h2>
      <div class="line-items">${fmtAddress(b)}</div>
      ${b.commodity_description ? `<h2>Commodity</h2><div class="line-items">${escapeHtml(b.commodity_description).replace(/\n/g, '<br>')}</div>` : ''}
      <button class="btn btn-primary" id="pickup-btn">Confirm Pickup</button>
    `;
    document.getElementById('pickup-btn').addEventListener('click', confirmPickup);
  }

  async function confirmPickup() {
    const btn = document.getElementById('pickup-btn');
    btn.disabled = true; btn.textContent = 'Confirming…';
    try {
      const res = await fetch('/api/public/bol-pickup/' + encodeURIComponent(token), { method: 'POST' });
      const data = await res.json();
      if (!data.ok) { btn.disabled = false; btn.textContent = 'Confirm Pickup'; alert(data.error || 'Failed'); return; }
      await load(); // re-fetch; stage should now be 'in_transit'
    } catch {
      btn.disabled = false; btn.textContent = 'Confirm Pickup';
      alert('Network error. Please try again.');
    }
  }

  // ── Stage 2: Delivery flow ────────────────────────────────────────────
  let photoDataUrl = null;
  let photoBase64 = null;

  function renderDelivery() {
    titleEl.textContent = 'Complete Delivery';
    const b = currentBol;
    contentEl.innerHTML = `
      <div class="row"><div class="label">BOL #</div><div><strong>${escapeHtml(b.bol_number || '—')}</strong></div></div>
      <div class="row"><div class="label">Ship To</div><div>${escapeHtml(b.ship_to_company || '—')}</div></div>

      <label class="field">Delivery accepted?</label>
      <div class="radio-group" id="accepted-group">
        <label data-val="yes"><input type="radio" name="accepted" value="yes">Yes</label>
        <label data-val="no"><input type="radio" name="accepted" value="no">No</label>
        <label data-val="partial"><input type="radio" name="accepted" value="partial">Partial</label>
      </div>

      <label class="field">Any damages?</label>
      <div class="radio-group" id="damages-group">
        <label data-val="no"><input type="radio" name="damages" value="no" checked>No</label>
        <label data-val="yes"><input type="radio" name="damages" value="yes">Yes</label>
      </div>

      <div id="damage-notes-wrap" style="display:none;">
        <label class="field">Damage notes</label>
        <textarea id="damage-notes" placeholder="Describe the damage…"></textarea>
      </div>

      <label class="field">Photo of signed BOL</label>
      <div class="photo-area">
        <input type="file" accept="image/*" capture="environment" id="photo-input" class="photo-input">
        <button type="button" class="photo-btn" id="photo-btn">📷 Take Photo of Signed BOL</button>
        <img id="photo-preview" class="photo-preview" alt="Signed BOL preview">
      </div>

      <button class="btn btn-success" id="submit-btn" disabled>Submit Delivery</button>
    `;

    // Wire radio styling
    function bindRadioGroup(groupId) {
      const group = document.getElementById(groupId);
      group.querySelectorAll('label').forEach(lbl => {
        lbl.addEventListener('click', () => {
          group.querySelectorAll('label').forEach(l => l.classList.remove('checked'));
          lbl.classList.add('checked');
          lbl.querySelector('input').checked = true;
          if (groupId === 'damages-group') {
            document.getElementById('damage-notes-wrap').style.display = lbl.dataset.val === 'yes' ? 'block' : 'none';
          }
          updateSubmitState();
        });
      });
    }
    bindRadioGroup('accepted-group');
    bindRadioGroup('damages-group');
    // Pre-check "no damages"
    document.querySelector('#damages-group label[data-val="no"]').click();

    document.getElementById('photo-btn').addEventListener('click', () => {
      document.getElementById('photo-input').click();
    });
    document.getElementById('photo-input').addEventListener('change', handlePhotoSelect);
    document.getElementById('submit-btn').addEventListener('click', submitDelivery);
  }

  function getSelectedValue(groupId) {
    const checked = document.querySelector('#' + groupId + ' input:checked');
    return checked ? checked.value : null;
  }

  function updateSubmitState() {
    const accepted = getSelectedValue('accepted-group');
    const btn = document.getElementById('submit-btn');
    btn.disabled = !(accepted && photoBase64);
  }

  function handlePhotoSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      // Client-side resize to ~1024px max edge, JPEG quality 0.8.
      const img = new Image();
      img.onload = () => {
        const MAX = 1024;
        const scale = Math.min(MAX / img.width, MAX / img.height, 1);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        photoDataUrl = canvas.toDataURL('image/jpeg', 0.8);
        photoBase64 = photoDataUrl.split(',')[1];
        const preview = document.getElementById('photo-preview');
        preview.src = photoDataUrl;
        preview.style.display = 'block';
        document.getElementById('photo-btn').textContent = '📷 Retake Photo';
        updateSubmitState();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  async function submitDelivery() {
    const accepted = getSelectedValue('accepted-group');
    const damages = getSelectedValue('damages-group') === 'yes';
    const damage_notes = damages ? (document.getElementById('damage-notes').value || '') : null;
    if (!accepted || !photoBase64) return;

    const btn = document.getElementById('submit-btn');
    btn.disabled = true; btn.textContent = 'Uploading…';
    try {
      const res = await fetch('/api/public/bol-delivery/' + encodeURIComponent(token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted, damages, damage_notes, signed_photo_base64: photoBase64 }),
      });
      const data = await res.json();
      if (!data.ok) { btn.disabled = false; btn.textContent = 'Submit Delivery'; alert(data.error || 'Failed'); return; }
      await load(); // stage now 'delivered'
    } catch {
      btn.disabled = false; btn.textContent = 'Submit Delivery';
      alert('Network error during upload. Please try again.');
    }
  }

  // ── Stage 3: Delivered ────────────────────────────────────────────────
  function renderDelivered() {
    titleEl.textContent = 'Delivery Complete';
    contentEl.innerHTML = `
      <div class="ok"><strong>✅ Delivery recorded.</strong><br>BOL #${escapeHtml(currentBol.bol_number || '—')} has been marked delivered. Thank you.</div>
      <p class="muted" style="margin-top:12px;">You may close this page. This tracking link is now inactive.</p>
    `;
  }

  load();
})();
</script>
</body>
</html>
```

---

## Part 5 — Internal display: signed BOL on the logistics shipment modal

In `logistics/index.html`, find the shipment-modal-body render path (the function that builds the modal contents from a shipment object — same place P81's photo gallery was mounted). Above the existing Loading Photos section, add a Signed BOL section.

### 5a. Markup added to the modal body builder

```html
<div class="logistics-modal-section" id="signed-bol-section" style="display:none;">
  <h4 style="margin: 16px 0 4px 0; font-size: 14px; font-weight: 700; color: #374151;">Signed BOL (Proof of Delivery)</h4>
  <img id="signed-bol-thumb" alt="Signed BOL" style="max-width: 100%; max-height: 240px; border: 1px solid #d1d5db; border-radius: 8px; cursor: zoom-in; background: #f3f4f6;">
  <div id="signed-bol-meta" style="font-size: 12px; color: #6b7280; margin-top: 4px;"></div>
</div>
```

### 5b. Show/hide logic when the modal opens

After the modal contents render (next to the existing photoGallery.mount call for loading photos), add:

```javascript
// Signed BOL (P83) — show if the latest BOL for this shipment has an uploaded signed photo.
const signedSection = document.getElementById('signed-bol-section');
const thumb = document.getElementById('signed-bol-thumb');
const meta = document.getElementById('signed-bol-meta');
if (signedSection && shipment?.job_id) {
  signedSection.style.display = 'none';
  try {
    // Look up the BOL(s) for this job; pick the one with a signed photo.
    const { ok, data } = await api.get('/api/bols?job_id=' + encodeURIComponent(shipment.job_id));
    if (ok && data?.bols) {
      const signed = data.bols.find(b => b.signed_bol_photo_key);
      if (signed) {
        signedSection.style.display = '';
        thumb.src = '/api/bols/' + encodeURIComponent(signed.id) + '/signed-photo';
        meta.textContent = signed.signed_bol_uploaded_at ? ('Uploaded ' + signed.signed_bol_uploaded_at) : '';
        thumb.onclick = () => window.open(thumb.src, '_blank');
      }
    }
  } catch {}
}
```

If the shipment object in this file is named differently or the existing modal-builder shape varies from this pseudocode, adapt minimally — the rule is: a Signed BOL section appears in the shipment modal whenever the linked BOL has a `signed_bol_photo_key`, with a thumbnail that opens to full-size on click. Field name `shipment.job_id` and the photo endpoint URL are the only fixed contracts.

---

## Scope (strict)

- **Files touched (5 total):** new migration `add-signed-bol-and-delivery-meta.sql`; edits to `wrangler.toml`, `_worker.js`, `track/index.html` (full rewrite), `logistics/index.html`.
- Do NOT touch any other module.
- Do NOT touch loading photos, the existing `photoGallery` component, or the BOL editor.
- Do NOT add push notification calls — that's P84. A `TODO(P84)` comment in the delivery handler marks the hook point.
- Do NOT modify `bol-shared.js` — the QR is already in place from P82.

## Manual steps

1. **Steve creates R2 bucket** `xpanda-bol-photos` in the Cloudflare dashboard (one-time).
2. Run `DB Migrations/add-signed-bol-and-delivery-meta.sql` in D1 console.
3. Commit and deploy. `wrangler` will bind the R2 bucket on deploy if `wrangler.toml` is correct.
4. Verify end-to-end:
   - Generate a BOL → scan its QR. Pickup page loads with ship-to summary + Confirm Pickup.
   - Tap Confirm Pickup. Shipment status flips to `in_transit` (check Logistics dashboard). Page now shows the delivery form.
   - Fill out: accepted = yes, damages = no, take a photo of any paper document. Submit.
   - Upload completes, page shows Delivery Complete.
   - Refresh the same QR URL — shows "This tracking link is no longer active."
   - In Logistics, open the shipment modal. New "Signed BOL (Proof of Delivery)" section appears with the photo. Click it — full-size opens in a new tab.
   - In the D1 console, check `shipments` row: `status=delivered`, `delivered_at` set, `delivery_accepted='yes'`, `delivery_source='driver_qr'`. Check `bols` row: `signed_bol_photo_key='signed-bols/<id>/<ts>.jpg'`.
   - In the R2 dashboard, confirm the object exists at that key.

## After this lands

**P84** is small: in `handleApiPublicBolDelivery`, at the `TODO(P84)` marker, gather subscribers with the `bol_delivered` notification type enabled and call `sendPushNotification` for each. Add `bol_delivered` to the notification-type options in user/notification settings. That's it — the infrastructure already exists; P84 is wiring.
