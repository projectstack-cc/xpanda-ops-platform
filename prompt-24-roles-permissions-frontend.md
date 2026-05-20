# Prompt 24 — Roles & Permissions: Frontend

## Goal

Create the role management admin page, update the user management page to assign roles, gate homepage cards and module navigation based on permissions, and show "access denied" feedback.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

**Prerequisite:** Prompt 23 (roles & permissions backend) must be completed.

---

## Step 1 — Role Management admin page (`admin/roles.html`)

Create `admin/roles.html`. Same visual structure as the other admin pages (parts, activity log, users).

### Layout

- Top bar: logo, "XPANDA FOAM • ADMIN" badge, "Role Management" title, "Configure roles and module permissions" subtitle
- Cross-links to other admin pages (Parts Library, Activity Log, Users)
- Back link to `/`

### Main content

**Roles list** on the left (or top on mobile):
- Each role shown as a card with name, description, and user count
- System roles (Administrator, Staff, Read Only) show a "System" badge — can edit permissions but not delete
- Custom roles show a delete button
- "Add Role" button at the top
- Clicking a role opens its permission editor

**Permission editor** on the right (or below on mobile):
- Shows when a role is selected
- Role name (editable for custom roles, read-only for Administrator)
- Role description (editable)

**Permission grid** — the core of the page:

A table/grid with:
- Rows: one per permission key, grouped by parent module
- Columns: Permission name, View toggle, Edit toggle
- Grouped layout:

```
Module                    View    Edit
─────────────────────────────────────────
Jobs
  Job Board               [✓]     [✓]

Logistics
  Dashboard               [✓]     [✓]
  BOL Generator           [✓]     [ ]
  Load Builder            [✓]     [ ]

Production
  Calculators             [✓]     [✓]
  Inventory               [✓]     [✓]

QC                        [✓]     [✓]
Safety                    [✓]     [ ]
Reports                   [✓]     [ ]
Admin                     [ ]     [ ]
```

- Each toggle is a checkbox or toggle switch
- When "View" is unchecked, "Edit" is automatically unchecked and disabled (can't edit what you can't see)
- For the Administrator role, all toggles are checked and disabled with a note: "Administrator has unrestricted access"
- Changes are saved on each toggle change (debounced PUT to `/api/roles`) — no separate save button needed

### Permission key display names

Map the internal keys to user-friendly labels:

```javascript
const PERMISSION_LABELS = {
  'jobs':                    { group: 'Jobs',       label: 'Job Board' },
  'logistics.dashboard':    { group: 'Logistics',  label: 'Dashboard & Shipments' },
  'logistics.bol':          { group: 'Logistics',  label: 'BOL Generator' },
  'logistics.load-builder': { group: 'Logistics',  label: 'Load Builder' },
  'production.calculators': { group: 'Production', label: 'Calculators' },
  'production.inventory':   { group: 'Production', label: 'Inventory' },
  'qc':                     { group: 'QC',         label: 'Quality Control' },
  'safety':                 { group: 'Safety',     label: 'Safety Portal' },
  'reports':                { group: 'Reports',    label: 'Reports & Analytics' },
  'admin':                  { group: 'Admin',      label: 'Administration' },
};
```

### Add Role modal

- Fields: Name (required), Description (optional)
- On save, creates role via POST `/api/roles` with all permissions defaulting to `{ view: false, edit: false }`
- After creation, opens the permission editor for the new role

### Delete Role

- Only available for non-system roles
- Confirm dialog: "Delete role {name}? Users assigned to this role will need to be reassigned."
- If the API returns an error (users still assigned), show the error message

### JavaScript

```javascript
let allRoles = [];
let selectedRoleId = null;
let saveTimeout = null;

async function loadRoles() { /* GET /api/roles */ }
function renderRoleList() { /* render role cards */ }
function selectRole(roleId) { /* highlight card, render permission editor */ }
function renderPermissionGrid(role) { /* build the toggle grid */ }
function onPermissionToggle(key, action, checked) {
  /* Update local state, debounce save */
  // If unchecking view, also uncheck edit
  if (action === 'view' && !checked) {
    // set edit to false too
  }
  // Debounce the save
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveRolePermissions(), 500);
}
async function saveRolePermissions() { /* PUT /api/roles */ }
function openAddRoleModal() { /* show modal */ }
async function saveNewRole() { /* POST /api/roles */ }
async function deleteRole(id, name) { /* confirm + DELETE /api/roles */ }
```

---

## Step 2 — Update User Management page (`admin/users.html`)

### 2a. Role dropdown replaces free-text role field

In the add/edit user modal, replace the role dropdown that currently has hardcoded "admin/staff/readonly" options with a dynamic dropdown populated from `/api/roles`:

```javascript
async function loadRoles() {
  const res = await fetch('/api/roles');
  const data = await res.json();
  return data.roles || [];
}
```

