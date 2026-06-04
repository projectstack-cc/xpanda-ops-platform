import { json, logActivity, validateSession } from '../lib/core.js';

export async function handleApiActivityLog(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "Missing D1 binding: DB" }, 500);

  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const entityType = url.searchParams.get('entity_type') || '';
  const action = url.searchParams.get('action') || '';

  try {
    let query = "SELECT * FROM activity_log";
    const conditions = [];
    const binds = [];

    if (entityType) {
      conditions.push("entity_type = ?");
      binds.push(entityType);
    }
    if (action) {
      conditions.push("action = ?");
      binds.push(action);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
    binds.push(limit, offset);

    const rows = await db.prepare(query).bind(...binds).all();

    let countQuery = "SELECT COUNT(*) as total FROM activity_log";
    if (conditions.length > 0) {
      countQuery += " WHERE " + conditions.join(" AND ");
    }
    const countBinds = binds.slice(0, -2);
    const countRow = countBinds.length
      ? await db.prepare(countQuery).bind(...countBinds).first()
      : await db.prepare(countQuery).first();

    return json({
      ok: true,
      entries: rows.results || [],
      total: countRow?.total || 0,
      limit,
      offset,
    });
  } catch (e) {
    return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
  }
}

// ========================
// Auth Handlers
// ========================

export async function handleApiUsers(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);

  const sessionUser = await validateSession(db, request);
  if (!sessionUser) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (!sessionUser.isRealAdmin) return json({ ok: false, error: 'Forbidden' }, 403);

  const url = new URL(request.url);
  const pathParts = url.pathname.replace('/api/users', '').split('/').filter(Boolean);
  const userId = pathParts[0] || null;

  try {
    if (request.method === 'GET') {
      const userRows = await db.prepare(
        "SELECT id, username, display_name, password, role, role_id, is_active, first_login, created_at, updated_at FROM users ORDER BY username COLLATE NOCASE"
      ).all();

      const allAssignments = await db.prepare(
        "SELECT ur.user_id, ur.role_id, r.name as role_name FROM user_roles ur JOIN roles r ON ur.role_id = r.id"
      ).all();

      const assignmentMap = {};
      for (const a of (allAssignments.results || [])) {
        if (!assignmentMap[a.user_id]) assignmentMap[a.user_id] = [];
        assignmentMap[a.user_id].push({ role_id: a.role_id, role_name: a.role_name });
      }

      const enriched = (userRows.results || []).map(u => ({
        ...u,
        roles: assignmentMap[u.id] || [],
      }));

      return json({ ok: true, users: enriched });
    }

    if (request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

      const username = String(body.username || '').trim().toLowerCase();
      const displayName = String(body.display_name || body.displayName || '').trim();
      const password = String(body.password || username);
      const role_ids = Array.isArray(body.role_ids) ? body.role_ids : (body.role_id ? [body.role_id] : ['role-staff']);
      const legacyRoleId = role_ids[0] || 'role-staff';
      const legacyRole = legacyRoleId === 'role-administrator' ? 'admin' : (legacyRoleId === 'role-readonly' ? 'readonly' : 'staff');

      if (!username) return json({ ok: false, error: 'Username required.' }, 400);
      if (!displayName) return json({ ok: false, error: 'Display name required.' }, 400);

      const newId = crypto.randomUUID();
      const now = new Date().toISOString();

      await db.prepare(
        `INSERT INTO users (id, username, display_name, password, role, role_id, is_active, first_login, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`
      ).bind(newId, username, displayName, password, legacyRole, legacyRoleId, now, now).run();

      for (const rid of role_ids) {
        await db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(newId, rid).run();
      }

      return json({ ok: true, id: newId }, 201);
    }

    if (request.method === 'PUT') {
      if (!userId) return json({ ok: false, error: 'User ID required.' }, 400);
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

      const now = new Date().toISOString();
      const fields = [];
      const binds = [];

      if (body.display_name !== undefined) { fields.push('display_name = ?'); binds.push(String(body.display_name).trim()); }
      if (body.role_ids !== undefined) {
        const newRoleIds = Array.isArray(body.role_ids) ? body.role_ids : [body.role_ids];
        await db.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(userId).run();
        for (const rid of newRoleIds) {
          await db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(userId, rid).run();
        }
        const legacyRoleId = newRoleIds[0] || 'role-staff';
        const legacyRole = legacyRoleId === 'role-administrator' ? 'admin' : (legacyRoleId === 'role-readonly' ? 'readonly' : 'staff');
        fields.push('role_id = ?'); binds.push(legacyRoleId);
        fields.push('role = ?'); binds.push(legacyRole);
      } else if (body.role_id !== undefined) {
        const legacyRole = body.role_id === 'role-administrator' ? 'admin' : (body.role_id === 'role-readonly' ? 'readonly' : 'staff');
        fields.push('role_id = ?'); binds.push(body.role_id);
        fields.push('role = ?'); binds.push(legacyRole);
      } else if (body.role !== undefined && ['admin', 'staff', 'readonly'].includes(body.role)) {
        fields.push('role = ?'); binds.push(body.role);
      }
      if (body.is_active !== undefined) { fields.push('is_active = ?'); binds.push(body.is_active ? 1 : 0); }
      if (body.first_login !== undefined) { fields.push('first_login = ?'); binds.push(body.first_login ? 1 : 0); }
      if (body.password !== undefined && String(body.password).length >= 1) { fields.push('password = ?'); binds.push(String(body.password)); }

      if (fields.length === 0) return json({ ok: false, error: 'Nothing to update.' }, 400);

      fields.push('updated_at = ?');
      binds.push(now);
      binds.push(userId);

      await db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...binds).run();
      return json({ ok: true });
    }

    if (request.method === 'DELETE') {
      if (!userId) return json({ ok: false, error: 'User ID required.' }, 400);
      if (userId === sessionUser.userId) return json({ ok: false, error: 'Cannot delete your own account.' }, 400);

      await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
      await db.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run();
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Method not allowed' }, 405);
  } catch (e) {
    if (String(e?.message || e).includes('UNIQUE')) {
      return json({ ok: false, error: 'Username already exists.' }, 409);
    }
    return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
  }
}

