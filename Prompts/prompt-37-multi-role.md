# Prompt 37 — Multi-Role System (Discord-Style)

## Goal

Change the user-role relationship from single-role (`users.role_id` FK) to multi-role via a junction table. Users can have multiple roles, and permissions are resolved by merging all assigned roles with the most permissive value winning per key. This enables notification routing roles alongside operational roles.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Step 1 — Database migration

Create `multi-role.sql` at the project root:

```sql
-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);

-- Migrate existing single role_id assignments to junction table
INSERT OR IGNORE INTO user_roles (user_id, role_id)
SELECT id, role_id FROM users WHERE role_id IS NOT NULL AND role_id != '';
```

The `users.role_id` column stays for backward compatibility but is no longer the authoritative source. The junction table is.

---

## Step 2 — Update `validateSession` in `_worker.js`

Replace the single-role JOIN with a multi-role query. Find `validateSession` (around line 280).

Replace the query and permission resolution:

```javascript
async function validateSession(db, request) {
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
      SELECT s.id, s.user_id, s.expires_at,
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

    // Check if user has the Administrator role
    const isAdministrator = userRoles.some(r => r.id === 'role-administrator') || session.role === 'admin';

    // Merge permissions: most permissive wins per key
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
          Object.assign(mergedPermissions, perms);
        } catch {}
        userRoles.push(fallbackRole);
      }
    }

    return {
      userId: session.uid,
      username: session.username,
      displayName: session.display_name,
      role: userRoles.map(r => r.name).join(', ') || session.role || 'staff',
      roleIds: userRoles.map(r => r.id),
      roleNames: userRoles.map(r => r.name),
      firstLogin: session.first_login === 1,
      sessionId: session.id,
      isAdministrator,
      permissions: mergedPermissions,
    };
  } catch (e) {
    console.error('Session validation failed:', e);
    return null;
  }
}
```

---

## Step 3 — Update `/api/auth/me` response

Find `handleAuthMe`. Update to return multiple roles:

```javascript
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
    permissions: user.permissions,
  },
});
```

---

## Step 4 — Update Users API (`handleApiUsers`)

### GET — include user's roles

Update the GET query to fetch roles for each user:

```javascript
if (method === "GET") {
  const users = await db.prepare(
    "SELECT id, username, display_name, password, role, role_id, is_active, first_login, created_at, updated_at FROM users ORDER BY created_at ASC"
  ).all();

  // Fetch role assignments for all users
  const allAssignments = await db.prepare(
    "SELECT ur.user_id, ur.role_id, r.name as role_name FROM user_roles ur JOIN roles r ON ur.role_id = r.id"
  ).all();

  const assignmentMap = {};
  for (const a of (allAssignments.results || [])) {
    if (!assignmentMap[a.user_id]) assignmentMap[a.user_id] = [];
    assignmentMap[a.user_id].push({ role_id: a.role_id, role_name: a.role_name });
  }

  const enriched = (users.results || []).map(u => ({
    ...u,
    roles: assignmentMap[u.id] || [],
  }));

  return json({ ok: true, users: enriched });
}
```

### POST — accept `role_ids` array

When creating a user, accept `role_ids` (array of role IDs) instead of single `role_id`:

```javascript
const role_ids = Array.isArray(body.role_ids) ? body.role_ids : (body.role_id ? [body.role_id] : ['role-staff']);

// After inserting the user:
for (const rid of role_ids) {
  await db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(id, rid).run();
}

// Also set legacy role_id to the first role for backward compat
const legacyRoleId = role_ids[0] || 'role-staff';
```

### PUT — accept `role_ids` array

When updating roles, replace all assignments:

```javascript
if (body.role_ids !== undefined) {
  const newRoleIds = Array.isArray(body.role_ids) ? body.role_ids : [body.role_ids];
  // Clear existing assignments
  await db.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(id).run();
  // Insert new assignments
  for (const rid of newRoleIds) {
    await db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(id, rid).run();
  }
  // Update legacy role_id
  updates.push("role_id = ?"); binds.push(newRoleIds[0] || 'role-staff');
}
```

---

## Step 5 — Update User Management admin page (`admin/users.html`)

### 5a. Replace single role dropdown with multi-select checkboxes

In the add/edit modal, replace the role `<select>` with a checkbox list:

```html
<div class="form-group">
  <label>Roles</label>
  <div id="f-role-checks" style="max-height:200px;overflow-y:auto;border:1px solid #d1d5db;border-radius:8px;padding:8px;"></div>
</div>
```

Populate dynamically:
```javascript
function renderRoleCheckboxes(selectedRoleIds = []) {
  const container = document.getElementById('f-role-checks');
  container.innerHTML = '';
  allRoles.forEach(role => {
    const label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:13px;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = role.id;
    cb.checked = selectedRoleIds.includes(role.id);
    label.appendChild(cb);
    label.appendChild(document.createTextNode(role.name));
    container.appendChild(label);
  });
}
```

### 5b. Collect selected roles on save

```javascript
function getSelectedRoleIds() {
  return Array.from(document.querySelectorAll('#f-role-checks input[type="checkbox"]:checked'))
    .map(cb => cb.value);
}
```

Send as `role_ids` in the POST/PUT payload.

### 5c. Users table shows multiple roles

In the table, show role badges instead of a single role name:

```javascript
const rolesHtml = (user.roles || []).map(r =>
  `<span style="background:#f1f5f9;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;margin-right:4px;">${r.role_name}</span>`
).join('');
```

---

## Step 6 — Update header user display

In the header JS files, the `window.__xpandaUser` object now has `roleNames` (array). Update the display if desired — or leave as-is since the role display is just the user's name.

No change needed for the header — the permission check in `hasPermission()` already uses the merged `permissions` object, which now comes from the multi-role merge.

---

## What NOT to touch

- Do NOT modify the roles CRUD API or roles admin page (roles themselves are unchanged)
- Do NOT modify the permission checking logic (`hasPermission`, `getPermissionKey`) — they read from `user.permissions` which is now a merged object
- Do NOT remove `users.role_id` column — keep for backward compatibility
- Do NOT modify any business logic
- Do NOT modify any other pages

---

## Completion checklist

- [ ] `multi-role.sql` migration created with `user_roles` junction table
- [ ] Existing `role_id` assignments migrated to junction table
- [ ] `validateSession` fetches all roles and merges permissions (most permissive wins)
- [ ] Administrator check works with multi-role (any role being Administrator triggers bypass)
- [ ] `/api/auth/me` returns `roleIds`, `roleNames`, and merged `permissions`
- [ ] `/api/users` GET returns `roles` array per user
- [ ] `/api/users` POST/PUT accept `role_ids` array
- [ ] User management page uses multi-select checkboxes instead of single dropdown
- [ ] Users table shows multiple role badges
- [ ] Fallback to legacy `role_id` if junction table is empty (backward compat)

**Notify Steve:** Run `multi-role.sql` in D1 Dashboard Console. Existing users will be auto-migrated. Then go to Admin → Users and verify each user shows their roles as checkboxes.
