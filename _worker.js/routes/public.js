import { json, logActivity } from '../lib/core.js';
import { dispatchNotification } from '../lib/push.js';

export async function handleApiPublicBolLookup(request, env) {
  const url = new URL(request.url);
  const token = url.pathname.replace('/api/public/bol-lookup/', '').replace(/\/$/, '');
  if (!token || token.length < 8) {
    return json({ ok: false, error: 'Invalid token' }, 400);
  }

  const db = env.DB;
  const bol = await db.prepare(`
    SELECT * FROM bols WHERE access_token = ?
  `).bind(token).first();

  if (!bol) {
    return json({ ok: false, error: 'expired_or_invalid' }, 404);
  }

  // Compute stage from the matched loading_assignment (per-load, P170 NULL-fallback match).
  // Falls back to the job-level shipment when no matching assignment exists.
  let stage = 'issued';
  let matchedAssignment = null;
  if (bol.job_id) {
    if (bol.load_number != null) {
      matchedAssignment = await db.prepare(
        "SELECT loading_status FROM loading_assignments WHERE job_id = ? AND load_number = ? AND loading_status != 'archived'"
      ).bind(bol.job_id, bol.load_number).first();
    } else {
      matchedAssignment = await db.prepare(
        "SELECT loading_status FROM loading_assignments WHERE job_id = ? AND loading_status != 'archived'"
      ).bind(bol.job_id).first();
    }
  }
  if (matchedAssignment) {
    if (matchedAssignment.loading_status === 'delivered') stage = 'delivered';
    else if (matchedAssignment.loading_status === 'in_transit') stage = 'in_transit';
  } else if (bol.job_id) {
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

export async function handleApiPublicBolPickup(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);
  const url = new URL(request.url);
  const token = url.pathname.replace('/api/public/bol-pickup/', '').replace(/\/$/, '');
  if (!token || token.length < 8) return json({ ok: false, error: 'Invalid token' }, 400);

  const db = env.DB;
  const bol = await db.prepare("SELECT job_id, bol_number, load_number FROM bols WHERE access_token = ?").bind(token).first();
  if (!bol) return json({ ok: false, error: 'expired_or_invalid' }, 404);

  const shipment = await db.prepare(
    "SELECT id, status FROM shipments WHERE job_id = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(bol.job_id).first();
  if (!shipment) return json({ ok: false, error: 'no_shipment_linked' }, 404);

  // Resolve the matching loading_assignment for this load (P170 NULL-fallback match).
  const matched = bol.load_number != null
    ? await db.prepare(
        "SELECT id, loading_status, trailer_number FROM loading_assignments WHERE job_id = ? AND load_number = ? AND loading_status != 'archived'"
      ).bind(bol.job_id, bol.load_number).first()
    : await db.prepare(
        "SELECT id, loading_status, trailer_number FROM loading_assignments WHERE job_id = ? AND loading_status != 'archived'"
      ).bind(bol.job_id).first();

  // Idempotency (per-load): matched assignment already in_transit or beyond → return
  // success reporting its stage, regardless of the job-level shipment status.
  if (matched && (matched.loading_status === 'in_transit' || matched.loading_status === 'delivered')) {
    return json({ ok: true, stage: matched.loading_status, already: true });
  }

  const now = new Date().toISOString();

  if (bol.load_number != null) {
    await db.prepare(
      "UPDATE loading_assignments SET loading_status = 'in_transit', in_transit_at = ?, updated_at = ? WHERE job_id = ? AND load_number = ? AND loading_status != 'archived'"
    ).bind(now, now, bol.job_id, bol.load_number).run();
  } else {
    await db.prepare(
      "UPDATE loading_assignments SET loading_status = 'in_transit', in_transit_at = ?, updated_at = ? WHERE job_id = ? AND loading_status != 'archived'"
    ).bind(now, now, bol.job_id).run();
  }

  // Gate the job-level shipment flip: only once every non-archived assignment for the
  // job has reached in_transit or beyond. Zero non-archived assignments counts as complete.
  const remaining = await db.prepare(
    "SELECT COUNT(*) AS remaining FROM loading_assignments WHERE job_id = ? AND loading_status NOT IN ('in_transit','delivered') AND loading_status != 'archived'"
  ).bind(bol.job_id).first();
  const isLastLoad = !remaining || remaining.remaining === 0;

  if (isLastLoad) {
    await db.prepare(
      "UPDATE shipments SET status = 'in_transit', in_transit_at = ?, updated_at = ? WHERE id = ?"
    ).bind(now, now, shipment.id).run();
  }

  await logActivity(db, 'pickup_confirmed', 'shipment', shipment.id,
    `Pickup confirmed via driver QR — BOL #${bol.bol_number}`,
    { source: 'driver_qr', bol_number: bol.bol_number }, null);

  // Push notification — mirrors the manual dashboard path's 'loading.in_transit' dispatch.
  try {
    const job = await db.prepare("SELECT customer, invoice_number FROM jobs WHERE id = ?").bind(bol.job_id).first();
    const customerName = job?.customer || 'shipment';
    const trailerNum = matched?.trailer_number || '';
    const title = 'In transit';
    const message = `Trailer${trailerNum ? ' ' + trailerNum : ''} has departed — ${customerName}`;
    await dispatchNotification(db, env, 'loading.in_transit', title, message, 'shipment', shipment.id);
  } catch (e) {
    // Notification failure must NOT break the pickup confirmation response.
    console.error('Push notification dispatch failed (pickup flow):', e);
  }

  return json({ ok: true, stage: 'in_transit' });
}

export async function handleApiPublicBolDocument(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);
  const url = new URL(request.url);
  const token = url.pathname.replace('/api/public/bol-document/', '').replace(/\/$/, '');
  if (!token || token.length < 8) return json({ ok: false, error: 'Invalid token' }, 400);

  let payload;
  try { payload = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const docType = String(payload.doc_type || '');
  if (!['driver_signed', 'customer_signed'].includes(docType)) {
    return json({ ok: false, error: 'doc_type must be driver_signed|customer_signed' }, 400);
  }
  const pdfBase64 = String(payload.pdf_base64 || '');
  if (!pdfBase64 || pdfBase64.length < 100) {
    return json({ ok: false, error: 'pdf_base64 is required' }, 400);
  }
  if (pdfBase64.length > 8 * 1024 * 1024) {
    return json({ ok: false, error: 'Document too large.' }, 413);
  }

  const db = env.DB;
  const bol = await db.prepare("SELECT id FROM bols WHERE access_token = ?").bind(token).first();
  if (!bol) return json({ ok: false, error: 'expired_or_invalid' }, 404);

  const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
  const r2Key = `signed-bols/${bol.id}/${docType}-${Date.now()}.pdf`;
  try {
    await env.BOL_PHOTOS.put(r2Key, pdfBytes, { httpMetadata: { contentType: 'application/pdf' } });
  } catch (e) {
    return json({ ok: false, error: 'upload_failed', detail: String(e?.message || e) }, 500);
  }

  const docId  = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  await db.prepare(
    "INSERT INTO bol_documents (id, bol_id, doc_type, r2_key, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(docId, bol.id, docType, r2Key, nowIso).run();

  return json({ ok: true, data: { id: docId, doc_type: docType } });
}

export async function handleApiPublicBolDelivery(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);
  const url = new URL(request.url);
  const token = url.pathname.replace('/api/public/bol-delivery/', '').replace(/\/$/, '');
  if (!token || token.length < 8) return json({ ok: false, error: 'Invalid token' }, 400);

  let payload;
  try { payload = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

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
  const bol = await db.prepare("SELECT id, job_id, bol_number, load_number FROM bols WHERE access_token = ?").bind(token).first();
  if (!bol) return json({ ok: false, error: 'expired_or_invalid' }, 404);

  const shipment = await db.prepare(
    "SELECT id, status FROM shipments WHERE job_id = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(bol.job_id).first();
  if (!shipment) return json({ ok: false, error: 'no_shipment_linked' }, 404);

  // Resolve the matching loading_assignment for this load (P170 NULL-fallback match).
  // Falls back to the job-level shipment status when no matching assignment exists.
  const matched = bol.load_number != null
    ? await db.prepare(
        "SELECT id, loading_status FROM loading_assignments WHERE job_id = ? AND load_number = ? AND loading_status != 'archived'"
      ).bind(bol.job_id, bol.load_number).first()
    : await db.prepare(
        "SELECT id, loading_status FROM loading_assignments WHERE job_id = ? AND loading_status != 'archived'"
      ).bind(bol.job_id).first();

  const alreadyDelivered = matched ? matched.loading_status === 'delivered' : shipment.status === 'delivered';
  const notInTransit = matched ? matched.loading_status !== 'in_transit' : shipment.status !== 'in_transit';

  if (alreadyDelivered) {
    return json({ ok: true, stage: 'delivered', already: true });
  }
  // Must be in_transit before a delivery POST is valid.
  if (notInTransit) {
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

  if (bol.load_number != null) {
    await db.prepare(
      "UPDATE loading_assignments SET loading_status = 'delivered', delivered_at = ?, updated_at = ? WHERE job_id = ? AND load_number = ? AND loading_status != 'archived'"
    ).bind(now, now, bol.job_id, bol.load_number).run();
  } else {
    await db.prepare(
      "UPDATE loading_assignments SET loading_status = 'delivered', delivered_at = ?, updated_at = ? WHERE job_id = ? AND loading_status != 'archived'"
    ).bind(now, now, bol.job_id).run();
  }

  await db.prepare(
    "UPDATE bols SET signed_bol_photo_key = ?, signed_bol_uploaded_at = ? WHERE id = ?"
  ).bind(r2Key, now, bol.id).run();

  // Gate the job-level shipment flip + dispatch: only once every non-archived assignment
  // for the job has reached delivered. Zero non-archived assignments counts as complete.
  const remaining = await db.prepare(
    "SELECT COUNT(*) AS remaining FROM loading_assignments WHERE job_id = ? AND loading_status NOT IN ('delivered') AND loading_status != 'archived'"
  ).bind(bol.job_id).first();
  const isLastLoad = !remaining || remaining.remaining === 0;

  if (isLastLoad) {
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
  }

  await logActivity(db, 'delivery_completed', 'shipment', shipment.id,
    `Delivery completed via driver QR — BOL #${bol.bol_number}`,
    { source: 'driver_qr', bol_number: bol.bol_number, accepted, damages, photo_key: r2Key }, null);

  // Push notification — reuse the existing 'loading.delivered' type. Only fire once the
  // job-level shipment has actually flipped (the last trailer) — per-trailer spam is not wanted.
  if (isLastLoad) {
    try {
      // Look up customer + invoice number for a useful message (mirrors the manual mark-delivered dispatch).
      const job = await db.prepare(
        "SELECT customer, invoice_number FROM jobs WHERE id = ?"
      ).bind(bol.job_id).first();
      const customerName = job?.customer || 'shipment';
      const invNum = job?.invoice_number || '';
      const title = 'Delivery completed';
      const message = `Delivery confirmed by driver — ${customerName}${invNum ? ' (INV# ' + invNum + ')' : ''}. Signed BOL is available to view.`;
      await dispatchNotification(db, env, 'loading.delivered', title, message, 'shipment', shipment.id);
    } catch (e) {
      // Notification failure must NOT break the delivery confirmation response.
      console.error('Push notification dispatch failed (delivery flow):', e);
    }
  }

  return json({ ok: true, stage: 'delivered' });
}
