# Prompt 56 — Mark Loaded Checklist + Photo Upload with Compression

## Goal

When a loading team member advances a loading assignment to `loaded` status ("Mark Loaded" button), intercept the status change and show a checklist modal. The user must confirm three items and can optionally upload/capture photos of the loaded trailer. Photos are compressed client-side before upload and stored in a dedicated `loading_photos` table linked to both the assignment and the job.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Context

Currently in `logistics/loading.html`, clicking "Mark Loaded" calls `advanceStatus(assignmentId, 'loaded')` which immediately fires a PUT to `/api/loading-assignments`. There is no confirmation or checklist step.

The loading team uses iPads and phones on the floor. The photo capture should use `<input type="file" accept="image/*" capture="environment">` to open the device camera directly, with a secondary "Upload from library" option.

**D1 has a 2 MB row size limit.** Phone camera photos are typically 3–5 MB. Client-side compression via canvas resize + JPEG quality reduction brings photos down to ~50–150 KB, safely under the limit.

---

## Step 1 — Migration SQL

Create `DB Migrations/loading-photos.sql`:

```sql
-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.

-- 1. Add ready_checklist column to loading_assignments
ALTER TABLE loading_assignments ADD COLUMN ready_checklist TEXT DEFAULT NULL;

-- 2. Create loading_photos table
CREATE TABLE IF NOT EXISTS loading_photos (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  photo_data TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (assignment_id) REFERENCES loading_assignments(id),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_loading_photos_assignment ON loading_photos(assignment_id);
CREATE INDEX IF NOT EXISTS idx_loading_photos_job ON loading_photos(job_id);
```

---

## Step 2 — Worker: accept `ready_checklist` on loading assignment PUT

In `_worker.js`, find the `handleApiLoadingAssignments` PUT handler (around line 4316). In the section that builds the `updates` array:

After the existing lines:
```javascript
if (payload.notes !== undefined) { updates.push('notes = ?'); binds.push(String(payload.notes)); }
```

Add:
```javascript
if (payload.ready_checklist !== undefined) {
  updates.push('ready_checklist = ?');
  binds.push(typeof payload.ready_checklist === 'string' ? payload.ready_checklist : JSON.stringify(payload.ready_checklist));
}
```

---

## Step 3 — Worker: loading photos API

In `_worker.js`, add a new handler function and route it.

### 3a. Add route

Find the routing section (around lines 206–214). Add after the loading-assignments route:

```javascript
if (url.pathname === "/api/loading-photos" || url.pathname.startsWith("/api/loading-photos/")) {
  return handleApiLoadingPhotos(request, env);
}
```

### 3b. Add to permission map

Find `API_PERMISSION_MAP` (around line 464). Add:

```javascript
{ pattern: /^\/api\/loading-photos/, key: 'logistics.loading' },
```

### 3c. Handler function

Add the handler function (place it after `handleApiLoadingAssignments`):

