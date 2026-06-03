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

  function photoSrc(id) {
    return '/api/loading-photos/' + encodeURIComponent(id) + '/image';
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
               style="width:80px;height:80px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;background:#f3f4f6;overflow:hidden;position:relative;">
          </div>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('.pg-thumb').forEach((thumb) => {
      const id = thumb.dataset.photoId;
      const img = document.createElement('img');
      img.src = photoSrc(id);
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      img.onerror = () => {
        thumb.innerHTML = '<div style="font-size:11px;color:#b91c1c;text-align:center;padding:4px;display:flex;align-items:center;justify-content:center;height:100%;">Error</div>';
      };
      thumb.appendChild(img);
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

    function render() {
      img.style.opacity = '0.3';
      img.src = photoSrc(list[current].id);
      img.onload  = () => { img.style.opacity = '1'; };
      img.onerror = () => { img.style.opacity = '1'; };
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
