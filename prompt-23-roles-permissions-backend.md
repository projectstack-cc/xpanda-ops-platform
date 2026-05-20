# Prompt 23 — Roles & Permissions: Backend

## Goal

Replace the hardcoded role strings ("admin", "staff", "readonly") with a configurable `roles` table that stores per-module permissions as JSON. Add permission enforcement middleware to the session gate and API routes. The `administrator` role bypasses all checks.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

**Prerequisites:** Prompts 21 and 22 (auth system) must be completed.

---

## Context

Currently, the `users` table has a `role` TEXT column with values "admin", "staff", or "readonly". The session gate validates the session but performs no permission checks — any logged-in user can access everything.

This prompt introduces:
1. A `roles` table with a JSON `permissions` blob
2. Migration of existing users to reference roles
3. Permission check helpers
4. Enforcement at the session gate (page access) and API level (read/write)
5. A roles CRUD API for admin

---

## Permission Model

### Permission keys (modules and sub-modules)

```
jobs                    → /jobs/, /api/jobs
logistics.dashboard     → /logistics/index.html, /api/shipments
logistics.bol           → /logistics/bol-generator.html, /api/bols, /api/bol-customers, /api/bol-carriers, /api/bols/next-number
logistics.load-builder  → /logistics/load-builder.html, /api/load-builder-skus
production.calculators  → /production/block-calculator.html, /production/holey-board-calculator.html, /api/parts, /api/combos
production.inventory    → /production/inventory.html, /production/bead-inventory.html, /api/bead-types, /api/bead-stock, /api/block-inventory, /api/block-consumption, /api/molding-log
qc                      → /qc/*, /api/scrap-log, /api/completions
safety                  → /safety/*
reports                 → /reports/*, /api/reports/*
admin                   → /admin/*, /api/users, /api/activity-log
```

### Permission levels per key

Each permission key has two boolean flags:
- `view`: can access the page and make GET requests
- `edit`: can make POST, PUT, DELETE requests

### Administrator bypass

The role named `administrator` (seeded with id `role-administrator`) **always bypasses all permission checks**. This is hardcoded in the permission check functions — the permissions JSON on the administrator role is irrelevant. This ensures admin can never be accidentally locked out.

---

## Step 1 — Database migration

Create `roles-permissions.sql` at the project root:

```sql
-- MANUAL STEP: Run this migration in the Cloudflare D1 Dashboard Console.

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '{}',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_name ON roles(name);

-- Add role_id FK to users table
ALTER TABLE users ADD COLUMN role_id TEXT DEFAULT NULL;

-- Seed the three default roles

-- Administrator: bypasses all checks (permissions JSON is irrelevant but included for completeness)
INSERT OR IGNORE INTO roles (id, name, description, permissions, is_system) VALUES (
  'role-administrator',
  'Administrator',
  'Full unrestricted access to all platform features',
  '{"jobs":{"view":true,"edit":true},"logistics.dashboard":{"view":true,"edit":true},"logistics.bol":{"view":true,"edit":true},"logistics.load-builder":{"view":true,"edit":true},"production.calculators":{"view":true,"edit":true},"production.inventory":{"view":true,"edit":true},"qc":{"view":true,"edit":true},"safety":{"view":true,"edit":true},"reports":{"view":true,"edit":true},"admin":{"view":true,"edit":true}}',
  1
);

-- Staff: can view and edit most things, no admin
INSERT OR IGNORE INTO roles (id, name, description, permissions, is_system) VALUES (
  'role-staff',
  'Staff',
  'Standard access — view and edit production modules',
  '{"jobs":{"view":true,"edit":true},"logistics.dashboard":{"view":true,"edit":true},"logistics.bol":{"view":true,"edit":false},"logistics.load-builder":{"view":true,"edit":false},"production.calculators":{"view":true,"edit":true},"production.inventory":{"view":true,"edit":true},"qc":{"view":true,"edit":true},"safety":{"view":true,"edit":false},"reports":{"view":true,"edit":false},"admin":{"view":false,"edit":false}}',
  1
);

-- Readonly: view only, no edits anywhere
INSERT OR IGNORE INTO roles (id, name, description, permissions, is_system) VALUES (
  'role-readonly',
  'Read Only',
  'View-only access — cannot create, edit, or delete anything',
  '{"jobs":{"view":true,"edit":false},"logistics.dashboard":{"view":true,"edit":false},"logistics.bol":{"view":true,"edit":false},"logistics.load-builder":{"view":true,"edit":false},"production.calculators":{"view":true,"edit":false},"production.inventory":{"view":true,"edit":false},"qc":{"view":true,"edit":false},"safety":{"view":true,"edit":false},"reports":{"view":true,"edit":false},"admin":{"view":false,"edit":false}}',
  1
);

-- Migrate existing users to role_id based on their current role text
UPDATE users SET role_id = 'role-administrator' WHERE role = 'admin' AND role_id IS NULL;
UPDATE users SET role_id = 'role-staff' WHERE role = 'staff' AND role_id IS NULL;
UPDATE users SET role_id = 'role-readonly' WHERE role = 'readonly' AND role_id IS NULL;
```

