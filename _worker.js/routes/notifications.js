import { json } from '../lib/core.js';

export async function handleApiNotifications(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);

  const url = new URL(request.url);
  const userId = request.headers.get('X-User-Id');
  if (!userId) return json({ ok: false, error: 'Unauthorized' }, 401);

  if (request.method === 'GET') {
    try {
      const unreadOnly = url.searchParams.get('unread') === '1';
      let query = "SELECT * FROM notifications WHERE user_id = ?";
      const binds = [userId];
      if (unreadOnly) { query += " AND is_read = 0"; }
      query += " ORDER BY created_at DESC LIMIT 50";

      const rows = await db.prepare(query).bind(...binds).all();
      const countRow = await db.prepare(
        "SELECT COUNT(*) as unread_count FROM notifications WHERE user_id = ? AND is_read = 0"
      ).bind(userId).first();

      return json({ ok: true, notifications: rows.results || [], unreadCount: countRow?.unread_count || 0 });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  if (request.method === 'PUT' && url.pathname === '/api/notifications/read') {
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    try {
      if (payload.all) {
        await db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").bind(userId).run();
      } else if (Array.isArray(payload.ids)) {
        for (const nid of payload.ids) {
          await db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?").bind(nid, userId).run();
        }
      }
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: 'Method not allowed' }, 405);
}

export async function handleApiPushSubscribe(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const userId = request.headers.get('X-User-Id');
  if (!userId) return json({ ok: false, error: 'Unauthorized' }, 401);

  let payload;
  try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const { endpoint, keys } = payload;
  if (!endpoint) return json({ ok: false, error: 'endpoint is required.' }, 400);

  try {
    const p256dh = keys?.p256dh || '';
    const authKey = keys?.auth || '';
    // notif-bell-01: one row per endpoint. The shared bell re-sends a still-valid subscription
    // (self-heal), so an exact match is a no-op; anything else replaces every row for this
    // endpoint — no duplicate pushes, and a shared device belongs to whoever is signed in on it.
    const same = await db.prepare(
      "SELECT id FROM push_subscriptions WHERE endpoint = ? AND user_id = ? AND p256dh = ? AND auth_key = ?"
    ).bind(endpoint, userId, p256dh, authKey).first();
    if (same) {
      await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND id <> ?").bind(endpoint, same.id).run();
      return json({ ok: true });
    }
    await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
    const id = crypto.randomUUID();
    await db.prepare(
      "INSERT OR REPLACE INTO push_subscriptions (id, user_id, endpoint, p256dh, auth_key) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, userId, endpoint, p256dh, authKey).run();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
  }
}

export async function handleApiPushUnsubscribe(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);
  if (request.method !== 'DELETE') return json({ ok: false, error: 'Method not allowed' }, 405);

  const userId = request.headers.get('X-User-Id');
  if (!userId) return json({ ok: false, error: 'Unauthorized' }, 401);

  try {
    await db.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").bind(userId).run();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
  }
}

