# Prompt 21 — Authentication System: Backend

## Goal

Add username/password authentication to the xPanda Ops Platform. This prompt covers the backend: users table, sessions table, login/logout API, session validation middleware that gates all routes, and a users management API for admins.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

**Note:** `AGENTS.md` section 5 lists authentication under "do not add unless explicitly requested." This feature has been explicitly requested by the platform owner.

---

## Context

The platform is a Cloudflare Pages Advanced Mode app. All routes go through `_worker.js`. The routing block (lines 3–139) handles API routes first, then falls through to `env.ASSETS.fetch(request)` for static pages.

The auth system must:
- Gate **everything** — all API routes and all static pages require a valid session
- Use username + password for all users (no email-based auth)
- Store passwords as **plaintext** in D1 (intentional — admin needs to read them back for floor workers who forget)
- Support three roles: `admin`, `staff`, `readonly`
- Support a first-login password change flow
- Use session cookies with configurable expiry

---

## Step 1 — Database migration

Create `auth.sql` at the project root:

```sql
-- MANUAL STEP: Run this migration in the Cloudflare D1 Dashboard Console.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'staff',
  is_active INTEGER NOT NULL DEFAULT 1,
  first_login INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Seed the admin account. Password is 'admin' — MUST be changed on first login.
INSERT OR IGNORE INTO users (id, username, display_name, password, role, is_active, first_login)
VALUES ('admin-seed-001', 'admin', 'Administrator', 'admin', 'admin', 1, 1);
```

### Schema notes

**users:**
- `username`: case-insensitive unique identifier (e.g. "steve", "crosscutter", "admin")
- `display_name`: friendly name shown in UI (e.g. "Steve", "Cross Cutter")
- `password`: plaintext — intentional for admin recovery. The admin can view any user's password.
- `role`: "admin", "staff", or "readonly"
- `is_active`: 1 = can login, 0 = disabled (soft delete)
- `first_login`: 1 = must set a new password on next login, 0 = normal login

**sessions:**
- `id`: the session token (a UUID), stored as cookie value
- `user_id`: FK to users
- `expires_at`: ISO timestamp; sessions past this are invalid
- Session duration: 30 days for all users (floor stations stay logged in)

---

## Step 2 — Auth helper functions

Add these helper functions in `_worker.js` **after** the `logActivity` function (line 186) and **before** `isAdminAuthorized` (line 188):

### 2a. Session cookie parser

```javascript
function getSessionToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)xpanda_session=([^;]+)/);
  return match ? match[1] : null;
}
```

### 2b. Session validator

```javascript
async function validateSession(db, request) {
  const token = getSessionToken(request);
  if (!token) return null;

  try {
    const session = await db.prepare(
      "SELECT s.id, s.user_id, s.expires_at, u.id as uid, u.username, u.display_name, u.role, u.is_active, u.first_login FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ?"
    ).bind(token).first();

    if (!session) return null;
    if (!session.is_active) return null;
    if (new Date(session.expires_at) < new Date()) {
      // Expired — clean up
      await db.prepare("DELETE FROM sessions WHERE id = ?").bind(token).run();
      return null;
    }

    return {
      userId: session.uid,
      username: session.username,
      displayName: session.display_name,
      role: session.role,
      firstLogin: session.first_login === 1,
      sessionId: session.id,
    };
  } catch (e) {
    console.error('Session validation failed:', e);
    return null;
  }
}
```

### 2c. Session creation

```javascript
async function createSession(db, userId) {
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await db.prepare(
    "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).bind(sessionId, userId, expires.toISOString(), now.toISOString()).run();

  return { sessionId, expires };
}
```

### 2d. Session cookie setter

```javascript
function sessionCookie(sessionId, expires) {
  return `xpanda_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}`;
}

function clearSessionCookie() {
  return 'xpanda_session=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
}
```

---

## Step 3 — Login and Logout API handlers

### 3a. POST `/api/auth/login`