Populate the `<select>` with role options:
```html
<select id="f-role-id">
  <!-- populated dynamically -->
</select>
```

Each option: `<option value="${role.id}">${role.name}</option>`

### 2b. Users table shows role name

Update the table to show the role name (from `role_name` field returned by GET `/api/users`) instead of the raw role string.

### 2c. Save uses role_id

When saving a user (POST or PUT), send `role_id` instead of `role`:
```javascript
role_id: document.getElementById('f-role-id').value,
```

### 2d. Edit populates role_id

When editing a user, set the dropdown to the user's current `role_id`:
```javascript
document.getElementById('f-role-id').value = user.role_id || 'role-staff';
```

---

## Step 3 — Gate homepage cards based on permissions

In `index.html`, update the page to check the current user's permissions and hide cards they can't access.

### 3a. Add data attributes to cards

Add a `data-permission` attribute to each card's `<article>` element:

```html
<article class="card" data-permission="safety">
<article class="card" data-permission="qc">
<article class="card" data-permission="reports">
<article class="card" data-permission="jobs">
<article class="card" data-permission="logistics.dashboard,logistics.bol,logistics.load-builder">
<article class="card" data-permission="production.calculators,production.inventory">
<article class="card" data-permission="admin">
```

For cards that map to multiple sub-modules (Logistics, Production), use a comma-separated list. The card is shown if the user has `view` permission on **any** of the listed keys.

### 3b. Add permission gating script

Add to the `<script>` block (or create one if none exists):

```javascript
async function gateHomepage() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (!data.ok || !data.user) return;

    const user = data.user;
    const perms = user.permissions || {};

    // Administrator sees everything
    if (user.isAdministrator) return;

    // Hide cards the user can't access
    document.querySelectorAll('.card[data-permission]').forEach(card => {
      const keys = card.dataset.permission.split(',');
      const canView = keys.some(key => perms[key.trim()]?.view === true);
      if (!canView) {
        card.style.display = 'none';
      }
    });

    // Hide individual action buttons within visible cards
    // For Logistics card: hide specific sub-module links
    document.querySelectorAll('.card a[href]').forEach(link => {
      const href = link.getAttribute('href');
      let permKey = null;
      if (href.includes('/logistics/bol')) permKey = 'logistics.bol';
      else if (href.includes('/logistics/load-builder')) permKey = 'logistics.load-builder';
      else if (href.includes('/logistics/')) permKey = 'logistics.dashboard';
      else if (href.includes('/admin/')) permKey = 'admin';

      if (permKey && !perms[permKey]?.view) {
        link.style.display = 'none';
      }
    });
  } catch {}
}

gateHomepage();
```

### 3c. Access denied message

Check for `?access_denied=1` URL parameter (set by the session gate when a page is blocked):

```javascript
if (new URLSearchParams(window.location.search).get('access_denied')) {
  const banner = document.createElement('div');
  banner.style.cssText = 'background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 18px;margin:12px 24px;color:#991b1b;font-size:14px;text-align:center;';
  banner.textContent = 'You do not have permission to access that page.';
  const main = document.querySelector('main');
  if (main) main.insertBefore(banner, main.firstChild.nextSibling);
  // Clean URL
  history.replaceState(null, '', '/');
}
```

---

## Step 4 — Gate module navigation within sections

For modules with sub-pages, hide nav links the user can't access.

### 4a. Logistics index page (`logistics/index.html`)

The logistics dashboard page has links to the BOL generator and load builder. Gate these based on permissions.

Find where these links are rendered and wrap them in a permission check. Add this script block to the page (or append to existing):

```javascript
async function gateLogisticsNav() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (!data.ok || !data.user || data.user.isAdministrator) return;

    const perms = data.user.permissions || {};

    // Hide BOL link if no access
    if (!perms['logistics.bol']?.view) {
      document.querySelectorAll('a[href*="bol-generator"]').forEach(el => el.style.display = 'none');
    }
    // Hide Load Builder link if no access
    if (!perms['logistics.load-builder']?.view) {
      document.querySelectorAll('a[href*="load-builder"]').forEach(el => el.style.display = 'none');
    }
  } catch {}
}
gateLogisticsNav();
```

### 4b. Production index page (`production/index.html`)

Same pattern:

```javascript
async function gateProductionNav() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (!data.ok || !data.user || data.user.isAdministrator) return;

    const perms = data.user.permissions || {};

    if (!perms['production.calculators']?.view) {
      document.querySelectorAll('a[href*="block-calculator"], a[href*="holey-board"]').forEach(el => el.style.display = 'none');
    }
    if (!perms['production.inventory']?.view) {
      document.querySelectorAll('a[href*="inventory"], a[href*="bead-inventory"]').forEach(el => el.style.display = 'none');
    }
  } catch {}
}
gateProductionNav();
```

