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

  const shipDate = await nextShippingDateStr(db);

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
      WHERE (b.carrier_name LIKE 'LISMA%' OR b.carrier_name LIKE 'SEAL%')
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
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);

  let payload;
  try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const shipDate = String(payload.ship_date || '').trim();
  const deliveryCount = Number(payload.delivery_count) || 0;
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const recipientIds = Array.isArray(payload.recipient_ids)
    ? payload.recipient_ids.map(Number).filter((n) => Number.isInteger(n))
    : [];

  if (attachments.length === 0) return json({ ok: false, error: 'At least one attachment is required.' }, 400);
  if (recipientIds.length === 0) return json({ ok: false, error: 'Select at least one recipient.' }, 400);

  const placeholders = recipientIds.map(() => '?').join(',');
  const rres = await db.prepare(
    `SELECT id, email FROM bol_email_recipients WHERE id IN (${placeholders})`
  ).bind(...recipientIds).all();
  const emails = (rres.results || []).map((r) => String(r.email)).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (emails.length === 0) return json({ ok: false, error: 'No valid recipients found.' }, 400);

  // Persist "checked last time": selected ids → 1, everyone else → 0.
  try {
    await db.prepare(
      `UPDATE bol_email_recipients SET is_selected = CASE WHEN id IN (${placeholders}) THEN 1 ELSE 0 END, updated_at = datetime('now')`
    ).bind(...recipientIds).run();
  } catch (_e) { /* selection persistence is non-fatal */ }

  const prettyDate = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
  }).format(new Date(shipDate + 'T12:00:00'));

  const subject = `BOLs for ${prettyDate} - XPanda Foam`;
  const html = `<p>See attached for the loads shipping ${prettyDate}, there will be ${deliveryCount} deliveries.</p>`;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'XPanda Foam <logistics@xpandaops.com>',
        to: emails,
        subject,
        html,
        attachments,
      }),
    });
    if (resp.ok) return json({ ok: true, sent: attachments.length, recipients: emails.length });
    const detail = await resp.text();
    return json({ ok: false, error: 'Resend send failed', detail }, 502);
  } catch (e) {
    return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
  }
}

// Day-of-week for a plain YYYY-MM-DD calendar date (0=Sun … 6=Sat), TZ-drift-free.
function dowOfDateStr(ds) {
  return new Date(ds + 'T12:00:00Z').getUTCDay();
}

// Next shipping day (ET): the soonest future date that is not a weekend and not a plant holiday.
async function nextShippingDateStr(db) {
  let holidays = new Set();
  try {
    const hr = await db.prepare('SELECT holiday_date FROM plant_holidays').all();
    holidays = new Set((hr.results || []).map((r) => String(r.holiday_date)));
  } catch (_e) {
    // plant_holidays not present yet → degrade to weekdays-only rather than 500
  }
  for (let off = 1; off <= 30; off++) {
    const ds = etDateStr(off);
    const dow = dowOfDateStr(ds);
    if (dow !== 0 && dow !== 6 && !holidays.has(ds)) return ds;
  }
  return etDateStr(1);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handleRecipients(request, env, id) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);
  const m = request.method;

  if (m === 'GET') {
    const r = await db.prepare(
      'SELECT id, email, name, is_selected FROM bol_email_recipients ORDER BY name ASC, email ASC'
    ).all();
    return json({ ok: true, recipients: r.results || [] });
  }

  if (m === 'POST') {
    let p; try { p = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
    const email = String(p.email || '').trim().toLowerCase();
    const name = String(p.name || '').trim();
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'A valid email is required.' }, 400);
    try {
      const res = await db.prepare('INSERT INTO bol_email_recipients (email, name) VALUES (?, ?)').bind(email, name).run();
      return json({ ok: true, id: res.meta?.last_row_id });
    } catch (_e) {
      return json({ ok: false, error: 'That email is already in the list.' }, 409);
    }
  }

  if (m === 'PUT') {
    if (!id) return json({ ok: false, error: 'Missing id' }, 400);
    let p; try { p = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
    const email = String(p.email || '').trim().toLowerCase();
    const name = String(p.name || '').trim();
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'A valid email is required.' }, 400);
    try {
      await db.prepare("UPDATE bol_email_recipients SET email = ?, name = ?, updated_at = datetime('now') WHERE id = ?").bind(email, name, id).run();
      return json({ ok: true });
    } catch (_e) {
      return json({ ok: false, error: 'That email is already in the list.' }, 409);
    }
  }

  if (m === 'DELETE') {
    if (!id) return json({ ok: false, error: 'Missing id' }, 400);
    await db.prepare('DELETE FROM bol_email_recipients WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return json({ ok: false, error: 'Method not allowed' }, 405);
}

async function handleHolidays(request, env, id) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);
  const m = request.method;

  if (m === 'GET') {
    const r = await db.prepare('SELECT id, holiday_date, label FROM plant_holidays ORDER BY holiday_date ASC').all();
    return json({ ok: true, holidays: r.results || [] });
  }

  if (m === 'POST') {
    let p; try { p = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
    const date = String(p.holiday_date || '').trim();
    const label = String(p.label || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: 'Date must be YYYY-MM-DD.' }, 400);
    try {
      const res = await db.prepare('INSERT INTO plant_holidays (holiday_date, label) VALUES (?, ?)').bind(date, label).run();
      return json({ ok: true, id: res.meta?.last_row_id });
    } catch (_e) {
      return json({ ok: false, error: 'That date is already listed.' }, 409);
    }
  }

  if (m === 'DELETE') {
    if (!id) return json({ ok: false, error: 'Missing id' }, 400);
    await db.prepare('DELETE FROM plant_holidays WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return json({ ok: false, error: 'Method not allowed' }, 405);
}

export async function handleApiBolEmail(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['api','bol-email',<sub>,<id?>]
  const sub = parts[2] || '';
  const id = parts[3] || null;

  if (sub === 'candidates' && request.method === 'GET') return handleCandidates(request, env);
  if (sub === 'send' && request.method === 'POST') return handleSend(request, env);
  if (sub === 'recipients') return handleRecipients(request, env, id);
  if (sub === 'holidays') return handleHolidays(request, env, id);

  return json({ ok: false, error: 'Not found' }, 404);
}
