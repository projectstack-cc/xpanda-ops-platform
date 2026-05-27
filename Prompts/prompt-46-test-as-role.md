# Prompt 46 — Test as Role (Admin Role Simulation)

## Goal

Allow administrators to simulate any non-administrator role so they can experience the platform exactly as that role would — with server-side permission enforcement. The simulation is activated from the Roles admin page, shows a persistent banner in the shared header on every page, and has an escape hatch ensuring `/admin/*` and `/api/auth/*` routes always remain accessible.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

**Prerequisites:** Prompts 23–24 (roles & permissions) must be completed.

---

## Context

The platform has a `roles` table with a JSON `permissions` blob and a `sessions` table for auth. `validateSession()` in `_worker.js` joins sessions → users → roles and returns a user object with `isAdministrator`, `permissions`, `roleId`, etc. The administrator role (`role-administrator`) bypasses all permission checks.

This feature adds a "simulation mode" where an admin's session temporarily adopts another role's permissions. The worker enforces the simulated role's permissions on all routes **except** admin pages and auth endpoints, so the admin can never lock themselves out.

---

## Step 1 — Database migration

Create `test-as-role.sql` at the project root:

```sql
-- MANUAL STEP: Run this migration in the Cloudflare D1 Dashboard Console.

ALTER TABLE sessions ADD COLUMN simulating_role_id TEXT DEFAULT NULL;
```

This column stores the role ID being simulated. When `NULL`, no simulation is active.

---

## Step 2 — API endpoints for simulation control

Add two new API routes in `_worker.js`. Place them near the other `/api/auth/*` routes.

### Route wiring

```javascript
if (url.pathname === "/api/auth/simulate-role" && method === "POST") {
  return handleSimulateRoleStart(request, env, user);
}
if (url.pathname === "/api/auth/simulate-role" && method === "DELETE") {
  return handleSimulateRoleStop(request, env, user);
}
```

These must be placed **after** the session gate (they require authentication) but must NOT be subject to permission checks — they are admin-only by explicit check inside the handler.

### 2a. Start simulation

```javascript
async function handleSimulateRoleStart(request, env, user) {
  const db = env.DB;

  // Only real administrators can simulate
  if (!user.isAdministrator) {
    return json({ ok: false, error: "Only administrators can simulate roles." }, 403);
  }

  let payload;
  try { payload = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const roleId = String(payload.roleId || '').trim();
  if (!roleId) return json({ ok: false, error: "roleId is required." }, 400);

  // Cannot simulate the administrator role itself
  if (roleId === 'role-administrator') {
    return json({ ok: false, error: "Cannot simulate the administrator role." }, 400);
  }

  // Verify the role exists
  const role = await db.prepare("SELECT id, name FROM roles WHERE id = ?").bind(roleId).first();
  if (!role) return json({ ok: false, error: "Role not found." }, 404);

  // Set simulation on the current session
  await db.prepare("UPDATE sessions SET simulating_role_id = ? WHERE id = ?")
    .bind(roleId, user.sessionId).run();

  return json({ ok: true, simulatingRole: { id: role.id, name: role.name } });
}
```

### 2b. Stop simulation

```javascript
async function handleSimulateRoleStop(request, env, user) {
  const db = env.DB;

  // Only real administrators can stop (but also check isRealAdmin in case permissions are simulated)
  if (!user.isRealAdmin) {
    return json({ ok: false, error: "Only administrators can manage simulation." }, 403);
  }

  await db.prepare("UPDATE sessions SET simulating_role_id = NULL WHERE id = ?")
    .bind(user.sessionId).run();

  return json({ ok: true });
}
```

---

## Step 3 — Update `validateSession` to load simulation state

Modify the existing `validateSession` function. The SQL query needs to also select `s.simulating_role_id` and optionally join the simulated role.

Replace the existing SELECT query inside `validateSession` with:

```javascript
const session = await db.prepare(`
  SELECT s.id, s.user_id, s.expires_at, s.simulating_role_id,
         u.id as uid, u.username, u.display_name, u.role, u.role_id, u.is_active, u.first_login,
         r.name as role_name, r.permissions as role_permissions,
         sr.name as sim_role_name, sr.permissions as sim_role_permissions
  FROM sessions s
  JOIN users u ON s.user_id = u.id
  LEFT JOIN roles r ON u.role_id = r.id
  LEFT JOIN roles sr ON s.simulating_role_id = sr.id
  WHERE s.id = ?
`).bind(token).first();
```

Then update the return object construction. After the existing `isAdministrator` determination, add simulation logic:

