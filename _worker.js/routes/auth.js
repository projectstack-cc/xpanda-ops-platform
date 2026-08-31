import { json, logActivity, validateSession, getSessionToken, SessionLookupError, sessionUnavailableResponse } from '../lib/core.js';

// QC Cleanup-10 / RT-01: minimum new-password length. Raised 4 -> 8, this prompt's own
// recommended value ("[STEVE: confirm - recommend 8]" — implemented at the recommendation per
// the prompt's own fallback instruction since Steve wasn't available to confirm synchronously).
// Single named constant so it's trivial to change if the floor-tablet UX tradeoff argues for a
// different number later. STEVE: please confirm 8 is right, or tell us the number you want here.
const MIN_PASSWORD_LENGTH = 8;

// QC Cleanup-10 / RT-02: login rate limiting threshold/window. See the KV helpers below
// (loginRateLimitKey/isLoginLocked/recordLoginFailure/clearLoginFailures).
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 15 * 60; // 15 minutes

async function resolveSessionUser(db, request) {
  try {
    return { user: await validateSession(db, request), transient: false };
  } catch (e) {
    if (e instanceof SessionLookupError) return { user: null, transient: true };
    throw e;
  }
}

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
  return `xpanda_session=${sessionId}; Path=/; Expires=${expDate}; HttpOnly; Secure; SameSite=Lax`;
}

function clearSessionCookie() {
  return `xpanda_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`;
}

// ========================
// QC Cleanup-10 / RT-02: login rate limiting
// ========================
// Per username+IP failure counter in Workers KV (binding: RATE_LIMIT — see wrangler.toml;
// KV-namespace-before-push GATE applies, see prompt-QC-Cleanup-10). KV is eventually consistent
// by design — accepted tradeoff here per the prompt (slows online guessing of a handful of
// accounts; does not need to be airtight, no Durable Object). These helpers fail OPEN (never
// block/lock anyone) on a missing binding or any KV read/write error, so a KV outage or a
// preview/local env without the binding never takes login itself down — rate limiting is
// defense-in-depth layered on top of the existing identical-error-message anti-enumeration
// behavior, not a hard dependency of login working at all.
function loginRateLimitKey(username, ip) {
  return `loginfail:${String(username || '').trim().toLowerCase()}:${ip}`;
}

async function isLoginLocked(kv, key) {
  if (!kv) return false;
  try {
    const raw = await kv.get(key);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return typeof data.count === 'number' && data.count >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS;
  } catch (e) {
    console.error('Login rate limit KV read failed:', e);
    return false;
  }
}

async function recordLoginFailure(kv, key) {
  if (!kv) return;
  try {
    const raw = await kv.get(key);
    let count = 1;
    if (raw) {
      const data = JSON.parse(raw);
      if (typeof data.count === 'number') count = data.count + 1;
    }
    await kv.put(key, JSON.stringify({ count }), { expirationTtl: LOGIN_RATE_LIMIT_WINDOW_SECONDS });
  } catch (e) {
    console.error('Login rate limit KV write failed:', e);
  }
}

async function clearLoginFailures(kv, key) {
  if (!kv) return;
  try { await kv.delete(key); } catch (e) { console.error('Login rate limit KV clear failed:', e); }
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

  const kv = env.RATE_LIMIT;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateLimitKey = loginRateLimitKey(username, ip);

  try {
    // RT-02: check the failure counter BEFORE touching the DB. The lockout message is
    // identical regardless of whether `username` is real — the counter is keyed off the
    // submitted username+IP for every attempt, real account or not — so it reveals nothing
    // about account existence, preserving the existing anti-enumeration behavior.
    if (await isLoginLocked(kv, rateLimitKey)) {
      return json({ ok: false, error: 'Too many attempts. Try again later.' }, 429);
    }

    const user = await db.prepare(
      `SELECT id, username, display_name, role, is_active, first_login, password
       FROM users WHERE username = ? COLLATE NOCASE`
    ).bind(username).first();

    if (!user || !user.is_active) {
      await recordLoginFailure(kv, rateLimitKey);
      return json({ ok: false, error: 'Invalid username or password.' }, 401);
    }
    if (user.password !== password) {
      await recordLoginFailure(kv, rateLimitKey);
      return json({ ok: false, error: 'Invalid username or password.' }, 401);
    }

    await clearLoginFailures(kv, rateLimitKey);

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
    console.error(e && e.stack ? e.stack : e);
    return json({ ok: false, error: 'Server error.' }, 500);
  }
}

export async function handleAuthLogout(request, env) {
  const db = env.DB;
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  // Best-effort server-side session teardown. This must NEVER throw before the
  // clear-cookie header is emitted — a prior bug (unexported helper) made logout
  // 500 and left the cookie alive ("signs out, then refreshes back in", P305).
  try {
    const token = getSessionToken(request);
    if (token && db) {
      await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(token).run();
    }
  } catch {}

  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}

export async function handleAuthMe(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);

  const { user, transient } = await resolveSessionUser(db, request);
  if (transient) return sessionUnavailableResponse();
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

  const { user, transient } = await resolveSessionUser(db, request);
  if (transient) return sessionUnavailableResponse();
  if (!user) return json({ ok: false, error: 'Not authenticated' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const currentPassword = String(body.current_password || '');
  const newPassword = String(body.new_password || '');

  // RT-01: current_password is now required — a bare session is no longer sufficient to change
  // the password (previously: session-only, no current-password check at all).
  if (!currentPassword) return json({ ok: false, error: 'Current password is required.' }, 400);
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return json({ ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
  }

  try {
    // Plaintext comparison — matches this repo's documented plaintext-password-at-rest design
    // (AGENTS.md Sec 3: "intentional — admin recovery for floor workers"). Hashing is explicitly
    // out of scope for this prompt. This does NOT touch the separate admin recovery path
    // (`/api/users`, handled in admin.js) — that stays untouched.
    const row = await db.prepare(`SELECT password FROM users WHERE id = ?`).bind(user.userId).first();
    if (!row || row.password !== currentPassword) {
      return json({ ok: false, error: 'Current password is incorrect.' }, 400);
    }

    await db.prepare(
      `UPDATE users SET password = ?, first_login = 0, updated_at = ? WHERE id = ?`
    ).bind(newPassword, new Date().toISOString(), user.userId).run();

    // RT-01 / RT-09: invalidate every OTHER session for this user so a stolen/XSS'd session
    // can't silently reset the password and keep permanent access while the real user stays
    // logged in unaware. Keep the current session (the one making this request) alive.
    await db.prepare(`DELETE FROM sessions WHERE user_id = ? AND id != ?`)
      .bind(user.userId, user.sessionId).run();

    return json({ ok: true });
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    return json({ ok: false, error: 'Server error.' }, 500);
  }
}

export async function handleSimulateRoleStart(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);

  const { user, transient } = await resolveSessionUser(db, request);
  if (transient) return sessionUnavailableResponse();
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

  const { user, transient } = await resolveSessionUser(db, request);
  if (transient) return sessionUnavailableResponse();
  if (!user) return json({ ok: false, error: 'Not authenticated' }, 401);
  if (!user.isRealAdmin) return json({ ok: false, error: 'Only administrators can manage simulation.' }, 403);

  await db.prepare("UPDATE sessions SET simulating_role_id = NULL WHERE id = ?")
    .bind(user.sessionId).run();

  await logActivity(db, 'simulate_role_stop', 'session', user.sessionId,
    'Stopped role simulation', {}, user.userId);

  return json({ ok: true });
}

