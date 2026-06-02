# Prompt 81 — Loading Photos: Shared Gallery Component + Two Consumers

## Agents to assume

**Read BOTH `AGENTS.md` AND `xpanda-ops-agents.md`.** Assume:
- **Lead: logistics-agent** — owns the two consumer surfaces.
- **Coordinating with: admin-auth-agent** — owns `/shared/`.

No worker change, no DB change. Three files.

## Context

Photos captured during the Mark Loaded checklist (Prompt 56) are stored in `loading_photos` and correctly linked to `job_id` and `assignment_id`. The API endpoint `/api/loading-photos` exists and supports filtered list (`?job_id=` or `?assignment_id=`) and per-id detail fetch. **No frontend currently displays any of this data.** This prompt fixes that.

Following the F1 pattern, the gallery lives once in `/shared/` and is consumed by two surfaces:
1. **Loading dashboard cards** (`logistics/loading.html`) — a "📷 Photos" button on each card that opens a lightbox.
2. **Logistics shipment modal** (`logistics/index.html`) — an inline thumbnail strip in the modal body. Clicking any thumbnail opens the same lightbox.

View only. No delete, no re-upload, no admin actions.

---

## Part 1 — Create `/shared/photo-gallery.js`

Single global `window.photoGallery` with two public methods.

