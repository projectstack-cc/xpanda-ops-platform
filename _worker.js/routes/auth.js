import { json, logActivity, validateSession } from '../lib/core.js';

async function createSession(db, userId) {
  const sessionId = crypto.randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`
  ).bind(sessionId, userId, expires).run();
  return { sessionId, expires };
}

function sessionCookie(sessionId, expires) {
  const expDate = new Date(expires).toUTCString();
  return `xpanda_session=${sessionId}; Path=/; Expires=${expDate}; HttpOnly; SameSite=Lax`;
}

function clearSessionCookie() {
  return `xpanda_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`;
}

export async function handleAuthLogin(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!username || !password) return json({ ok: false, error: 'Username and password required.' }, 400);

  try {
    const user = await db.prepare(
      `SELECT id, username, display_name, role, is_active, first_login, password
       FROM users WHERE username = ? COLLATE NOCASE`
    ).bind(username).first();

    if (!user || !user.is_active) return json({ ok: false, error: 'Invalid username or password.' }, 401);
    if (user.password !== password) return json({ ok: false, error: 'Invalid username or password.' }, 401);

    const { sessionId, expires } = await createSession(db, user.id);

    return json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        firstLogin: user.first_login === 1,
      }
    }, 200, { 'Set-Cookie': sessionCookie(sessionId, expires) });
  } catch (e) {
    return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
  }
}

export async function handleAuthLogout(request, env) {
  const db = env.DB;
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const token = getSessionToken(request);
  if (token && db) {
    try { await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(token).run(); } catch {}
  }

  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}

export async function handleAuthMe(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);

  const user = await validateSession(db, request);
  if (!user) return json({ ok: false, error: 'Not authenticated' }, 401);

  return json({
    ok: true,
    user: {
      id: user.userId,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      roleIds: user.roleIds,
      roleNames: user.roleNames,
      firstLogin: user.firstLogin,
      isAdministrator: user.isAdministrator,
      isRealAdmin: user.isRealAdmin || false,
      permissions: user.permissions,
      simulatingRole: user.simulatingRole || null,
    },
  });
}

export async function handleAuthChangePassword(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const user = await validateSession(db, request);
  if (!user) return json({ ok: false, error: 'Not authenticated' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const newPassword = String(body.new_password || '');
  if (newPassword.length < 4) return json({ ok: false, error: 'Password must be at least 4 characters.' }, 400);

  try {
    await db.prepare(
      `UPDATE users SET password = ?, first_login = 0, updated_at = ? WHERE id = ?`
    ).bind(newPassword, new Date().toISOString(), user.userId).run();

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
  }
}

export async function handleSimulateRoleStart(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);

  const user = await validateSession(db, request);
  if (!user) return json({ ok: false, error: 'Not authenticated' }, 401);
  if (!user.isRealAdmin) return json({ ok: false, error: 'Only administrators can simulate roles.' }, 403);

  let payload;
  try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const roleId = String(payload.roleId || '').trim();
  if (!roleId) return json({ ok: false, error: 'roleId is required.' }, 400);

  if (roleId === 'role-administrator') {
    return json({ ok: false, error: 'Cannot simulate the administrator role.' }, 400);
  }

  const role = await db.prepare("SELECT id, name FROM roles WHERE id = ?").bind(roleId).first();
  if (!role) return json({ ok: false, error: 'Role not found.' }, 404);

  await db.prepare("UPDATE sessions SET simulating_role_id = ? WHERE id = ?")
    .bind(roleId, user.sessionId).run();

  await logActivity(db, 'simulate_role_start', 'session', user.sessionId,
    `Testing as: ${role.name}`,
    { simulatedRoleId: roleId, simulatedRoleName: role.name },
    user.userId);

  return json({ ok: true, simulatingRole: { id: role.id, name: role.name } });
}

export async function handleSimulateRoleStop(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);

  const user = await validateSession(db, request);
  if (!user) return json({ ok: false, error: 'Not authenticated' }, 401);
  if (!user.isRealAdmin) return json({ ok: false, error: 'Only administrators can manage simulation.' }, 403);

  await db.prepare("UPDATE sessions SET simulating_role_id = NULL WHERE id = ?")
    .bind(user.sessionId).run();

  await logActivity(db, 'simulate_role_stop', 'session', user.sessionId,
    'Stopped role simulation', {}, user.userId);

  return json({ ok: true });
}