### 4c. Job board — hide edit controls for read-only users

In `jobs/index.html`, add a permission check that hides write controls (Add Job button, drag-and-drop, edit/delete buttons) when the user only has `view` permission:

```javascript
async function gateJobsWrite() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (!data.ok || !data.user || data.user.isAdministrator) return;

    const perms = data.user.permissions || {};
    if (perms['jobs']?.edit) return; // Has write access, show everything

    // Read-only: hide write controls
    document.querySelectorAll('.jobs-add-btn, .jobs-delete-btn, [data-action="delete"]').forEach(el => el.style.display = 'none');
    // Disable drag and drop
    window.__readOnlyMode = true;
  } catch {}
}
gateJobsWrite();
```

**Note:** The `window.__readOnlyMode` flag can be checked in the drag-and-drop handlers to prevent status changes. Look for the drag event handlers and add:
```javascript
if (window.__readOnlyMode) return;
```
at the top of the dragstart/drop handlers.

---

## Step 5 — Update homepage Admin card

Add the Roles link:

```html
<div class="actions">
  <a class="btn btn-admin" href="/admin/parts.html">Parts Library</a>
  <a class="btn btn-admin" href="/admin/activity-log.html">Activity Log</a>
  <a class="btn btn-admin" href="/admin/users.html">Users</a>
  <a class="btn btn-admin" href="/admin/roles.html">Roles</a>
</div>
```

Update features list:
```html
<ul class="features">
  <li>Parts library management</li>
  <li>Activity log &amp; audit trail</li>
  <li>User &amp; role management</li>
</ul>
```

---

## Step 6 — Cross-links between admin pages

Update all admin pages to include cross-links to all four admin pages in their topbar-nav:

```html
<div class="topbar-nav">
  <a href="/admin/parts.html">Parts</a>
  <a href="/admin/activity-log.html">Activity Log</a>
  <a href="/admin/users.html">Users</a>
  <a href="/admin/roles.html">Roles</a>
  <a href="/">← Back to Platform</a>
</div>
```

Update in:
- `admin/parts.html`
- `admin/activity-log.html`
- `admin/users.html`
- `admin/roles.html` (already has it from Step 1)

---

## Styling for the permission grid

The permission grid is the most complex new UI element. Key styling:

```css
.perm-grid {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.perm-group-header {
  background: #f1f5f9;
  padding: 8px 16px;
  font-weight: 700;
  font-size: 13px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border);
}

.perm-row {
  display: grid;
  grid-template-columns: 1fr 80px 80px;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid #f1f5f9;
}

.perm-row:last-child { border-bottom: none; }

.perm-label {
  font-size: 14px;
  padding-left: 16px;
}

.perm-toggle {
  text-align: center;
}

.perm-toggle input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #334155;
}

.perm-toggle input[type="checkbox"]:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.perm-header-row {
  display: grid;
  grid-template-columns: 1fr 80px 80px;
  padding: 10px 16px;
  font-weight: 600;
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  border-bottom: 2px solid var(--border);
}
```

---

## What NOT to touch

- Do NOT modify `_worker.js` (that was Prompt 23)
- Do NOT modify any business logic, algorithms, or calculation code
- Do NOT modify the login page or auth flow
- Do NOT modify the BOL PDF generation, packing slip parser, or load builder algorithms
- Do NOT modify shared CSS files (logistics-shared.css, jobs-shared.css, etc.)
- Do NOT remove any existing functionality — only add permission gating on top

---

## Completion checklist

Before stopping, verify:
- [ ] `admin/roles.html` created with role list + permission grid editor
- [ ] Permission grid shows all 10 permission keys grouped by module
- [ ] View/Edit toggles update the role's permissions JSON via PUT
- [ ] Unchecking View auto-unchecks and disables Edit
- [ ] Administrator role shows all toggles checked and disabled
- [ ] Add role creates new role with all permissions defaulting to false
- [ ] Delete role works for non-system roles (blocked if users assigned)
- [ ] `admin/users.html` uses role dropdown from `/api/roles` instead of hardcoded options
- [ ] Users table shows role name
- [ ] Homepage hides cards for inaccessible modules
- [ ] Homepage shows "access denied" banner when redirected
- [ ] Logistics index hides BOL/Load Builder links based on permissions
- [ ] Production index hides calculator/inventory links based on permissions
- [ ] Job board hides write controls for read-only users
- [ ] Admin card on homepage updated with Roles link
- [ ] All admin pages have cross-links to all four admin pages

**Notify Steve:** No migration needed (Prompt 23's migration covered it). After deploying:
1. Go to Admin → Roles to see the three seeded roles
2. Click "Staff" to see and customize its permissions
3. Create a custom role (e.g. "Logistics Manager") and toggle permissions
4. Go to Admin → Users and assign the new role to a user
5. Log in as that user to verify they only see permitted modules