```javascript
// /shared/photo-gallery.js — reusable loading-photos viewer.
// Public API:
//   photoGallery.mount(containerEl, { jobId?, assignmentId? })
//     Renders a thumbnail strip into containerEl. Empty container if no photos.
//
//   photoGallery.openLightbox({ jobId?, assignmentId? }, startIndex = 0)
//     Opens a full-screen lightbox cycling through photos. ESC/click-outside closes.
//     Arrow keys + on-screen ‹ › navigate. Tap photo to dismiss on mobile.

(function () {
  if (window.photoGallery) return;

  // ── List fetch ─────────────────────────────────────────────────────────
  async function fetchList(opts) {
    const params = new URLSearchParams();
    if (opts.jobId) params.set('job_id', opts.jobId);
    if (opts.assignmentId) params.set('assignment_id', opts.assignmentId);
    const { ok, data } = await api.get('/api/loading-photos?' + params.toString());
    if (!ok || !data?.photos) return [];
    return data.photos; // [{ id, filename, uploaded_by, created_at, ... }]
  }

  // ── Single-photo fetch (returns full row with photo_data) ──────────────
  // Cached per-id to avoid refetching when navigating back/forward in lightbox.
  const photoDataCache = new Map();
  async function fetchPhoto(id) {
    if (photoDataCache.has(id)) return photoDataCache.get(id);
    const { ok, data } = await api.get('/api/loading-photos/' + encodeURIComponent(id));
    if (!ok || !data?.photo) return null;
    photoDataCache.set(id, data.photo);
    return data.photo;
  }

  // ── Thumbnail strip ────────────────────────────────────────────────────
  async function mount(container, opts) {
    if (!container) return;
    container.innerHTML = '<div style="color:#6b7280;font-size:13px;padding:8px 0;">Loading photos…</div>';
    const list = await fetchList(opts);
    if (!list.length) {
      container.innerHTML = '<div style="color:#9ca3af;font-size:13px;padding:8px 0;font-style:italic;">No photos taken for this shipment.</div>';
      return;
    }

    container.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;padding:8px 0;">
        ${list.map((p, i) => `
          <div class="pg-thumb" data-photo-id="${utils.escHtml(p.id)}" data-index="${i}"
               style="width:80px;height:80px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;background:#f3f4f6;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;">
            <div style="font-size:11px;color:#6b7280;text-align:center;padding:4px;">Loading…</div>
          </div>
        `).join('')}
      </div>
    `;

    // Lazy-load thumbnails — fetch each photo's base64 once visible.
    const thumbs = container.querySelectorAll('.pg-thumb');
    thumbs.forEach(async (thumb) => {
      const id = thumb.dataset.photoId;
      const photo = await fetchPhoto(id);
      if (photo?.photo_data) {
        // photo_data is base64; build a data URL.
        const mime = photo.photo_data.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
        thumb.innerHTML = `<img src="data:${mime};base64,${photo.photo_data}" style="width:100%;height:100%;object-fit:cover;">`;
      } else {
        thumb.innerHTML = '<div style="font-size:11px;color:#b91c1c;text-align:center;padding:4px;">Error</div>';
      }
    });

    container.addEventListener('click', (e) => {
      const thumb = e.target.closest('.pg-thumb');
      if (!thumb) return;
      const idx = Number(thumb.dataset.index) || 0;
      openLightboxFromList(list, idx);
    });
  }

  // ── Lightbox ───────────────────────────────────────────────────────────
  async function openLightbox(opts, startIndex = 0) {
    const list = await fetchList(opts);
    if (!list.length) {
      alert('No photos taken for this shipment.');
      return;
    }
    openLightboxFromList(list, startIndex);
  }

  function openLightboxFromList(list, startIndex) {
    let current = Math.max(0, Math.min(startIndex, list.length - 1));

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:10000;
      display:flex;align-items:center;justify-content:center;
    `;
    overlay.innerHTML = `
      <button class="pg-close" style="position:absolute;top:16px;right:20px;background:none;border:none;color:#fff;font-size:36px;cursor:pointer;line-height:1;padding:0;">×</button>
      <button class="pg-prev" style="position:absolute;left:20px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.1);border:none;color:#fff;font-size:32px;cursor:pointer;width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;">‹</button>
      <button class="pg-next" style="position:absolute;right:20px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.1);border:none;color:#fff;font-size:32px;cursor:pointer;width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;">›</button>
      <div class="pg-image-wrap" style="max-width:92vw;max-height:88vh;display:flex;align-items:center;justify-content:center;">
        <img class="pg-image" style="max-width:92vw;max-height:88vh;object-fit:contain;background:#222;">
      </div>
      <div class="pg-caption" style="position:absolute;bottom:20px;left:0;right:0;text-align:center;color:#e5e7eb;font-size:13px;"></div>
    `;
    document.body.appendChild(overlay);

    const img = overlay.querySelector('.pg-image');
    const caption = overlay.querySelector('.pg-caption');

    async function render() {
      img.style.opacity = '0.3';
      const p = await fetchPhoto(list[current].id);
      if (p?.photo_data) {
        const mime = p.photo_data.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
        img.src = `data:${mime};base64,${p.photo_data}`;
      }
      img.style.opacity = '1';
      const meta = list[current];
      caption.textContent = `${current + 1} of ${list.length}` +
        (meta.uploaded_by ? ` · ${meta.uploaded_by}` : '') +
        (meta.created_at ? ` · ${meta.created_at}` : '');
    }

    function close() {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    }
    function next() { current = (current + 1) % list.length; render(); }
    function prev() { current = (current - 1 + list.length) % list.length; render(); }
    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    }

    overlay.querySelector('.pg-close').addEventListener('click', close);
    overlay.querySelector('.pg-prev').addEventListener('click', prev);
    overlay.querySelector('.pg-next').addEventListener('click', next);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);

    render();
  }

  window.photoGallery = { mount, openLightbox };
})();
```

**Notes:**
- Uses `window.api` (F1b) and `window.utils.escHtml` (F1c) — both already available on every page via the shared header.
- Mime detection by base64 magic-bytes prefix is rough but sufficient (`iVBOR` = PNG; everything else assumed JPEG). If photos are captured as something else, refine here later — not worth blocking on now.
- Caches per-id photo data inside the IIFE so navigating back-and-forth in the lightbox doesn't refetch.
- Auto-load it from `/shared/shared-header.js` alongside `shared-api.js` and `shared-utils.js`:

```javascript
if (!window.__xpandaPhotoGalleryLoaded) {
  window.__xpandaPhotoGalleryLoaded = true;
  document.write('<script src="/shared/photo-gallery.js"><\/script>');
}
```

Place this immediately after the existing shared-utils auto-load block in `/shared/shared-header.js`.

---

## Part 2 — Consumer 1: Loading dashboard cards (`logistics/loading.html`)

Add a "📷 Photos" button to each card's action row, between the existing buttons.

Find the card action rendering block (around line 529, `<div class="ld-card-actions">`). The View BOL button looks like:

```javascript
${a.bay_id ? '...' : `<button class="ld-btn-bol" onclick="viewBolForJob('${a.job_id}')">View BOL</button>`}
```

Add the photos button to the actions row. Place it next to View BOL — same compact style, distinct color so it doesn't look like an action affordance:

```javascript
<button class="ld-btn-photos" onclick="photoGallery.openLightbox({ jobId: '${a.job_id}' })">📷 Photos</button>
```

Add the CSS rule near `.ld-btn-bol` (around line 48):

```css
.ld-btn-photos { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
.ld-btn-photos:hover { background: #fde68a; }
```

The button always shows; if no photos exist for that job, the lightbox surfaces a friendly "No photos taken for this shipment" alert. Optional future enhancement: only show when count > 0, but that requires either an extra fetch per card or a backend change — not worth it for v1.

---

## Part 3 — Consumer 2: Logistics shipment modal (`logistics/index.html`)

The shipment detail modal body is at line ~190 (`<div class="logistics-modal-body">`). Find the section that renders the modal contents when a shipment is opened — there's likely a function building the modal HTML from a shipment object.

Add a "Loading Photos" section near the bottom of the modal body, just above the modal footer. Two changes:

### 3a. Modal markup

Inside the modal body's content render path, add a section like:

```html
<div class="logistics-modal-section">
  <h4 style="margin: 16px 0 4px 0; font-size: 14px; font-weight: 700; color: #374151;">Loading Photos</h4>
  <div id="logistics-photo-gallery-mount"></div>
</div>
```

If the shipment modal builds its body dynamically inside a JS function, insert this block in that function before the closing tag of the modal body content. The mount div has a unique ID so we can target it for `mount()`.

### 3b. Mount the gallery when the modal opens

Find the function that opens the shipment modal (likely `openShipmentDetail`, `showShipmentModal`, or similar — search for `logistics-modal-body` references in scripts). After it populates the body, call:

```javascript
const mount = document.getElementById('logistics-photo-gallery-mount');
if (mount && shipment?.job_id) {
  photoGallery.mount(mount, { jobId: shipment.job_id });
}
```

If the shipment object uses a different field name than `job_id` for the link, use that field. The function that builds the modal already knows the field — match its convention.

---

## Scope (strict)

- **Files touched (4 total):** new `/shared/photo-gallery.js`; one auto-load block added to `/shared/shared-header.js`; `logistics/loading.html` (button + CSS); `logistics/index.html` (modal section + mount call).
- No worker change. No DB change. No new API endpoints. No new permissions (the existing `logistics.loading` key already gates `/api/loading-photos`).
- View only — no delete button, no re-upload, no edit affordance.
- Do not touch the photo capture flow in `loading.html` (Mark Loaded checklist) — write path is untouched.

## Verify

1. On a job that has loading photos captured: open the loading dashboard, click 📷 Photos on its card. Lightbox opens, first photo shows. Arrow keys cycle through photos. ESC and × close.
2. On a job with no photos: clicking 📷 Photos surfaces the empty-state alert.
3. Open the same job's shipment from the Logistics dashboard. Modal body now has a "Loading Photos" section with a thumbnail strip. Clicking any thumbnail opens the same lightbox at that index.
4. The lightbox caption shows `N of M · uploaded_by · created_at`.
5. DevTools Network: opening the lightbox fetches list once, then one detail fetch per photo as it's viewed (cached on re-navigation).

## Future enhancements (not this prompt)

- Per-card photo count badge (requires either N extra fetches or a `?counts=true` API mode).
- Admin delete (one-button add to the lightbox, gated by `logistics.loading` edit permission).
- Eventual R2 migration (F4) — when photos move to R2, the lightbox API surface (`photoGallery.mount` / `openLightbox`) stays identical; only the inside changes from base64 data URLs to R2 image URLs. The component design here is forward-compatible.
