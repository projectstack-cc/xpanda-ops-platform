# Prompt 174 — Delete all BOLs for a job (manager-only) with signed-copy cleanup + Documents UI

## Required reading (do this first)
1. Read `AGENTS.md` (platform conventions).
2. Read `xpanda-ops-agents.md` (multi-agent definition).
3. Two agents: **db-api-agent** (`_worker.js/routes/bols.js`) for the delete endpoint, and **logistics-agent** (`logistics/index.html`) for the Documents-section button. No migration, no permission key (reuses `logistics.loading.manage`).

## Context
When an order changes, a manager needs to wipe the BOL(s) on a job and regenerate. A single-BOL hard-delete handler already exists at `DELETE /api/bols/:id`, but there's no UI, no manager gating, and it orphans signed copies (`bol_documents` rows + R2 objects). This prompt adds a **manager-only, per-job "delete all BOLs"** action that also cleans up signed copies, surfaced in the shipment modal's Documents section.

All edits are byte-exact find/replace, each verified to appear exactly once at HEAD. Confirm `count == 1` before applying.

---

## Edit 1 — Worker: job-scoped delete + manager gate on both delete paths (`_worker.js/routes/bols.js`)
Adds `DELETE /api/bols?job_id=:jobId` (delete every BOL for a job, cleaning `bol_documents` rows and their R2 objects first), and gates the existing single-id delete behind the same manager check. `logActivity` and `env.BOL_PHOTOS` are already in use in this file.

FIND (exactly once):
```
  // ── DELETE /api/bols/:id ──────────────────────────────────────────────────
  if (method === "DELETE" && bolId) {
    try {
      const exists = await db.prepare("SELECT id, bol_number FROM bols WHERE id = ?").bind(bolId).first();
```
REPLACE:
```
  // ── DELETE /api/bols?job_id=:jobId — delete ALL BOLs for a job (manager-only) ──
  const delJobId = url.searchParams.get('job_id');
  if (method === "DELETE" && !bolId && delJobId) {
    const userPerms = JSON.parse(request.headers.get('X-User-Permissions') || '{}');
    const isAdministrator = request.headers.get('X-User-Is-Admin') === '1';
    if (!isAdministrator && !(userPerms['logistics.loading.manage']?.edit)) {
      return json({ ok: false, error: 'Manager access required to delete BOLs.' }, 403);
    }
    try {
      const rows = await db.prepare("SELECT id, bol_number FROM bols WHERE job_id = ?").bind(delJobId).all();
      const bolRows = rows.results || [];
      if (!bolRows.length) return json({ ok: true, message: "No BOLs to delete.", deleted: 0 });
      for (const b of bolRows) {
        const docs = await db.prepare("SELECT r2_key FROM bol_documents WHERE bol_id = ?").bind(b.id).all();
        for (const d of (docs.results || [])) {
          if (d.r2_key && env.BOL_PHOTOS) { try { await env.BOL_PHOTOS.delete(d.r2_key); } catch (_e) {} }
        }
        await db.prepare("DELETE FROM bol_documents WHERE bol_id = ?").bind(b.id).run();
      }
      await db.prepare("DELETE FROM bols WHERE job_id = ?").bind(delJobId).run();
      await logActivity(db, 'delete', 'bol', delJobId,
        `Deleted ${bolRows.length} BOL(s) for job ${delJobId}`,
        { job_id: delJobId, count: bolRows.length }
      );
      return json({ ok: true, message: `Deleted ${bolRows.length} BOL(s).`, deleted: bolRows.length });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // ── DELETE /api/bols/:id ──────────────────────────────────────────────────
  if (method === "DELETE" && bolId) {
    const userPerms = JSON.parse(request.headers.get('X-User-Permissions') || '{}');
    const isAdministrator = request.headers.get('X-User-Is-Admin') === '1';
    if (!isAdministrator && !(userPerms['logistics.loading.manage']?.edit)) {
      return json({ ok: false, error: 'Manager access required to delete BOLs.' }, 403);
    }
    try {
      const exists = await db.prepare("SELECT id, bol_number FROM bols WHERE id = ?").bind(bolId).first();
```

(The existing single-delete body continues unchanged below the inserted guard.)

---

## Edit 2 — Documents UI: manager-only "Delete all BOLs" button (`logistics/index.html`)

### 2a — add the delete-all button to the Documents header
FIND (exactly once):
```
    host.innerHTML = `<div style="font-weight:600;font-size:13px;margin:4px 0 6px;">Documents</div>${blocks.join('')}`;
```
REPLACE:
```
    const _u = window.__xpandaUser;
    const _isMgr = _u && (_u.isAdministrator || (_u.permissions && _u.permissions['logistics.loading.manage'] && _u.permissions['logistics.loading.manage'].edit));
    const delBtn = _isMgr
      ? `<button onclick="deleteAllBolsForJob('${esc(s.job_id)}', ${bols.length})" style="margin-left:auto;font-size:12px;color:var(--danger,#ef4444);background:none;border:1px solid var(--danger,#ef4444);border-radius:6px;padding:2px 8px;cursor:pointer;">Delete all BOLs</button>`
      : '';
    host.innerHTML = `<div style="display:flex;align-items:center;font-weight:600;font-size:13px;margin:4px 0 6px;">Documents${delBtn}</div>${blocks.join('')}`;
```

### 2b — add the handler (prepended before `loadBolDocuments`)
FIND (exactly once):
```
async function loadBolDocuments(s) {
```
REPLACE:
```
async function deleteAllBolsForJob(jobId, count) {
  if (!confirm('Delete ALL ' + count + ' BOL(s) for this job, including any signed copies? This cannot be undone.')) return;
  try {
    const { ok, data } = await api.del('/api/bols?job_id=' + encodeURIComponent(jobId));
    if (!ok) { alert((data && data.error) || 'Failed to delete BOLs.'); return; }
    loadBolDocuments({ job_id: jobId });
    if (typeof loadOutbound === 'function') loadOutbound();
    if (typeof loadInbound === 'function') loadInbound();
  } catch (e) {
    console.error('deleteAllBolsForJob failed:', e);
    alert('Failed to delete BOLs.');
  }
}

async function loadBolDocuments(s) {
```

---

## Step 3 — Validation
- `_worker.js/routes/bols.js` is standalone `.js`: `node --check _worker.js/routes/bols.js`.
- `logistics/index.html` inline `<script>` blocks: extract each with `re.findall` to **real temp files** (do NOT pipe via `/dev/stdin`), `node --check` each, confirm all pass, delete temp files.

## Step 4 — Manual sanity (notes for Steve)
- As a manager, open a job's shipment modal with BOL(s): the Documents header shows "Delete all BOLs". Non-managers don't see it (and the server 403s them).
- Click it → confirm → all BOLs for that job are removed, signed copies cleared from R2, Documents section empties, board's "View BOL" reverts to "Generate BOL" after reload.

## What NOT to change
- Do NOT add a UNIQUE/cascade constraint or migration — cleanup is handled in the worker.
- Do NOT touch the delivery-photo (`signed_bol_photo_key`) flow, the GET/POST/PUT BOL handlers, or `bol-shared.js`/`bol-compose.js`.
- Do NOT widen the permission beyond `logistics.loading.manage` (+ admin).

## Deliverables summary
- `_worker.js/routes/bols.js` — job-scoped delete-all + manager gate on both delete paths + R2/`bol_documents` cleanup.
- `logistics/index.html` — manager-only "Delete all BOLs" button + `deleteAllBolsForJob()`.
- `bols.js` passes `node --check`; `index.html` inline scripts pass `node --check`.