export async function handleApiRoles(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'DB not available' }, 500);

  const method = request.method;

  if (method === 'GET') {
    try {
      const rows = await db.prepare(
        `SELECT r.*, COUNT(u.id) as user_count
         FROM roles r LEFT JOIN users u ON u.role_id = r.id
         GROUP BY r.id ORDER BY r.is_system DESC, r.name ASC`
      ).all();
      return json({ ok: true, roles: rows.results || [] });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  if (method === 'POST') {
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    const name = String(payload.name || '').trim();
    const description = String(payload.description || '').trim();
    const permissions = payload.permissions || {};

    if (!name) return json({ ok: false, error: 'Role name is required.' }, 400);
    if (name.length < 2) return json({ ok: false, error: 'Role name must be at least 2 characters.' }, 400);

    const id = 'role-' + crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await db.prepare(
        `INSERT INTO roles (id, name, description, permissions, is_system, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      ).bind(id, name, description, JSON.stringify(permissions), now, now).run();

      const role = await db.prepare('SELECT * FROM roles WHERE id = ?').bind(id).first();
      await logActivity(db, 'create', 'role', id, `Created role "${name}"`, { name, permissions });
      return json({ ok: true, role }, 201);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/unique/i.test(msg)) return json({ ok: false, error: 'Role name already exists.' }, 409);
      return json({ ok: false, error: 'Server error.', detail: msg }, 500);
    }
  }

  if (method === 'PUT') {
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    const id = String(payload.id || '').trim();
    if (!id) return json({ ok: false, error: 'id is required.' }, 400);

    const existing = await db.prepare('SELECT * FROM roles WHERE id = ?').bind(id).first();
    if (!existing) return json({ ok: false, error: 'Role not found.' }, 404);

    if (id === 'role-administrator' && payload.name && payload.name !== existing.name) {
      return json({ ok: false, error: 'Cannot rename the Administrator role.' }, 400);
    }

    const updates = [];
    const binds = [];

    if (payload.name !== undefined) { updates.push('name = ?'); binds.push(String(payload.name).trim()); }
    if (payload.description !== undefined) { updates.push('description = ?'); binds.push(String(payload.description).trim()); }
    if (payload.permissions !== undefined) { updates.push('permissions = ?'); binds.push(JSON.stringify(payload.permissions)); }
    if (payload.notification_types !== undefined) {
      const nt = typeof payload.notification_types === 'string' ? payload.notification_types : JSON.stringify(payload.notification_types);
      updates.push('notification_types = ?'); binds.push(nt);
    }

    if (updates.length === 0) return json({ ok: false, error: 'No fields to update.' }, 400);

    updates.push('updated_at = ?');
    binds.push(new Date().toISOString());
    binds.push(id);

    try {
      await db.prepare(`UPDATE roles SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
      const role = await db.prepare('SELECT * FROM roles WHERE id = ?').bind(id).first();
      await logActivity(db, 'update', 'role', id, `Updated role "${role.name}"`, { fields: Object.keys(payload).filter(k => k !== 'id') });
      return json({ ok: true, role });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  if (method === 'DELETE') {
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    const id = String(payload.id || '').trim();
    if (!id) return json({ ok: false, error: 'id is required.' }, 400);

    const existing = await db.prepare('SELECT * FROM roles WHERE id = ?').bind(id).first();
    if (!existing) return json({ ok: false, error: 'Role not found.' }, 404);

    if (existing.is_system) return json({ ok: false, error: 'Cannot delete a system role. Edit its permissions instead.' }, 400);

    const usersWithRole = await db.prepare('SELECT COUNT(*) as cnt FROM users WHERE role_id = ?').bind(id).first();
    if (usersWithRole && usersWithRole.cnt > 0) {
      return json({ ok: false, error: `Cannot delete role — ${usersWithRole.cnt} user(s) are assigned to it. Reassign them first.` }, 400);
    }

    try {
      await db.prepare('DELETE FROM roles WHERE id = ?').bind(id).run();
      await logActivity(db, 'delete', 'role', id, `Deleted role "${existing.name}"`, { name: existing.name });
      return json({ ok: true, message: 'Role deleted.' });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: 'Method not allowed' }, 405);
}

// =============================================================================
// HANDLER: /api/admin/r2-backfill  (POST — admin only)
// Migrates legacy D1 base64 blobs to R2 in small batches.
// ?type=loading-photos | packing-slips
// =============================================================================