### Notes:
- `is_system`: 1 for the three seeded roles. System roles can be edited (permissions changed) but not deleted.
- The `users.role` TEXT column remains for backward compatibility but `role_id` is the authoritative source going forward.
- `permissions` is a JSON string. Parsed at runtime.

---

## Step 2 — Update `validateSession` to include permissions

In `_worker.js`, find the `validateSession` function. Update the SQL query to JOIN on the `roles` table and include permissions:

```javascript
async function validateSession(db, request) {
  const token = getSessionToken(request);
  if (!token) return null;

  try {
    const session = await db.prepare(`
      SELECT s.id, s.user_id, s.expires_at,
             u.id as uid, u.username, u.display_name, u.role, u.role_id, u.is_active, u.first_login,
             r.name as role_name, r.permissions as role_permissions
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE s.id = ?
    `).bind(token).first();

    if (!session) return null;
    if (!session.is_active) return null;
    if (new Date(session.expires_at) < new Date()) {
      await db.prepare("DELETE FROM sessions WHERE id = ?").bind(token).run();
      return null;
    }

    // Parse permissions JSON
    let permissions = {};
    try { permissions = JSON.parse(session.role_permissions || '{}'); } catch {}

    // Determine if this is an administrator (bypasses all checks)
    const isAdministrator = session.role_id === 'role-administrator' || session.role === 'admin';

    return {
      userId: session.uid,
      username: session.username,
      displayName: session.display_name,
      role: session.role_name || session.role || 'staff',
      roleId: session.role_id,
      firstLogin: session.first_login === 1,
      sessionId: session.id,
      isAdministrator,
      permissions,
    };
  } catch (e) {
    console.error('Session validation failed:', e);
    return null;
  }
}
```

---

## Step 3 — Permission check helpers

Add these after the `clearSessionCookie` function:

### 3a. Path-to-permission-key mapping