```javascript
async function handleApiLoadingPhotos(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);

  const url = new URL(request.url);
  const pathParts = url.pathname.replace('/api/loading-photos', '').split('/').filter(Boolean);
  const photoId = pathParts[0] || null;

  // ── GET /api/loading-photos?job_id=X or ?assignment_id=X ──
  if (request.method === 'GET') {
    try {
      const jobId = url.searchParams.get('job_id');
      const assignmentId = url.searchParams.get('assignment_id');

      let query = "SELECT id, assignment_id, job_id, filename, uploaded_by, created_at FROM loading_photos";
      const conditions = [];
      const binds = [];

      if (jobId) { conditions.push("job_id = ?"); binds.push(jobId); }
      if (assignmentId) { conditions.push("assignment_id = ?"); binds.push(assignmentId); }
      if (conditions.length) query += " WHERE " + conditions.join(" AND ");
      query += " ORDER BY created_at ASC";

      const rows = await db.prepare(query).bind(...binds).all();
      return json({ ok: true, photos: rows.results || [] });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  // ── GET /api/loading-photos/:id (returns photo data) ──
  if (request.method === 'GET' && photoId) {
    try {
      const row = await db.prepare("SELECT * FROM loading_photos WHERE id = ?").bind(photoId).first();
      if (!row) return json({ ok: false, error: 'Photo not found.' }, 404);
      return json({ ok: true, photo: row });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  // ── POST /api/loading-photos ──
  if (request.method === 'POST') {
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    if (!payload.assignment_id) return json({ ok: false, error: 'assignment_id is required.' }, 400);
    if (!payload.job_id) return json({ ok: false, error: 'job_id is required.' }, 400);
    if (!payload.photo_data) return json({ ok: false, error: 'photo_data is required.' }, 400);

    // Validate size — reject if base64 string is over 1.5MB (leaves headroom under 2MB row limit)
    if (payload.photo_data.length > 1500000) {
      return json({ ok: false, error: 'Photo too large. Maximum ~1MB after compression.' }, 400);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await db.prepare(`
        INSERT INTO loading_photos (id, assignment_id, job_id, photo_data, filename, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, payload.assignment_id, payload.job_id, payload.photo_data,
        payload.filename || '', request.headers.get('X-User-Id') || null, now
      ).run();

      await logActivity(db, 'create', 'loading_photo', id,
        `Uploaded loading photo for assignment ${payload.assignment_id}`,
        { assignment_id: payload.assignment_id, job_id: payload.job_id },
        request.headers.get('X-User-Id'));

      return json({ ok: true, id }, 201);
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  // ── DELETE /api/loading-photos/:id ──
  if (request.method === 'DELETE' && photoId) {
    const userPerms = JSON.parse(request.headers.get('X-User-Permissions') || '{}');
    const isAdministrator = request.headers.get('X-User-Is-Admin') === '1';

    if (!isAdministrator && !(userPerms['logistics.loading.manage']?.edit)) {
      return json({ ok: false, error: 'Manager access required to delete photos.' }, 403);
    }

    try {
      const exists = await db.prepare("SELECT id FROM loading_photos WHERE id = ?").bind(photoId).first();
      if (!exists) return json({ ok: false, error: 'Photo not found.' }, 404);

      await db.prepare("DELETE FROM loading_photos WHERE id = ?").bind(photoId).run();
      await logActivity(db, 'delete', 'loading_photo', photoId, 'Deleted loading photo', {},
        request.headers.get('X-User-Id'));
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: 'Method not allowed' }, 405);
}
```

**Note:** The GET handler has a subtle issue — both the list endpoint and the single-photo endpoint use `request.method === 'GET'`. Fix this by checking `photoId` first:

```javascript
if (request.method === 'GET') {
  if (photoId) {
    // Single photo with full data
    const row = await db.prepare("SELECT * FROM loading_photos WHERE id = ?").bind(photoId).first();
    if (!row) return json({ ok: false, error: 'Photo not found.' }, 404);
    return json({ ok: true, photo: row });
  }
  // List (metadata only — no photo_data to keep response small)
  // ... existing list query
}
```

---

## Step 4 — Frontend: checklist modal in `loading.html`

### 4a. Add modal HTML

In `logistics/loading.html`, add a new modal before `</body>` (alongside the existing pull-job and assign-bay modals):

```html
<!-- Mark Loaded Checklist Modal -->
<div id="loaded-checklist-modal" class="ld-modal-backdrop" hidden>
  <div class="ld-modal-card" style="max-width:500px;">
    <div class="ld-modal-header">
      <h3>Loading Completion Checklist</h3>
      <button onclick="closeLoadedChecklist()" class="ld-modal-close">✕</button>
    </div>
    <div class="ld-modal-body">
      <p style="font-size:13px;color:#6b7280;margin:0 0 16px;">
        Confirm the following before marking this load as complete.
      </p>

      <!-- Question 1 -->
      <label style="display:flex;align-items:flex-start;gap:10px;margin-bottom:16px;cursor:pointer;font-size:14px;color:#111827;">
        <input type="checkbox" id="chk-qty-verified" style="margin-top:3px;width:18px;height:18px;flex-shrink:0;">
        Have all quantities been counted and verified?
      </label>

      <!-- Question 2 -->
      <label style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;cursor:pointer;font-size:14px;color:#111827;">
        <input type="checkbox" id="chk-changes-issues" style="margin-top:3px;width:18px;height:18px;flex-shrink:0;" onchange="document.getElementById('changes-notes-row').style.display = this.checked ? '' : 'none';">
        Were there any changes or issues?
      </label>
      <div id="changes-notes-row" style="display:none;margin:0 0 16px 28px;">
        <textarea id="changes-notes" rows="3" placeholder="Describe changes or issues…"
          style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;resize:vertical;"></textarea>
      </div>

      <!-- Question 3 -->
      <label style="display:flex;align-items:flex-start;gap:10px;margin-bottom:20px;cursor:pointer;font-size:14px;color:#111827;">
        <input type="checkbox" id="chk-paperwork-secured" style="margin-top:3px;width:18px;height:18px;flex-shrink:0;">
        Was the paperwork secured inside the trailer?
      </label>

      <!-- Photo section -->
      <div style="border-top:1px solid #e5e7eb;padding-top:16px;">
        <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:8px;">Photos (optional)</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <button type="button" onclick="captureLoadingPhoto()" class="ld-btn-advance" style="font-size:13px;">
            📷 Take Photo
          </button>
          <button type="button" onclick="uploadLoadingPhoto()" class="ld-btn-assign" style="font-size:13px;">
            📁 Upload from Library
          </button>
        </div>
        <!-- Hidden file inputs -->
        <input type="file" id="loading-photo-capture" accept="image/*" capture="environment" style="display:none;" onchange="handleLoadingPhotoSelected(this)">
        <input type="file" id="loading-photo-upload" accept="image/*" style="display:none;" onchange="handleLoadingPhotoSelected(this)" multiple>
        <!-- Photo previews -->
        <div id="loading-photo-previews" style="display:flex;gap:8px;flex-wrap:wrap;"></div>
      </div>
    </div>
    <div class="ld-modal-footer">
      <button onclick="closeLoadedChecklist()" class="ld-btn-cancel">Cancel</button>
      <button id="btn-confirm-loaded" onclick="confirmLoadedChecklist()" class="ld-btn-confirm">Confirm & Mark Loaded</button>
    </div>
  </div>
