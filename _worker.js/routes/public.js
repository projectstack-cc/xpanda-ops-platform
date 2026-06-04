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

export async function handleApiPublicBolPickup(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);
  const url = new URL(request.url);
  const token = url.pathname.replace('/api/public/bol-pickup/', '').replace(/\/$/, '');
  if (!token || token.length < 8) return json({ ok: false, error: 'Invalid token' }, 400);

  const db = env.DB;
  const bol = await db.prepare("SELECT job_id, bol_number FROM bols WHERE access_token = ?").bind(token).first();
  if (!bol) return json({ ok: false, error: 'expired_or_invalid' }, 404);

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

  await logActivity(db, 'pickup_confirmed', 'shipment', shipment.id,
    `Pickup confirmed via driver QR — BOL #${bol.bol_number}`,
    { source: 'driver_qr', bol_number: bol.bol_number }, null);

  return json({ ok: true, stage: 'in_transit' });
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

  await logActivity(db, 'delivery_completed', 'shipment', shipment.id,
    `Delivery completed via driver QR — BOL #${bol.bol_number}`,
    { source: 'driver_qr', bol_number: bol.bol_number, accepted, damages, photo_key: r2Key }, null);

  // Push notification — reuse the existing 'loading.delivered' type.
  // Distinguish QR-flow deliveries in the message so recipients see the signed BOL is available.
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

  return json({ ok: true, stage: 'delivered' });
}