```javascript
const PATH_PERMISSION_MAP = [
  // Order matters — more specific paths first
  { pattern: /^\/admin\//,                              key: 'admin' },
  { pattern: /^\/jobs\//,                               key: 'jobs' },
  { pattern: /^\/logistics\/bol-generator/,             key: 'logistics.bol' },
  { pattern: /^\/logistics\/load-builder/,              key: 'logistics.load-builder' },
  { pattern: /^\/logistics\//,                          key: 'logistics.dashboard' },
  { pattern: /^\/production\/(block-calculator|holey-board-calculator)/,  key: 'production.calculators' },
  { pattern: /^\/production\//,                         key: 'production.inventory' },
  { pattern: /^\/qc\//,                                 key: 'qc' },
  { pattern: /^\/safety\//,                             key: 'safety' },
  { pattern: /^\/reports\//,                            key: 'reports' },
];

const API_PERMISSION_MAP = [
  { pattern: /^\/api\/users/,                           key: 'admin' },
  { pattern: /^\/api\/roles/,                           key: 'admin' },
  { pattern: /^\/api\/activity-log/,                    key: 'admin' },
  { pattern: /^\/api\/jobs/,                            key: 'jobs' },
  { pattern: /^\/api\/bols/,                            key: 'logistics.bol' },
  { pattern: /^\/api\/bol-customers/,                   key: 'logistics.bol' },
  { pattern: /^\/api\/bol-carriers/,                    key: 'logistics.bol' },
  { pattern: /^\/api\/shipments/,                       key: 'logistics.dashboard' },
  { pattern: /^\/api\/load-builder-skus/,               key: 'logistics.load-builder' },
  { pattern: /^\/api\/parts/,                           key: 'production.calculators' },
  { pattern: /^\/api\/combos/,                          key: 'production.calculators' },
  { pattern: /^\/api\/bead/,                            key: 'production.inventory' },
  { pattern: /^\/api\/block/,                           key: 'production.inventory' },
  { pattern: /^\/api\/molding-log/,                     key: 'production.inventory' },
  { pattern: /^\/api\/scrap-log/,                       key: 'qc' },
  { pattern: /^\/api\/completions/,                     key: 'qc' },
  { pattern: /^\/api\/reports/,                         key: 'reports' },
];
```

### 3b. Permission check function

```javascript
function getPermissionKey(pathname, isApi) {
  const map = isApi ? API_PERMISSION_MAP : PATH_PERMISSION_MAP;
  for (const entry of map) {
    if (entry.pattern.test(pathname)) return entry.key;
  }
  return null; // No permission mapping found — allow by default (e.g. homepage)
}

function hasPermission(user, permKey, action) {
  // Administrator bypasses all checks
  if (user.isAdministrator) return true;
  // No permission key mapped — allow (homepage, health, etc.)
  if (!permKey) return true;
  // Check the permissions object
  const perm = user.permissions[permKey];
  if (!perm) return false; // Key not in permissions = no access
  if (action === 'view') return perm.view === true;
  if (action === 'edit') return perm.edit === true;
  return false;
}
```

---

## Step 4 — Enforce permissions in the session gate

In the session gate block (the middleware that runs after auth routes and before other routes), update the permission check.

Find the existing session gate. It currently:
1. Validates the session
2. If no session → redirect to /login (pages) or return 401 (APIs)
3. If valid → inject X-User headers and continue

**Add permission checks after step 2, before step 3:**

```javascript
// ── Permission check ─────────────────────────────────────────────
const isApi = url.pathname.startsWith('/api/');
const permKey = getPermissionKey(url.pathname, isApi);

if (permKey) {
  // Determine required action: GET = view, everything else = edit
  const requiredAction = (request.method === 'GET' || request.method === 'HEAD') ? 'view' : 'edit';

  if (!hasPermission(user, permKey, requiredAction)) {
    if (isApi) {
      return json({ ok: false, error: 'Access denied. Insufficient permissions.' }, 403);
    }
    // Page access denied — redirect to homepage with message
    return Response.redirect(`${url.origin}/?access_denied=1`, 302);
  }
}
```

Also update the header injection to include permissions data so the frontend can use it:

```javascript
request = new Request(request.url, {
  method: request.method,
  headers: new Headers([...request.headers.entries(),
    ['X-User-Id', user.userId],
    ['X-User-Role', user.role],
    ['X-User-Name', user.displayName || user.username],
    ['X-User-Permissions', JSON.stringify(user.permissions)],
    ['X-User-Is-Admin', user.isAdministrator ? '1' : '0'],
  ]),
  body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
});
```

---

## Step 5 — Add `/api/auth/me` permissions in response

Update `handleAuthMe` to include the user's permissions in the response:

```javascript
async function handleAuthMe(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "DB not available" }, 500);

  const user = await validateSession(db, request);
  if (!user) return json({ ok: false, error: "Not authenticated" }, 401);

  return json({
    ok: true,
    user: {
      id: user.userId,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      roleId: user.roleId,
      firstLogin: user.firstLogin,
      isAdministrator: user.isAdministrator,
      permissions: user.permissions,
    },
  });
}
```

---

## Step 6 — Roles CRUD API

Add a new handler `handleApiRoles` and wire it in the routing block.

### Route

Add **before** the session gate (since the session gate will check `admin` permission on `/api/roles`... wait, no — the roles API requires authentication AND admin permission. It should be AFTER the session gate):

Actually, the session gate already handles this. The API_PERMISSION_MAP maps `/api/roles` to `admin`. So the session gate will enforce admin-only access automatically. Just add the route in the API routing block:

```javascript
if (url.pathname === "/api/roles" || url.pathname.startsWith("/api/roles/")) {
  return handleApiRoles(request, env);
}
```

Add this near the other admin API routes (near `/api/users`).

### Handler

```javascript
async function handleApiRoles(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "DB not available" }, 500);

  const method = request.method;

  // GET /api/roles — list all roles
  if (method === "GET") {
    try {
      const rows = await db.prepare(
        "SELECT * FROM roles ORDER BY is_system DESC, name ASC"
      ).all();
      return json({ ok: true, roles: rows.results || [] });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // POST /api/roles — create role
  if (method === "POST") {
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const name = String(payload.name || '').trim();
    const description = String(payload.description || '').trim();
    const permissions = payload.permissions || {};

    if (!name) return json({ ok: false, error: "Role name is required." }, 400);
    if (name.length < 2) return json({ ok: false, error: "Role name must be at least 2 characters." }, 400);

    const id = 'role-' + crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await db.prepare(
        `INSERT INTO roles (id, name, description, permissions, is_system, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      ).bind(id, name, description, JSON.stringify(permissions), now, now).run();

      const role = await db.prepare("SELECT * FROM roles WHERE id = ?").bind(id).first();
      await logActivity(db, 'create', 'role', id, `Created role "${name}"`, { name, permissions });
      return json({ ok: true, role }, 201);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/unique/i.test(msg)) return json({ ok: false, error: "Role name already exists." }, 409);
      return json({ ok: false, error: "Server error.", detail: msg }, 500);
    }
  }

  // PUT /api/roles — update role
  if (method === "PUT") {
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id = String(payload.id || '').trim();
    if (!id) return json({ ok: false, error: "id is required." }, 400);

    const existing = await db.prepare("SELECT * FROM roles WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "Role not found." }, 404);

    // Prevent renaming administrator role
    if (id === 'role-administrator' && payload.name && payload.name !== existing.name) {
      return json({ ok: false, error: "Cannot rename the Administrator role." }, 400);
    }

    const updates = [];
    const binds = [];

    if (payload.name !== undefined) { updates.push("name = ?"); binds.push(String(payload.name).trim()); }
    if (payload.description !== undefined) { updates.push("description = ?"); binds.push(String(payload.description).trim()); }
    if (payload.permissions !== undefined) { updates.push("permissions = ?"); binds.push(JSON.stringify(payload.permissions)); }

    if (updates.length === 0) return json({ ok: false, error: "No fields to update." }, 400);

    updates.push("updated_at = ?");
    binds.push(new Date().toISOString());
    binds.push(id);

    try {
      await db.prepare(`UPDATE roles SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();
      const role = await db.prepare("SELECT * FROM roles WHERE id = ?").bind(id).first();
      await logActivity(db, 'update', 'role', id, `Updated role "${role.name}"`, { fields: Object.keys(payload).filter(k => k !== 'id') });
      return json({ ok: true, role });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // DELETE /api/roles — delete role
  if (method === "DELETE") {
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id = String(payload.id || '').trim();
    if (!id) return json({ ok: false, error: "id is required." }, 400);

    const existing = await db.prepare("SELECT * FROM roles WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "Role not found." }, 404);

    // Cannot delete system roles
    if (existing.is_system) return json({ ok: false, error: "Cannot delete a system role. Edit its permissions instead." }, 400);

    // Check if any users are assigned this role
    const usersWithRole = await db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role_id = ?").bind(id).first();
    if (usersWithRole && usersWithRole.cnt > 0) {
      return json({ ok: false, error: `Cannot delete role — ${usersWithRole.cnt} user(s) are assigned to it. Reassign them first.` }, 400);
    }

    try {
      await db.prepare("DELETE FROM roles WHERE id = ?").bind(id).run();
      await logActivity(db, 'delete', 'role', id, `Deleted role "${existing.name}"`, { name: existing.name });
      return json({ ok: true, message: "Role deleted." });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
}
```

---

## Step 7 — Update users API to use role_id

In `handleApiUsers`:

### GET response
Include `role_id` in the SELECT (it's already there via `SELECT *`). Also include the role name by JOINing:

Update the GET query:
```javascript
const rows = await db.prepare(
  "SELECT u.*, r.name as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id ORDER BY u.created_at ASC"
).all();
```

### POST — accept role_id
When creating a user, accept `role_id` from the payload. If not provided, default to `role-staff`:

```javascript
const role_id = String(payload.role_id || 'role-staff').trim();
// Also set the legacy role field for backward compat
const legacyRole = role_id === 'role-administrator' ? 'admin' : (role_id === 'role-readonly' ? 'readonly' : 'staff');
```

Add `role_id` to the INSERT and set `role` to `legacyRole`.

### PUT — accept role_id
When updating a user, if `role_id` is provided, update both `role_id` and the legacy `role` field:

```javascript
if (payload.role_id !== undefined) {
  updates.push("role_id = ?"); binds.push(payload.role_id);
  // Update legacy role field
  const legacyRole = payload.role_id === 'role-administrator' ? 'admin' : (payload.role_id === 'role-readonly' ? 'readonly' : 'staff');
  updates.push("role = ?"); binds.push(legacyRole);
}
```

---

## What NOT to touch

- Do NOT modify any frontend pages (that's Prompt 24)
- Do NOT modify any business logic (calculators, parsers, PDF generation)
- Do NOT modify the login/logout flow
- Do NOT remove the legacy `role` TEXT column from users — keep it for backward compatibility
- Do NOT modify CSS files
- Do NOT modify `AGENTS.md`
- Do NOT modify the `logActivity` function signature or existing call sites

---

## Completion checklist

Before stopping, verify:
- [ ] `roles-permissions.sql` migration file created with roles table + seed data + user migration
- [ ] `validateSession` updated to JOIN roles table and return permissions
- [ ] `PATH_PERMISSION_MAP` and `API_PERMISSION_MAP` constants added
- [ ] `getPermissionKey()` and `hasPermission()` helpers added
- [ ] Session gate enforces page permissions (redirect on deny)
- [ ] Session gate enforces API permissions (403 on deny)
- [ ] Administrator role bypasses ALL permission checks (hardcoded)
- [ ] `/api/auth/me` returns permissions in response
- [ ] `/api/roles` CRUD handler added (GET/POST/PUT/DELETE)
- [ ] System roles cannot be deleted
- [ ] Roles with assigned users cannot be deleted
- [ ] `/api/users` GET JOINs role name
- [ ] `/api/users` POST/PUT accept `role_id`
- [ ] X-User-Permissions and X-User-Is-Admin headers injected

**Notify Steve:** After completion, tell him to:
1. Run `roles-permissions.sql` in the Cloudflare D1 Dashboard Console
2. Deploy
3. Existing users will be migrated to the matching role automatically
4. Wait for Prompt 24 for the admin UI to manage roles