</div>
```

### 4b. Add CSS for photo previews

In the `<style>` block of `loading.html`, add:

```css
.loading-photo-thumb {
  position: relative;
  width: 80px; height: 80px;
  border-radius: 8px; overflow: hidden;
  border: 1px solid #d1d5db;
}
.loading-photo-thumb img {
  width: 100%; height: 100%; object-fit: cover;
}
.loading-photo-thumb .remove-photo {
  position: absolute; top: 2px; right: 2px;
  width: 20px; height: 20px; border-radius: 50%;
  background: rgba(0,0,0,0.6); color: #fff;
  border: none; font-size: 12px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
```

### 4c. Intercept the "Mark Loaded" status advance

Modify `advanceStatus()` to intercept the `loaded` transition:

```javascript
async function advanceStatus(assignmentId, newStatus) {
  // Intercept "loaded" to show checklist
  if (newStatus === 'loaded') {
    openLoadedChecklist(assignmentId);
    return;
  }

  // All other status changes proceed directly
  try {
    const res = await fetch('/api/loading-assignments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: assignmentId, loading_status: newStatus }),
    });
    const data = await res.json();
    if (data.ok) {
      loadDashboard();
    } else {
      alert(data.error || 'Failed to update status');
    }
  } catch (e) {
    console.error('Status advance failed:', e);
  }
}
```

### 4d. Checklist modal logic

```javascript
let checklistAssignmentId = null;
let pendingPhotos = []; // { dataUrl: string, filename: string }

