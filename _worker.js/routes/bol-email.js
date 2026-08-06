import { json } from '../lib/core.js';

function etDateStr(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

async function handleCandidates(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);

  const shipDate = etDateStr(1);

  try {
    const rows = await db.prepare(`
      SELECT b.*,
             j.customer, j.invoice_number, j.po_number,
             la.trailer_number, la.load_number AS la_load_number,
             lb.bay_number, lb.label AS bay_label,
             COALESCE(la.ship_date, j.ship_date) AS effective_ship_date
      FROM bols b
      JOIN jobs j ON b.job_id = j.id
      LEFT JOIN loading_assignments la
             ON la.job_id = b.job_id AND la.load_number = b.load_number
      LEFT JOIN loading_bays lb ON la.bay_id = lb.id
      WHERE b.carrier_name LIKE 'LISMA%'
        AND date(COALESCE(la.ship_date, j.ship_date)) = date(?)
      ORDER BY j.customer ASC, b.load_number ASC
    `).bind(shipDate).all();

    return json({ ok: true, ship_date: shipDate, candidates: rows.results || [] });
  } catch (e) {
    return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
  }
}

async function handleSend(request, env) {
  if (!env.RESEND_API_KEY) {
    return json({ ok: false, error: 'Email not configured. Set the RESEND_API_KEY Worker secret.' }, 500);
  }

  let payload;
  try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const to = String(payload.to || '').trim();
  const shipDate = String(payload.ship_date || '').trim();
  const deliveryCount = Number(payload.delivery_count) || 0;
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return json({ ok: false, error: 'A valid recipient email is required.' }, 400);
  }
  if (attachments.length === 0) {
    return json({ ok: false, error: 'At least one attachment is required.' }, 400);
  }

  const prettyDate = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
  }).format(new Date(shipDate + 'T12:00:00'));

  const subject = `BOLs for ${prettyDate} - XPanda Foam`;
  const html = `<p>See attached for tomorrow's loads, there will be ${deliveryCount} deliveries.</p>`;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'XPanda Foam <logistics@xpandaops.com>',
        to: [to],
        subject,
        html,
        attachments,
      }),
    });

    if (resp.ok) {
      return json({ ok: true, sent: attachments.length });
    }

    const detail = await resp.text();
    return json({ ok: false, error: 'Resend send failed', detail }, 502);
  } catch (e) {
    return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
  }
}

export async function handleApiBolEmail(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/api/bol-email/candidates' && request.method === 'GET') {
    return handleCandidates(request, env);
  }
  if (url.pathname === '/api/bol-email/send' && request.method === 'POST') {
    return handleSend(request, env);
  }

  return json({ ok: false, error: 'Not found' }, 404);
}
