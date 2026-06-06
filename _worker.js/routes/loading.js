import { json, logActivity } from '../lib/core.js';
import { dispatchNotification } from '../lib/push.js';

export async function handleApiLoadingBays(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);

  if (request.method === 'GET') {
    try {
      const rows = await db.prepare(
        "SELECT * FROM loading_bays WHERE is_active = 1 ORDER BY bay_number ASC"
      ).all();
      return json({ ok: true, bays: rows.results || [] });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  if (request.method === 'PUT') {
    const userPerms = JSON.parse(request.headers.get('X-User-Permissions') || '{}');
    const isAdministrator = request.headers.get('X-User-Is-Admin') === '1';

    if (!isAdministrator && !(userPerms['logistics.loading.manage']?.edit)) {
      return json({ ok: false, error: 'Manager access required to update bay settings.' }, 403);
    }

    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    const { id, trailer_number, label } = payload;
    if (!id) return json({ ok: false, error: 'id is required.' }, 400);

    const updates = [];
    const binds = [];
    if (trailer_number !== undefined) { updates.push('trailer_number = ?'); binds.push(String(trailer_number)); }
    if (label !== undefined) { updates.push('label = ?'); binds.push(String(label)); }
    if (updates.length === 0) return json({ ok: false, error: 'Nothing to update.' }, 400);

    updates.push('updated_at = ?');
    binds.push(new Date().toISOString());
    binds.push(id);

    try {
      await db.prepare(`UPDATE loading_bays SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: 'Method not allowed' }, 405);
}

export async function handleApiLoadingAssignments(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);

  const url = new URL(request.url);
  const pathParts = url.pathname.replace('/api/loading-assignments', '').split('/').filter(Boolean);
  const assignmentId = pathParts[0] || null;

  const userPerms = JSON.parse(request.headers.get('X-User-Permissions') || '{}');
  const isAdministrator = request.headers.get('X-User-Is-Admin') === '1';

  if (request.method === 'GET') {
    // Backfill: create loading assignments for jobs that don't have enough
    try {
      const backfillJobs = await db.prepare(`
        SELECT j.id, j.load_count,
          (SELECT COUNT(*) FROM loading_assignments la WHERE la.job_id = j.id) AS existing_count
        FROM jobs j
        WHERE j.status IN ('done', 'loading', 'shipped')
          AND COALESCE(j.method, '') != 'customer pickup'
          AND (SELECT COUNT(*) FROM loading_assignments la WHERE la.job_id = j.id) < CASE WHEN j.load_count > 1 THEN j.load_count ELSE 1 END
      `).all();
      const backfill = backfillJobs.results || [];
      if (backfill.length > 0) {
        const now = new Date().toISOString();
        for (const bj of backfill) {
          const targetCount = Math.max(bj.load_count || 1, 1);
          for (let n = bj.existing_count + 1; n <= targetCount; n++) {
            const laId = crypto.randomUUID();
            await db.prepare(`
              INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
              VALUES (?, ?, NULL, '', 'awaiting', NULL, '', ?, ?, ?)
            `).bind(laId, bj.id, n, now, now).run();
          }
        }
      }
    } catch (e) {
      console.error('Loading assignment backfill failed:', e);
    }

    try {
      const includeArchived = url.searchParams.get('include_archived') === '1';
      const bayId = url.searchParams.get('bay_id') || '';

      let query = `
        SELECT la.*, j.customer, j.invoice_number, j.po_number, j.ship_date, j.ship_to_company,
               j.ship_to_city, j.ship_to_state, j.carrier, j.method, j.load_count,
               lb.bay_number, lb.label as bay_label
        FROM loading_assignments la
        JOIN jobs j ON la.job_id = j.id
        LEFT JOIN loading_bays lb ON la.bay_id = lb.id
      `;

      const conditions = [];
      const binds = [];
      if (!includeArchived) conditions.push("la.loading_status != 'archived'");
      if (bayId) { conditions.push("la.bay_id = ?"); binds.push(bayId); }
      if (conditions.length) query += " WHERE " + conditions.join(" AND ");
      query += " ORDER BY la.created_at ASC";

      const rows = await db.prepare(query).bind(...binds).all();
      return json({ ok: true, assignments: rows.results || [] });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  if (request.method === 'POST') {
    if (!isAdministrator && !(userPerms['logistics.loading.manage']?.edit)) {
      return json({ ok: false, error: 'Manager access required to assign jobs to loading.' }, 403);
    }

    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    if (!payload.job_id) return json({ ok: false, error: 'job_id is required.' }, 400);

    const job = await db.prepare("SELECT load_count FROM jobs WHERE id = ?").bind(payload.job_id).first();
    if (!job) return json({ ok: false, error: 'Job not found.' }, 404);

    const maxLoads = Math.max(job.load_count || 1, 1);
    const existingCountRow = await db.prepare(
      "SELECT COUNT(*) as cnt FROM loading_assignments WHERE job_id = ?"
    ).bind(payload.job_id).first();

    const currentCount = existingCountRow?.cnt || 0;
    if (currentCount >= maxLoads) {
      return json({ ok: false, error: `This job already has ${currentCount} of ${maxLoads} load assignment(s).` }, 400);
    }

    const loadNumber = currentCount + 1;

    const id = crypto.randomUUID();
    const loading_status = payload.bay_id ? 'not_started' : 'awaiting';
    const now = new Date().toISOString();

    try {
      await db.prepare(`
        INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, payload.job_id, payload.bay_id || null, payload.trailer_number || '', loading_status,
              request.headers.get('X-User-Id') || null, payload.notes || '', loadNumber, now, now).run();

      // Sync initial loading status to linked shipment
      try {
        const shipment = await db.prepare(
          "SELECT id FROM shipments WHERE job_id = ? AND direction = 'outbound' LIMIT 1"
        ).bind(payload.job_id).first();
        if (shipment) {
          await db.prepare(
            "UPDATE shipments SET status = ?, updated_at = datetime('now') WHERE id = ?"
          ).bind(loading_status, shipment.id).run();
        }
      } catch (e) {
        console.error('Shipment status sync on assignment creation failed:', e);
      }

      const job = await db.prepare("SELECT customer, invoice_number FROM jobs WHERE id = ?").bind(payload.job_id).first();
      const customerName = job?.customer || 'Unknown';
      const invNum = job?.invoice_number || '';
      await dispatchNotification(db, env, 'loading.assigned',
        'Job Assigned to Loading',
        `${customerName}${invNum ? ' (INV# ' + invNum + ')' : ''} assigned to ${payload.bay_id ? 'Bay' : 'awaiting queue'}`,
        'loading_assignment', id
      );

      await logActivity(db, 'create', 'loading_assignment', id,
        `Assigned job to loading — ${loading_status}`, { job_id: payload.job_id, bay_id: payload.bay_id },
        request.headers.get('X-User-Id'));
      return json({ ok: true, id }, 201);
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  if (request.method === 'PUT') {
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    const id = payload.id || assignmentId;
    if (!id) return json({ ok: false, error: 'id is required.' }, 400);

    const existing = await db.prepare("SELECT * FROM loading_assignments WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: 'Assignment not found.' }, 404);

    const now = new Date().toISOString();
    const updates = [];
    const binds = [];

    if (payload.location !== undefined) {
      updates.push('location = ?');
      binds.push(payload.location === 'yard' ? 'yard' : 'bay');
    }
    if (payload.bay_id !== undefined) { updates.push('bay_id = ?'); binds.push(payload.bay_id || null); }
    if (payload.trailer_number !== undefined) {
      const trailerLockedStatuses = ['in_transit', 'delivered', 'archived'];
      if (trailerLockedStatuses.includes(existing.loading_status) &&
          String(payload.trailer_number) !== String(existing.trailer_number || '')) {
        return json({ ok: false, error: 'Trailer # is locked once the load is in transit.' }, 409);
      }
      updates.push('trailer_number = ?'); binds.push(String(payload.trailer_number));
    }
    if (payload.notes !== undefined) { updates.push('notes = ?'); binds.push(String(payload.notes)); }
    if (payload.ready_checklist !== undefined) {
      updates.push('ready_checklist = ?');
      binds.push(typeof payload.ready_checklist === 'string' ? payload.ready_checklist : JSON.stringify(payload.ready_checklist));
    }

    if (payload.loading_status) {
      // Manager-only: assigning to bay (awaiting → not_started) or reassigning bays
      if ((existing.loading_status === 'awaiting' && payload.loading_status === 'not_started') ||
          (payload.loading_status === 'awaiting' && existing.loading_status !== 'awaiting') ||
          (payload.bay_id && payload.bay_id !== existing.bay_id)) {
        if (!isAdministrator && !(userPerms['logistics.loading.manage']?.edit)) {
          return json({ ok: false, error: 'Manager access required for bay assignment.' }, 403);
        }
      }

      updates.push('loading_status = ?'); binds.push(payload.loading_status);

      if (payload.loading_status === 'loading' && !existing.started_at) {
        updates.push('started_at = ?'); binds.push(now);
      }
      if (payload.loading_status === 'loaded' && !existing.loaded_at) {
        updates.push('loaded_at = ?'); binds.push(now);
      }
      if (payload.loading_status === 'in_transit' && !existing.in_transit_at) {
        updates.push('in_transit_at = ?'); binds.push(now);
      }
      if (payload.loading_status === 'delivered' && !existing.delivered_at) {
        updates.push('delivered_at = ?'); binds.push(now);
      }

      // Dispatch notification on status transition
      if (payload.loading_status !== existing.loading_status) {
        const job = await db.prepare("SELECT customer, invoice_number FROM jobs WHERE id = ?").bind(existing.job_id).first();
        const customerName = job?.customer || 'Unknown';
        const invNum = job?.invoice_number || '';
        const trailerNum = payload.trailer_number || existing.trailer_number || '';

        const typeMap = {
          loading: 'loading.started',
          loaded: 'loading.loaded',
          in_transit: 'loading.in_transit',
          delivered: 'loading.delivered',
        };

        const notifType = typeMap[payload.loading_status];
        if (notifType) {
          const messages = {
            'loading.started': `Trailer${trailerNum ? ' ' + trailerNum : ''} has begun loading — ${customerName}`,
            'loading.loaded': `Trailer${trailerNum ? ' ' + trailerNum : ''} is loaded — ${customerName}`,
            'loading.in_transit': `Trailer${trailerNum ? ' ' + trailerNum : ''} has departed — ${customerName}`,
            'loading.delivered': `Delivery confirmed — ${customerName}${invNum ? ' (INV# ' + invNum + ')' : ''}`,
          };
          const notifTitle = notifType.split('.')[1].charAt(0).toUpperCase() + notifType.split('.')[1].slice(1).replace('_', ' ');
          await dispatchNotification(db, env, notifType, notifTitle, messages[notifType], 'loading_assignment', id);
        }
      }
    }

    if (updates.length === 0) return json({ ok: false, error: 'Nothing to update.' }, 400);

    updates.push('updated_at = ?');
    binds.push(now);
    binds.push(id);

    try {
      await db.prepare(`UPDATE loading_assignments SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
      if (payload.loading_status && payload.loading_status !== existing.loading_status) {
        try {
          const shipment = await db.prepare(
            "SELECT id FROM shipments WHERE job_id = ? AND direction = 'outbound' LIMIT 1"
          ).bind(existing.job_id).first();
          if (shipment) {
            await db.prepare(
              "UPDATE shipments SET status = ?, updated_at = datetime('now') WHERE id = ?"
            ).bind(payload.loading_status, shipment.id).run();
          }
        } catch (e) {
          console.error('Shipment status sync failed:', e);
        }
        await logActivity(db, 'update', 'loading_assignment', id,
          `Loading status: ${existing.loading_status} → ${payload.loading_status}`,
          { job_id: existing.job_id, bay_id: payload.bay_id || existing.bay_id },
          request.headers.get('X-User-Id'));
      }
      if (payload.location === 'yard') {
        await logActivity(db, 'update', 'loading_assignment', id,
          'Moved to yard',
          { job_id: existing.job_id },
          request.headers.get('X-User-Id'));
      }
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  if (request.method === 'DELETE') {
    if (!isAdministrator && !(userPerms['logistics.loading.manage']?.edit)) {
      return json({ ok: false, error: 'Manager access required to remove assignments.' }, 403);
    }

    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    const id = payload.id || assignmentId;
    if (!id) return json({ ok: false, error: 'id is required.' }, 400);

    try {
      await db.prepare("DELETE FROM loading_assignments WHERE id = ?").bind(id).run();
      await logActivity(db, 'delete', 'loading_assignment', id, 'Removed loading assignment', { id },
        request.headers.get('X-User-Id'));
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: 'Method not allowed' }, 405);
}

export async function handleApiLoadingPhotos(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);

  const url = new URL(request.url);
  const pathParts = url.pathname.replace('/api/loading-photos', '').split('/').filter(Boolean);
  const photoId = pathParts[0] || null;

  if (request.method === 'GET') {
    // Image serve — must come before the single-row JSON branch
    if (photoId && pathParts[1] === 'image') {
      try {
        const row = await db.prepare("SELECT photo_key, photo_data FROM loading_photos WHERE id = ?").bind(photoId).first();
        if (!row) return new Response('Not found', { status: 404 });

        if (row.photo_key) {
          const obj = await env.BOL_PHOTOS.get(row.photo_key);
          if (!obj) return new Response('Not found', { status: 404 });
          return new Response(obj.body, {
            headers: {
              'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
              'Cache-Control': 'private, max-age=300',
            },
          });
        }
        // Legacy base64 fallback for un-backfilled rows
        if (row.photo_data && row.photo_data.length > 10) {
          const mime = row.photo_data.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
          const bytes = Uint8Array.from(atob(row.photo_data), c => c.charCodeAt(0));
          return new Response(bytes, {
            headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=300' },
          });
        }
        return new Response('Not found', { status: 404 });
      } catch (e) {
        return new Response('Server error', { status: 500 });
      }
    }

    try {
      if (photoId) {
        const row = await db.prepare(
          "SELECT id, assignment_id, job_id, photo_key, filename, uploaded_by, created_at FROM loading_photos WHERE id = ?"
        ).bind(photoId).first();
        if (!row) return json({ ok: false, error: 'Photo not found.' }, 404);
        return json({ ok: true, photo: { ...row, has_image: !!(row.photo_key || false) } });
      }

      const jobId = url.searchParams.get('job_id');
      const assignmentId = url.searchParams.get('assignment_id');

      let query = "SELECT id, assignment_id, job_id, photo_key, filename, uploaded_by, created_at FROM loading_photos";
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

  if (request.method === 'POST') {
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    if (!payload.assignment_id) return json({ ok: false, error: 'assignment_id is required.' }, 400);
    if (!payload.job_id) return json({ ok: false, error: 'job_id is required.' }, 400);
    if (!payload.photo_data) return json({ ok: false, error: 'photo_data is required.' }, 400);

    // Raised from 1.5MB to ~10MB base64 (~7.5MB decoded) now that we store on R2
    if (payload.photo_data.length > 10000000) {
      return json({ ok: false, error: 'Photo too large. Maximum ~7MB.' }, 400);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Upload to R2 first — only insert DB row on success
    const isPng = payload.photo_data.startsWith('iVBOR');
    const ext = isPng ? 'png' : 'jpg';
    const contentType = isPng ? 'image/png' : 'image/jpeg';
    const r2Key = `loading-photos/${payload.assignment_id}/${id}.${ext}`;

    try {
      const photoBytes = Uint8Array.from(atob(payload.photo_data), c => c.charCodeAt(0));
      await env.BOL_PHOTOS.put(r2Key, photoBytes, { httpMetadata: { contentType } });
    } catch (e) {
      return json({ ok: false, error: 'photo_upload_failed', detail: String(e?.message || e) }, 500);
    }

    try {
      // photo_data column is NOT NULL in schema; store '' sentinel when using R2 key
      await db.prepare(`
        INSERT INTO loading_photos (id, assignment_id, job_id, photo_key, photo_data, filename, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, '', ?, ?, ?)
      `).bind(
        id, payload.assignment_id, payload.job_id, r2Key,
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