function openLoadedChecklist(assignmentId) {
  checklistAssignmentId = assignmentId;
  pendingPhotos = [];

  // Reset form
  document.getElementById('chk-qty-verified').checked = false;
  document.getElementById('chk-changes-issues').checked = false;
  document.getElementById('chk-paperwork-secured').checked = false;
  document.getElementById('changes-notes').value = '';
  document.getElementById('changes-notes-row').style.display = 'none';
  document.getElementById('loading-photo-previews').innerHTML = '';

  document.getElementById('loaded-checklist-modal').hidden = false;
}

function closeLoadedChecklist() {
  document.getElementById('loaded-checklist-modal').hidden = true;
  checklistAssignmentId = null;
  pendingPhotos = [];
}

function captureLoadingPhoto() {
  document.getElementById('loading-photo-capture').click();
}

function uploadLoadingPhoto() {
  document.getElementById('loading-photo-upload').click();
}

async function handleLoadingPhotoSelected(input) {
  const files = Array.from(input.files);
  if (!files.length) return;

  for (const file of files) {
    try {
      const compressed = await compressPhoto(file, 1200, 0.6);
      pendingPhotos.push({ dataUrl: compressed, filename: file.name });
    } catch (e) {
      console.error('Photo compression failed:', e);
    }
  }

  renderPhotoPreview();
  input.value = ''; // reset so same file can be selected again
}

function compressPhoto(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;

        // Scale down to maxDim on longest side
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round(h * (maxDim / w));
            w = maxDim;
          } else {
            w = Math.round(w * (maxDim / h));
            h = maxDim;
          }
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderPhotoPreview() {
  const container = document.getElementById('loading-photo-previews');
  container.innerHTML = pendingPhotos.map((p, i) => `
    <div class="loading-photo-thumb">
      <img src="${p.dataUrl}" alt="Photo ${i + 1}">
      <button class="remove-photo" onclick="removeLoadingPhoto(${i})">✕</button>
    </div>
  `).join('');
}

function removeLoadingPhoto(index) {
  pendingPhotos.splice(index, 1);
  renderPhotoPreview();
}