```javascript
// Determine if this is a real administrator (before simulation override)
const isRealAdmin = session.role_id === 'role-administrator' || session.role === 'admin';

// Check if simulating another role
const isSimulating = isRealAdmin && session.simulating_role_id && session.sim_role_name;

// If simulating, use the simulated role's permissions; otherwise use real permissions
let effectivePermissions = {};
try { effectivePermissions = JSON.parse(session.role_permissions || '{}'); } catch {}

let simulatingRole = null;
if (isSimulating) {
  try { effectivePermissions = JSON.parse(session.sim_role_permissions || '{}'); } catch {}
  simulatingRole = { id: session.simulating_role_id, name: session.sim_role_name };
}

return {
  userId: session.uid,
  username: session.username,
  displayName: session.display_name,
  role: isSimulating ? session.sim_role_name : (session.role_name || session.role || 'staff'),
  roleId: isSimulating ? session.simulating_role_id : session.role_id,
  firstLogin: session.first_login === 1,
  sessionId: session.id,
  isAdministrator: isRealAdmin && !isSimulating,  // Simulating suppresses admin bypass
  isRealAdmin,                                     // Always true for admins, even when simulating
  permissions: effectivePermissions,
  simulatingRole,
};
```

**Critical:** `isAdministrator` is now `false` when simulating, so the normal permission checks will enforce the simulated role. `isRealAdmin` stays `true` so the escape hatch routes can check it.

---

## Step 4 — Escape hatch: exempt admin and auth routes from simulation

Find the permission enforcement section in the worker — the part that calls `checkPagePermission` or `checkApiPermission` (added in Prompt 23). Before those checks run, add an escape hatch:

```javascript
// ESCAPE HATCH: Admin pages and auth API always accessible for real admins, even when simulating
if (user.isRealAdmin) {
  const escapePaths = ['/admin/', '/api/auth/', '/api/roles', '/api/users', '/login'];
  const isEscapePath = escapePaths.some(p => url.pathname.startsWith(p));
  if (isEscapePath) {
    // Skip permission check — real admin always has access to admin section
    // Continue to route handler normally
  }
}
```

The exact integration depends on how the permission gate is structured. The key rule: if `user.isRealAdmin === true` and the path starts with `/admin/`, `/api/auth/`, `/api/roles`, `/api/users`, or `/login`, skip the permission check entirely and let the request through.