```javascript
async function handleAuthLogin(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "DB not available" }, 500);
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let payload;
  try { payload = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');

  if (!username || !password) return json({ ok: false, error: "Username and password are required." }, 400);

  const user = await db.prepare(
    "SELECT * FROM users WHERE username = ? COLLATE NOCASE"
  ).bind(username).first();

  if (!user || !user.is_active) return json({ ok: false, error: "Invalid username or password." }, 401);
  if (user.password !== password) return json({ ok: false, error: "Invalid username or password." }, 401);

  const { sessionId, expires } = await createSession(db, user.id);

  await logActivity(db, 'login', 'user', user.id, `${user.display_name || user.username} logged in`, { username: user.username });

  return json(
    {
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        firstLogin: user.first_login === 1,
      },
    },
    200,
    { 'Set-Cookie': sessionCookie(sessionId, expires) }
  );
}
```

### 3b. POST `/api/auth/logout`

```javascript
async function handleAuthLogout(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "DB not available" }, 500);

  const token = getSessionToken(request);
  if (token) {
    try { await db.prepare("DELETE FROM sessions WHERE id = ?").bind(token).run(); } catch {}
  }

  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}
```

### 3c. GET `/api/auth/me`

Returns the current user's info (used by frontend to check login status):

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
      firstLogin: user.firstLogin,
    },
  });
}
```

### 3d. POST `/api/auth/change-password`

For the first-login flow and voluntary password changes:

```javascript
async function handleAuthChangePassword(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "DB not available" }, 500);
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const user = await validateSession(db, request);
  if (!user) return json({ ok: false, error: "Not authenticated" }, 401);

  let payload;
  try { payload = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const newPassword = String(payload.new_password || '');
  if (newPassword.length < 4) return json({ ok: false, error: "Password must be at least 4 characters." }, 400);

  const now = new Date().toISOString();
  await db.prepare(
    "UPDATE users SET password = ?, first_login = 0, updated_at = ? WHERE id = ?"
  ).bind(newPassword, now, user.userId).run();

  await logActivity(db, 'update', 'user', user.userId, `${user.displayName || user.username} changed their password`, {});

  return json({ ok: true, message: "Password updated." });
}
```

---

## Step 4 — Users management API (admin only)

### Handler: `handleApiUsers`

```javascript
async function handleApiUsers(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: "DB not available" }, 500);

  const currentUser = await validateSession(db, request);
  if (!currentUser) return json({ ok: false, error: "Not authenticated" }, 401);
  if (currentUser.role !== 'admin') return json({ ok: false, error: "Admin access required." }, 403);

  const url = new URL(request.url);
  const method = request.method;

  // GET /api/users — list all users
  if (method === "GET") {
    try {
      const rows = await db.prepare(
        "SELECT id, username, display_name, password, role, is_active, first_login, created_at, updated_at FROM users ORDER BY created_at ASC"
      ).all();
      return json({ ok: true, users: rows.results || [] });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // POST /api/users — create user
  if (method === "POST") {
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const username = String(payload.username || '').trim().toLowerCase();
    const display_name = String(payload.display_name || '').trim() || username;
    const password = String(payload.password || '').trim();
    const role = ['admin', 'staff', 'readonly'].includes(payload.role) ? payload.role : 'staff';

    if (!username) return json({ ok: false, error: "Username is required." }, 400);
    if (username.length < 2) return json({ ok: false, error: "Username must be at least 2 characters." }, 400);
    if (/[^a-z0-9._-]/.test(username)) return json({ ok: false, error: "Username can only contain letters, numbers, dots, hyphens, underscores." }, 400);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // If no password provided, user must set one on first login
    const firstLogin = password ? 0 : 1;
    const pwd = password || username; // default password = username if none provided

    try {
      await db.prepare(
        `INSERT INTO users (id, username, display_name, password, role, is_active, first_login, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
      ).bind(id, username, display_name, pwd, role, firstLogin, now, now).run();

      const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
      await logActivity(db, 'create', 'user', id, `Created user "${display_name}" (${role})`, { username, role });
      return json({ ok: true, user }, 201);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/unique/i.test(msg)) return json({ ok: false, error: "Username already exists." }, 409);
      return json({ ok: false, error: "Server error.", detail: msg }, 500);
    }
  }

  // PUT /api/users — update user
  if (method === "PUT") {
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id = String(payload.id || '').trim();
    if (!id) return json({ ok: false, error: "id is required." }, 400);

    const existing = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "User not found." }, 404);

    const updates = [];
    const binds = [];

    if (payload.display_name !== undefined) { updates.push("display_name = ?"); binds.push(String(payload.display_name).trim()); }
    if (payload.password !== undefined) { updates.push("password = ?"); binds.push(String(payload.password)); }
    if (payload.role !== undefined && ['admin', 'staff', 'readonly'].includes(payload.role)) { updates.push("role = ?"); binds.push(payload.role); }
    if (payload.is_active !== undefined) { updates.push("is_active = ?"); binds.push(payload.is_active ? 1 : 0); }
    if (payload.first_login !== undefined) { updates.push("first_login = ?"); binds.push(payload.first_login ? 1 : 0); }

    if (updates.length === 0) return json({ ok: false, error: "No fields to update." }, 400);

    updates.push("updated_at = ?");
    binds.push(new Date().toISOString());
    binds.push(id);

    try {
      await db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();
      const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
      await logActivity(db, 'update', 'user', id, `Updated user "${user.display_name}"`, { fields: Object.keys(payload).filter(k => k !== 'id') });
      return json({ ok: true, user });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  // DELETE /api/users — delete user (or deactivate)
  if (method === "DELETE") {
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    const id = String(payload.id || '').trim();
    if (!id) return json({ ok: false, error: "id is required." }, 400);

    // Don't allow deleting yourself
    if (id === currentUser.userId) return json({ ok: false, error: "Cannot delete your own account." }, 400);

    const existing = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
    if (!existing) return json({ ok: false, error: "User not found." }, 404);

    try {
      // Delete all sessions for this user
      await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
      // Delete the user
      await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
      await logActivity(db, 'delete', 'user', id, `Deleted user "${existing.display_name}"`, { username: existing.username });
      return json({ ok: true, message: "User deleted." });
    } catch (e) {
      return json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
}
```

---

## Step 5 — Wire auth routes in the routing block

In the main routing block at the top of `_worker.js` (inside the `async fetch()` function), add auth routes **before** the existing API routes (after the health check on line 15, before the `// 2) API routes` comment on line 18):

```javascript
// ── Auth routes (always accessible, no session required) ─────────
if (url.pathname === "/api/auth/login") {
  return handleAuthLogin(request, env);
}
if (url.pathname === "/api/auth/logout") {
  return handleAuthLogout(request, env);
}
if (url.pathname === "/api/auth/me") {
  return handleAuthMe(request, env);
}
if (url.pathname === "/api/auth/change-password") {
  return handleAuthChangePassword(request, env);
}
if (url.pathname === "/api/users") {
  return handleApiUsers(request, env);
}

// ── Login page (static, always accessible) ────────────────────────
if (url.pathname === "/login" || url.pathname === "/login.html") {
  return env.ASSETS.fetch(request);
}

// ── Session gate: everything below requires authentication ────────
if (url.pathname.startsWith("/api/") || !url.pathname.startsWith("/api/")) {
  const db = env.DB;
  if (db) {
    const user = await validateSession(db, request);
    if (!user) {
      // API requests get 401 JSON
      if (url.pathname.startsWith("/api/")) {
        return json({ ok: false, error: "Not authenticated" }, 401);
      }
      // Page requests redirect to login
      return Response.redirect(`${url.origin}/login`, 302);
    }
    // Attach user to request for downstream handlers (via header injection)
    request = new Request(request.url, {
      method: request.method,
      headers: new Headers([...request.headers.entries(),
        ['X-User-Id', user.userId],
        ['X-User-Role', user.role],
        ['X-User-Name', user.displayName || user.username],
      ]),
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
    });
  }
}
```

**The routing block should now look like this (in order):**

1. Training redirect
2. Health check
3. Auth routes (login, logout, me, change-password, users) — **no session required**
4. Login page static serve — **no session required**
5. **Session gate** — validates session; redirects to `/login` for pages, returns 401 for APIs
6. All existing API routes (jobs, bols, parts, etc.) — **session required**
7. Static asset passthrough — **session required** (handled by the gate above)

**Critical:** The session gate must come AFTER the auth routes and login page serve, but BEFORE all other routes. Do not put it after the API routes or the static fallthrough.

---

## Step 6 — Add role-based write protection

This is a lightweight layer. Add a helper:

```javascript
function canWrite(request) {
  const role = request.headers.get('X-User-Role') || 'readonly';
  return role === 'admin' || role === 'staff';
}

function isAdmin(request) {
  return request.headers.get('X-User-Role') === 'admin';
}
```

**For now, do NOT add role checks to individual API handlers.** The session gate is sufficient for the initial rollout. Role-based restrictions on specific endpoints will be added in a follow-up prompt once the user management page is in use and roles are assigned. The `canWrite` and `isAdmin` helpers are just being placed for future use.

---

## Step 7 — Update `logActivity` calls with user context

In the `logActivity` helper (line 169), add an optional `userId` parameter:

Change the function signature from:
```javascript
async function logActivity(db, action, entityType, entityId, summary, detail)
```
To:
```javascript
async function logActivity(db, action, entityType, entityId, summary, detail, userId)
```

And update the INSERT to include a `user_id` if provided. But first, we need to add the column to the activity_log table.

Add to `auth.sql`:
```sql
-- Add user tracking to activity log (safe to run if column doesn't exist)
ALTER TABLE activity_log ADD COLUMN user_id TEXT DEFAULT NULL;
```

Update the `logActivity` helper to include `user_id`:
```javascript
async function logActivity(db, action, entityType, entityId, summary, detail, userId) {
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
```

**Do NOT update all existing `logActivity` calls** to pass `userId` — that requires updating every handler to extract the user from the request headers. That's a follow-up task. Existing calls will simply pass `undefined` for `userId`, which becomes `null`. This is backward-compatible.

---

## Step 8 — Session cleanup (optional, recommended)

Add a lightweight expired session cleanup that runs occasionally. At the top of `validateSession`, before the query:

```javascript
// Clean up expired sessions ~1% of the time to avoid table bloat
if (Math.random() < 0.01) {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?")
    .bind(new Date().toISOString()).run().catch(() => {});
}
```

This is non-blocking (fire-and-forget via `.catch(() => {})`).

---

## What NOT to touch

- Do NOT modify any existing API handler logic (jobs, bols, parts, shipments, etc.)
- Do NOT modify any existing frontend pages (that's Prompt 22)
- Do NOT modify CSS files
- Do NOT modify `AGENTS.md`
- Do NOT add role checks to individual endpoints yet
- Do NOT hash passwords — plaintext storage is intentional for admin recovery
- Do NOT modify the `json()` helper or `logActivity` call sites

---

## Completion checklist

Before stopping, verify:
- [ ] `auth.sql` migration file created with users, sessions tables, and admin seed
- [ ] Auth helper functions added: `getSessionToken`, `validateSession`, `createSession`, `sessionCookie`, `clearSessionCookie`
- [ ] `handleAuthLogin` — validates credentials, creates session, sets cookie
- [ ] `handleAuthLogout` — deletes session, clears cookie
- [ ] `handleAuthMe` — returns current user info
- [ ] `handleAuthChangePassword` — updates password, clears first_login flag
- [ ] `handleApiUsers` — full CRUD, admin-only (GET returns passwords for admin visibility)
- [ ] Auth routes wired in routing block BEFORE existing API routes
- [ ] Session gate added AFTER auth routes, BEFORE all other routes
- [ ] API routes return 401 JSON when unauthenticated
- [ ] Page routes redirect to `/login` when unauthenticated
- [ ] `logActivity` updated to accept optional `userId` parameter
- [ ] `canWrite()` and `isAdmin()` helpers added (for future use)
- [ ] Expired session cleanup added to `validateSession`

**Notify Steve:** After completion, tell him to:
1. Run `auth.sql` in the Cloudflare D1 Dashboard Console
2. Deploy
3. Wait for Prompt 22 (login page) before testing — without the login page, the redirect will 404