async function confirmLoadedChecklist() {
  const qtyVerified = document.getElementById('chk-qty-verified').checked;
  const paperworkSecured = document.getElementById('chk-paperwork-secured').checked;

  if (!qtyVerified) { alert('Please confirm all quantities have been counted and verified.'); return; }
  if (!paperworkSecured) { alert('Please confirm the paperwork was secured inside the trailer.'); return; }

  const changesIssues = document.getElementById('chk-changes-issues').checked;
  const changesNotes = changesIssues ? document.getElementById('changes-notes').value.trim() : '';

  const checklist = {
    qty_verified: true,
    changes_issues: changesIssues,
    changes_notes: changesNotes,
    paperwork_secured: true,
    completed_at: new Date().toISOString(),
  };

  const btn = document.getElementById('btn-confirm-loaded');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    // 1. Advance status to loaded with checklist data
    const res = await fetch('/api/loading-assignments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: checklistAssignmentId,
        loading_status: 'loaded',
        ready_checklist: JSON.stringify(checklist),
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      alert(data.error || 'Failed to mark as loaded');
      return;
    }

    // 2. Upload photos (if any)
    const assignment = allAssignments.find(a => a.id === checklistAssignmentId);
    const jobId = assignment?.job_id;

    if (pendingPhotos.length > 0 && jobId) {
      for (const photo of pendingPhotos) {
        // Strip data URL prefix to get just the base64
        const base64 = photo.dataUrl.split(',')[1] || photo.dataUrl;
        try {
          await fetch('/api/loading-photos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              assignment_id: checklistAssignmentId,
              job_id: jobId,
              photo_data: base64,
              filename: photo.filename,
            }),
          });
        } catch (e) {
          console.error('Photo upload failed:', e);
        }
      }
    }

    closeLoadedChecklist();
    loadDashboard();

    // Toast
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;z-index:10000;';
    toast.innerHTML = '<span style="color:#34d399;">✓</span> Marked as loaded';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);

  } catch (e) {
    console.error('Loaded checklist submission failed:', e);
    alert('Failed to submit checklist. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm & Mark Loaded';
  }
}
```

---

## What NOT to touch

- Do NOT modify `bol-shared.js`, `bol-generator.html`, or `load-builder.html`
- Do NOT modify `logistics/index.html` (logistics dashboard)
- Do NOT modify the loading status flow or other status transitions (only `loaded` gets the checklist)
- Do NOT modify the loading assignment POST handler
- Do NOT modify the loading bay handlers
- Do NOT modify the pull-job or assign-bay modals
- Do NOT change the existing card rendering — only the `advanceStatus()` intercept
- Do NOT store photos as BLOBs — use base64 TEXT in D1

---

## Completion checklist

- [ ] Migration SQL file created at `DB Migrations/loading-photos.sql`
- [ ] `_worker.js`: loading assignment PUT accepts `ready_checklist` field
- [ ] `_worker.js`: new `handleApiLoadingPhotos` handler with GET (list + single), POST, DELETE
- [ ] `_worker.js`: route added for `/api/loading-photos`
- [ ] `_worker.js`: permission map entry added for loading-photos
- [ ] `_worker.js`: POST validates photo size (< 1.5MB base64)
- [ ] `_worker.js`: DELETE requires manager permission
- [ ] `_worker.js`: `logActivity()` calls on photo create and delete
- [ ] `loading.html`: checklist modal HTML with three questions
- [ ] `loading.html`: question 2 reveals a notes textarea when checked
- [ ] `loading.html`: photo capture button (opens camera) and upload button (opens library)
- [ ] `loading.html`: client-side `compressPhoto()` resizes to 1200px max and JPEG 0.6 quality
- [ ] `loading.html`: photo previews with remove button
- [ ] `loading.html`: `advanceStatus()` intercepts `loaded` transition to show checklist
- [ ] `loading.html`: questions 1 and 3 required before submit
- [ ] `loading.html`: checklist JSON saved to `ready_checklist` column on submit
- [ ] `loading.html`: photos uploaded via `/api/loading-photos` POST after status change
- [ ] All other status transitions (loading, in_transit, delivered) unchanged
- [ ] No console errors

**Notify Steve:** Run the migration SQL in the Cloudflare D1 Dashboard Console before deploying:
```sql
ALTER TABLE loading_assignments ADD COLUMN ready_checklist TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS loading_photos (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  photo_data TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (assignment_id) REFERENCES loading_assignments(id),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_loading_photos_assignment ON loading_photos(assignment_id);
CREATE INDEX IF NOT EXISTS idx_loading_photos_job ON loading_photos(job_id);
```

Test:
1. Open Loading Dashboard → advance a job to `loading` status → no checklist (normal advance)
2. Click "Mark Loaded" → checklist modal appears
3. Try to submit without checking boxes 1 and 3 → validation prevents it
4. Check "changes or issues" → notes textarea appears → type a note
5. Take a photo with iPad camera → preview thumbnail appears → can remove it
6. Upload a photo from library → preview thumbnail appears
7. Check all required boxes → click "Confirm & Mark Loaded" → status advances to `loaded`
8. Verify in D1 Console: `SELECT ready_checklist FROM loading_assignments WHERE id = '...'` → JSON blob present
9. Verify in D1 Console: `SELECT id, filename FROM loading_photos WHERE assignment_id = '...'` → photo records present
10. Verify photo_data in D1 is reasonable size (< 200KB base64 for a compressed phone photo)