For all other paths, the normal permission check runs using `user.permissions` (which now contains the simulated role's permissions when simulating).

---

## Step 5 — Update `/api/auth/me` response

In `handleAuthMe`, add `simulatingRole` and `isRealAdmin` to the response:

```javascript
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
    isRealAdmin: user.isRealAdmin || false,
    permissions: user.permissions,
    simulatingRole: user.simulatingRole || null,
  },
});
```

---

## Step 6 — Shared header banner (all three module headers)

In each shared header JS file (`logistics/logistics-header.js`, `jobs/jobs-header.js`, `production/production-header.js`), find where `window.__xpandaUser` is set after the `/api/auth/me` response. After that assignment, add:

```javascript
// Show simulation banner if active
if (window.__xpandaUser && window.__xpandaUser.simulatingRole) {
  const simBanner = document.createElement('div');
  simBanner.id = 'sim-role-banner';
  simBanner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;background:#f59e0b;color:#000;padding:6px 16px;display:flex;align-items:center;justify-content:center;gap:12px;font-size:14px;font-weight:600;box-shadow:0 2px 4px rgba(0,0,0,0.2);';
  simBanner.innerHTML = `
    <span>\u{1F50D} Testing as: ${window.__xpandaUser.simulatingRole.name}</span>
    <button id="sim-stop-btn" style="background:#fff;color:#000;border:1px solid #000;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:13px;font-weight:600;">Stop Testing</button>
  `;
  document.body.prepend(simBanner);

  // Push page content down so banner doesn't overlap
  document.body.style.paddingTop = (simBanner.offsetHeight) + 'px';

  document.getElementById('sim-stop-btn').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/auth/simulate-role', { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        window.location.reload();
      } else {
        alert('Failed to stop simulation: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      alert('Error stopping simulation: ' + e.message);
    }
  });
}
```

Also add the same banner logic to these admin pages that don't use shared headers:
- `admin/parts.html`
- `admin/activity-log.html`
- `admin/users.html`
- `admin/roles.html`

For admin pages, place the banner code right after their existing `/api/auth/me` fetch resolves. Same HTML/JS as above.

---

## Step 7 — "Test as Role" button on the Roles admin page

In `admin/roles.html`, find where role rows are rendered in the table. For each role that is NOT the administrator role, add a "Test" button.

Find the existing action buttons in each role row (Edit, Delete). Add a "Test" button before them:

```javascript
// Inside the role row rendering loop, after creating the edit/delete buttons:
if (role.id !== 'role-administrator') {
  const testBtn = document.createElement('button');
  testBtn.textContent = 'Test';
  testBtn.title = 'Preview platform as this role';
  testBtn.style.cssText = 'background:#f59e0b;color:#000;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px;font-weight:600;margin-right:4px;';
  testBtn.addEventListener('click', async () => {
    if (!confirm(`Start testing as "${role.name}"? You'll see the platform as this role would. Admin pages will remain accessible.`)) return;
    try {
      const res = await fetch('/api/auth/simulate-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleId: role.id }),
      });
      const data = await res.json();
      if (data.ok) {
        window.location.href = '/';  // Redirect to homepage to experience the simulated role
      } else {
        alert('Failed to start simulation: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
  actionCell.prepend(testBtn);
}
```

If the user is currently simulating a role, also show a status indicator at the top of the roles page:

```javascript
// After loading roles list, check if currently simulating
const meRes = await fetch('/api/auth/me');
const meData = await meRes.json();
if (meData.ok && meData.user.simulatingRole) {
  const statusDiv = document.createElement('div');
  statusDiv.style.cssText = 'background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;';
  statusDiv.innerHTML = `
    <span><strong>\u{1F50D} Currently testing as:</strong> ${meData.user.simulatingRole.name}</span>
    <button id="roles-stop-sim" style="background:#dc2626;color:#fff;border:none;border-radius:4px;padding:6px 14px;cursor:pointer;font-weight:600;">Stop Testing</button>
  `;
  // Insert before the roles table
  const table = document.querySelector('table') || document.querySelector('.roles-list');
  if (table) table.parentNode.insertBefore(statusDiv, table);

  document.getElementById('roles-stop-sim').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/auth/simulate-role', { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) window.location.reload();
      else alert('Failed: ' + (data.error || 'Unknown error'));
    } catch (e) { alert('Error: ' + e.message); }
  });
}
```

---

## Step 8 — Activity log entry

When simulation starts or stops, log it using the existing `logActivity` helper:

In `handleSimulateRoleStart`, after the successful UPDATE:
```javascript
await logActivity(db, user.userId, 'simulate_role_start', 'session', user.sessionId, {
  simulatedRoleId: roleId,
  simulatedRoleName: role.name,
});
```

In `handleSimulateRoleStop`, after the successful UPDATE:
```javascript
await logActivity(db, user.userId, 'simulate_role_stop', 'session', user.sessionId, {});
```

---

## What NOT to touch

- Do NOT modify the `roles` table schema
- Do NOT modify the `users` table schema
- Do NOT modify any permission check helper functions (`checkPagePermission`, `checkApiPermission`, `hasPermission`) — they work correctly as-is because they read from `user.permissions` and check `user.isAdministrator`, both of which are now dynamically set based on simulation state
- Do NOT modify any page-level permission gating JS (the `window.__xpandaUser.permissions` and `window.__xpandaUser.isAdministrator` values will automatically reflect the simulation)
- Do NOT touch the auto-pack algorithm, BOL generator, job board, or any business logic
- Do NOT modify `bol-shared.js`

---

## Completion checklist

- [ ] `sessions` table has `simulating_role_id` column (migration SQL provided)
- [ ] `POST /api/auth/simulate-role` starts simulation (admin-only, validates role exists, rejects administrator role)
- [ ] `DELETE /api/auth/simulate-role` stops simulation (clears `simulating_role_id`)
- [ ] `validateSession` loads simulated role permissions when active; sets `isAdministrator: false` but `isRealAdmin: true`
- [ ] Escape hatch: `/admin/*`, `/api/auth/*`, `/api/roles`, `/api/users` always accessible for `isRealAdmin` users
- [ ] `/api/auth/me` includes `simulatingRole` and `isRealAdmin` in response
- [ ] All three shared headers show amber simulation banner with "Stop Testing" button when active
- [ ] All four admin pages show the same banner when active
- [ ] `admin/roles.html` has "Test" button on each non-administrator role row
- [ ] `admin/roles.html` shows status indicator with "Stop Testing" when simulation is active
- [ ] Activity log entries for simulate start/stop
- [ ] Clicking "Stop Testing" clears simulation and reloads page

**Notify Steve:** Run the migration SQL in the Cloudflare D1 Dashboard Console before testing:
```sql
ALTER TABLE sessions ADD COLUMN simulating_role_id TEXT DEFAULT NULL;
```

Test:
1. Go to `/admin/roles.html` → each non-admin role should have a yellow "Test" button
2. Click "Test" on a role → confirm dialog → redirected to homepage with amber banner at top
3. Navigate around — pages/features the simulated role can't access should be blocked
4. Admin pages (`/admin/*`) should still be fully accessible
5. Click "Stop Testing" → banner disappears, full admin access restored
6. Check `/admin/activity-log.html` — should show simulate_role_start and simulate_role_stop entries
