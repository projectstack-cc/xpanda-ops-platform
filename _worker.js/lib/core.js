// _worker.js/lib/core.js — shared helpers imported by index.js and future sub-modules

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export function generateAccessToken() {
  const bytes = new Uint8Array(16); // 128 bits
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function logActivity(db, action, entityType, entityId, summary, detail, userId) {
  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail || {});
    await db.prepare(
      `INSERT INTO activity_log (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, now, action, entityType, String(entityId || ''),
      String(summary || '').slice(0, 500),
      detailStr.slice(0, 2000),
      userId || null,
      now
    ).run();
  } catch (e) {
    console.error('Activity log write failed:', e);
  }
}

// ========================
// Auth Helpers
// ========================

function getSessionToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)xpanda_session=([^;]+)/);
  return match ? match[1] : null;
}

export async function validateSession(db, request) {
  const token = getSessionToken(request);
  if (!token) return null;

  // Clean up expired sessions ~1% of the time
  if (Math.random() < 0.01) {
    db.prepare("DELETE FROM sessions WHERE expires_at < ?")
      .bind(new Date().toISOString()).run().catch(() => {});
  }

  try {
    // Get session + user (without role — roles come from junction table)
    const session = await db.prepare(`
      SELECT s.id, s.user_id, s.expires_at, s.simulating_role_id,
             u.id as uid, u.username, u.display_name, u.role, u.role_id, u.is_active, u.first_login
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.id = ?
    `).bind(token).first();

    if (!session) return null;
    if (!session.is_active) return null;
    if (new Date(session.expires_at) < new Date()) {
      await db.prepare("DELETE FROM sessions WHERE id = ?").bind(token).run();
      return null;
    }

    // Fetch ALL roles for this user from the junction table
    const roleRows = await db.prepare(`
      SELECT r.id, r.name, r.permissions
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = ?
    `).bind(session.uid).all();

    const userRoles = roleRows.results || [];

    // Check if user has the Administrator role (real check, before simulation)
    const isRealAdmin = userRoles.some(r => r.id === 'role-administrator') || session.role === 'admin';

    // Merge permissions from all real roles: most permissive wins per key
    const mergedPermissions = {};
    for (const role of userRoles) {
      let perms = {};
      try { perms = JSON.parse(role.permissions || '{}'); } catch {}
      for (const [key, val] of Object.entries(perms)) {
        if (!mergedPermissions[key]) mergedPermissions[key] = { view: false, edit: false };
        if (val.view) mergedPermissions[key].view = true;
        if (val.edit) mergedPermissions[key].edit = true;
      }
    }

    // Fallback: if junction table is empty, use legacy role_id
    if (userRoles.length === 0 && session.role_id) {
      const fallbackRole = await db.prepare("SELECT * FROM roles WHERE id = ?").bind(session.role_id).first();
      if (fallbackRole) {
        try {
          const perms = JSON.parse(fallbackRole.permissions || '{}');
          for (const [key, val] of Object.entries(perms)) {
            if (!mergedPermissions[key]) mergedPermissions[key] = { view: false, edit: false };
            if (val.view) mergedPermissions[key].view = true;
            if (val.edit) mergedPermissions[key].edit = true;
          }
        } catch {}
        userRoles.push(fallbackRole);
      }
    }

    // Simulation: if admin is simulating a role, override permissions
    let simulatingRole = null;
    let effectivePermissions = mergedPermissions;
    let effectiveRole = userRoles.map(r => r.name).join(', ') || session.role || 'staff';

    if (isRealAdmin && session.simulating_role_id) {
      const simRole = await db.prepare("SELECT id, name, permissions FROM roles WHERE id = ?")
        .bind(session.simulating_role_id).first();
      if (simRole) {
        simulatingRole = { id: simRole.id, name: simRole.name };
        effectiveRole = simRole.name;
        try { effectivePermissions = JSON.parse(simRole.permissions || '{}'); } catch { effectivePermissions = {}; }
      }
    }

    const isSimulating = simulatingRole !== null;

    return {
      userId: session.uid,
      username: session.username,
      displayName: session.display_name,
      role: effectiveRole,
      roleIds: userRoles.map(r => r.id),
      roleNames: userRoles.map(r => r.name),
      firstLogin: session.first_login === 1,
      sessionId: session.id,
      isAdministrator: isRealAdmin && !isSimulating,
      isRealAdmin,
      permissions: effectivePermissions,
      simulatingRole,
    };
  } catch (e) {
    console.error('Session validation failed:', e);
    return null;
  }
}

export const PATH_PERMISSION_MAP = [
  { pattern: /^\/admin\//,                                                    key: 'admin' },
  { pattern: /^\/jobs\//,                                                     key: 'jobs' },
  { pattern: /^\/logistics\/bol-generator/,                                   key: 'logistics.bol' },
  { pattern: /^\/logistics\/load-builder/,                                    key: 'logistics.load-builder' },
  { pattern: /^\/logistics\/loading/,                                         key: 'logistics.loading' },
  { pattern: /^\/logistics\//,                                                key: 'logistics.dashboard' },
  { pattern: /^\/manufacturing\/cutting-dashboard/,                           key: 'manufacturing.cutting' },
  { pattern: /^\/manufacturing\//,                                            key: 'manufacturing.calculators' },
  { pattern: /^\/production\//,                                               key: 'production.inventory' },
  { pattern: /^\/qc\//,                                                       key: 'qc' },
  { pattern: /^\/safety\//,                                                   key: 'safety' },
  { pattern: /^\/reports\//,                                                  key: 'reports' },
];

export const API_PERMISSION_MAP = [
  { pattern: /^\/api\/users/,              key: 'admin' },
  { pattern: /^\/api\/roles/,              key: 'admin' },
  { pattern: /^\/api\/activity-log/,       key: 'admin' },
  { pattern: /^\/api\/jobs/,              key: 'jobs' },
  { pattern: /^\/api\/bols/,              key: 'logistics.bol' },
  { pattern: /^\/api\/bol-customers/,     key: 'logistics.bol' },
  { pattern: /^\/api\/bol-carriers/,      key: 'logistics.bol' },
  { pattern: /^\/api\/shipments/,         key: 'logistics.dashboard' },
  { pattern: /^\/api\/load-builder-skus/, key: 'logistics.load-builder' },
  { pattern: /^\/api\/saved-loads/,       key: 'logistics.load-builder' },
  { pattern: /^\/api\/loading-bays/,      key: 'logistics.loading' },
  { pattern: /^\/api\/loading-assignments/, key: 'logistics.loading' },
  { pattern: /^\/api\/loading-photos/, key: 'logistics.loading' },
  { pattern: /^\/api\/parts/,             key: 'manufacturing.calculators' },
  { pattern: /^\/api\/combos/,            key: 'manufacturing.calculators' },
  { pattern: /^\/api\/bead/,              key: 'production.inventory' },
  { pattern: /^\/api\/block/,             key: 'production.inventory' },
  { pattern: /^\/api\/molding-log/,       key: 'production.inventory' },
  { pattern: /^\/api\/scrap-log/,         key: 'qc' },
  { pattern: /^\/api\/completions/,       key: 'qc' },
  { pattern: /^\/api\/reports/,           key: 'reports' },
];

export function getPermissionKey(pathname, isApi) {
  const map = isApi ? API_PERMISSION_MAP : PATH_PERMISSION_MAP;
  for (const entry of map) {
    if (entry.pattern.test(pathname)) return entry.key;
  }
  return null;
}

export function hasPermission(user, permKey, action) {
  if (user.isAdministrator) return true;
  if (!permKey) return true;
  const perm = user.permissions[permKey];
  if (!perm) return false;
  if (action === 'view') return perm.view === true;
  if (action === 'edit') return perm.edit === true;
  return false;
}

export function normalizeName(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ");
}

export function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
