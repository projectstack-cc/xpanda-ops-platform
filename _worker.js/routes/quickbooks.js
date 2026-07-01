import { json, logActivity } from '../lib/core.js';
import { getValidToken, saveConnection, fetchInvoice, fetchInvoiceByDocNumber, verifyWebhookSignature } from '../lib/quickbooks.js';
import { mapInvoiceToJob } from '../lib/qb-mapper.js';

// ── Shared: create a job row + line items + shipment + loading assignment ─────
// Returns { ok, job_id, invoice_number, customer } or { ok: false, code, ... }.
async function createJobFromInvoice(db, invoice) {
  const mapped = mapInvoiceToJob(invoice);

  if (mapped.invoice_number) {
    const dupe = await db.prepare(
      "SELECT id FROM jobs WHERE invoice_number = ? AND status != 'archived' LIMIT 1"
    ).bind(mapped.invoice_number).first();
    if (dupe) {
      return { ok: false, code: 'duplicate_invoice', job_id: dupe.id,
               error: `Job with invoice # ${mapped.invoice_number} already exists.` };
    }
  }

  const id  = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO jobs (
      id, status, customer, invoice_number, source,
      ship_to_company, ship_to_attention, ship_to_street, ship_to_street2,
      ship_to_city, ship_to_state, ship_to_zip,
      load_count, total_bdft, priority, confirmed_to_ship, processes,
      po_number, ship_date, ship_day, location, delivery_time, method, carrier,
      scrap_pickup, sales_lead, bol_info, payment_info, notes, packing_instructions,
      contact_name, contact_phone, created_at, updated_at
    ) VALUES (
      ?,?,?,?,?,
      ?,?,?,?,?,?,?,
      ?,?,?,?,?,
      ?,?,?,?,?,?,?,
      ?,?,?,?,?,?,
      ?,?,?,?
    )
  `).bind(
    id, 'not_started', mapped.customer, mapped.invoice_number, 'quickbooks',
    mapped.ship_to_company, mapped.ship_to_attention, mapped.ship_to_street, mapped.ship_to_street2,
    mapped.ship_to_city, mapped.ship_to_state, mapped.ship_to_zip,
    1, 0, 'normal', 0, '[]',
    '', '', '', '', '', '', '',
    '', '', '', '', '', '',
    '', '', now, now,
  ).run();

  for (const li of mapped.line_items) {
    await db.prepare(`
      INSERT INTO job_line_items (id, job_id, part_id, part_number, description, quantity, dimensions, sort_order)
      VALUES (?,?,?,?,?,?,?,?)
    `).bind(crypto.randomUUID(), id, null, li.part_number, li.description, li.quantity, '', li.sort_order).run();
  }

  try {
    await db.prepare(`
      INSERT INTO shipments
        (id, direction, job_id, customer, carrier, method, bol_number, origin,
         destination, ship_date, status, total_bdft, load_count,
         weight_lbs, bead_type, notes, trailer_number)
      VALUES (?, 'outbound', ?, ?, '', '', '', 'XPanda Foam', '', '', 'not_started', 0, 1, 0, '', '', '')
    `).bind(crypto.randomUUID(), id, mapped.customer).run();
  } catch (e) {
    console.error('QB: auto-shipment creation failed:', String(e?.message || e));
  }

  try {
    const now2 = new Date().toISOString();
    await db.prepare(`
      INSERT INTO loading_assignments
        (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
      VALUES (?, ?, NULL, '', 'awaiting', NULL, '', 1, ?, ?)
    `).bind(crypto.randomUUID(), id, now2, now2).run();
  } catch (e) {
    console.error('QB: auto-loading-assignment creation failed:', String(e?.message || e));
  }

  await logActivity(db, 'create', 'job', id,
    `QB import: ${mapped.customer} invoice ${mapped.invoice_number} (${mapped.line_items.length} line items)`,
    { invoice_number: mapped.invoice_number, line_item_count: mapped.line_items.length, qbo_invoice_id: invoice.Id });

  return { ok: true, job_id: id, invoice_number: mapped.invoice_number, customer: mapped.customer };
}

// ── Webhook handler — bypasses session gate, called with ctx for waitUntil ───
export async function handleApiQbWebhook(request, env, ctx) {
  const db = env.DB;

  // Always respond 200 immediately — Intuit retries on any non-200
  const rawBody  = await request.text();
  const signature = request.headers.get('intuit-signature') || '';

  const valid = await verifyWebhookSignature(rawBody, signature, env.QB_WEBHOOK_VERIFIER || '');
  if (!valid) {
    console.error('QB webhook: invalid signature — ignoring');
    return new Response('ok', { status: 200 });
  }

  // Kick off async processing after responding
  ctx.waitUntil((async () => {
    try {
      const payload = JSON.parse(rawBody);
      const realmId = env.QB_REALM_ID;
      if (!realmId || !db) return;

      for (const notification of payload.eventNotifications || []) {
        if (notification.realmId !== realmId) continue;
        const entities = notification.dataChangeEvent?.entities || [];
        const invoiceEntities = entities.filter(e => e.name === 'Invoice' &&
          (e.operation === 'Create' || e.operation === 'Update'));

        if (!invoiceEntities.length) continue;

        let token;
        try { token = await getValidToken(db, realmId, env); }
        catch (e) { console.error('QB webhook: token error:', e.message); return; }

        for (const entity of invoiceEntities) {
          try {
            const invoice = await fetchInvoice(token, realmId, entity.id, env);
            const result  = await createJobFromInvoice(db, invoice);
            if (result.ok) {
              console.log(`QB webhook: created job ${result.job_id} from invoice ${result.invoice_number}`);
            } else if (result.code === 'duplicate_invoice') {
              console.log(`QB webhook: invoice ${invoice.DocNumber} already imported, skipping`);
            }
          } catch (e) {
            console.error(`QB webhook: failed to process invoice ${entity.id}:`, e.message);
          }
        }
      }
    } catch (e) {
      console.error('QB webhook: processing error:', e.message);
    }
  })());

  return new Response('ok', { status: 200 });
}

// ── Authenticated QB API routes ───────────────────────────────────────────────
export async function handleApiQuickbooks(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding: DB' }, 500);

  const url      = new URL(request.url);
  const parts    = url.pathname.split('/').filter(Boolean);
  const subRoute = parts[2] || '';

  const isAdmin  = request.headers.get('X-User-Is-Admin') === '1';
  const userName = request.headers.get('X-User-Name') || 'unknown';
  const realmId  = env.QB_REALM_ID;

  if (!realmId && subRoute !== 'connect') {
    return json({ ok: false, error: 'QB_REALM_ID env var not configured' }, 500);
  }

  // ── GET /api/qb/connection ────────────────────────────────────────────────
  if (request.method === 'GET' && subRoute === 'connection') {
    const conn = await db.prepare(
      'SELECT realm_id, token_expires_at, updated_at FROM qb_connections WHERE realm_id = ?'
    ).bind(realmId).first();
    if (!conn) return json({ ok: true, connected: false, realm_id: realmId });
    const expired = !conn.token_expires_at || new Date(conn.token_expires_at) <= new Date();
    return json({ ok: true, connected: true, realm_id: conn.realm_id, token_expires_at: conn.token_expires_at, expired });
  }

  // ── POST /api/qb/connect — seed initial OAuth tokens (admin only) ─────────
  if (request.method === 'POST' && subRoute === 'connect') {
    if (!isAdmin) return json({ ok: false, error: 'Administrator access required.' }, 403);
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    const { access_token, refresh_token, expires_in = 3600, realm_id } = payload;
    if (!access_token || !refresh_token) {
      return json({ ok: false, error: 'access_token and refresh_token are required' }, 400);
    }
    const targetRealm = realm_id || realmId;
    if (!targetRealm) return json({ ok: false, error: 'realm_id required (or set QB_REALM_ID env var)' }, 400);

    await saveConnection(db, { realmId: targetRealm, accessToken: access_token, refreshToken: refresh_token, expiresIn: expires_in });
    await logActivity(db, 'create', 'qb_connection', targetRealm, `QB connection seeded by ${userName}`, {});
    return json({ ok: true, realm_id: targetRealm });
  }

  // ── GET /api/qb/preview?invoiceId=&docNumber= ─────────────────────────────
  if (request.method === 'GET' && subRoute === 'preview') {
    const invoiceId = url.searchParams.get('invoiceId');
    const docNumber = url.searchParams.get('docNumber');
    if (!invoiceId && !docNumber) return json({ ok: false, error: 'invoiceId or docNumber required' }, 400);

    let token;
    try { token = await getValidToken(db, realmId, env); }
    catch (e) { return json({ ok: false, error: `QB auth error: ${e.message}` }, 401); }

    let invoice;
    try {
      invoice = invoiceId
        ? await fetchInvoice(token, realmId, invoiceId, env)
        : await fetchInvoiceByDocNumber(token, realmId, docNumber, env);
    } catch (e) { return json({ ok: false, error: e.message }, 400); }

    return json({ ok: true, invoice, mapped: mapInvoiceToJob(invoice) });
  }

  // ── POST /api/qb/import — manual trigger ─────────────────────────────────
  if (request.method === 'POST' && subRoute === 'import') {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    const { invoiceId, docNumber } = payload;
    if (!invoiceId && !docNumber) return json({ ok: false, error: 'invoiceId or docNumber required' }, 400);

    let token;
    try { token = await getValidToken(db, realmId, env); }
    catch (e) { return json({ ok: false, error: `QB auth error: ${e.message}` }, 401); }

    let invoice;
    try {
      invoice = invoiceId
        ? await fetchInvoice(token, realmId, invoiceId, env)
        : await fetchInvoiceByDocNumber(token, realmId, docNumber, env);
    } catch (e) { return json({ ok: false, error: e.message }, 400); }

    const result = await createJobFromInvoice(db, invoice);
    if (!result.ok) {
      return json(result, result.code === 'duplicate_invoice' ? 409 : 500);
    }
    return json(result, 201);
  }

  return json({ ok: false, error: 'Not found' }, 404);
}
