# Prompt 22 — Authentication System: Frontend

## Goal

Create the login page, first-login password change flow, user management admin page, and wire logout into the platform header. This completes the authentication system started in Prompt 21.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

**Prerequisite:** Prompt 21 (auth backend) must be completed first.

---

## Step 1 — Login page (`login.html`)

Create `login.html` at the project root (same level as `index.html`).

### Design

A clean, centered login form. This is the first thing users see, so it should look professional but simple.

```
┌──────────────────────────────────┐
│         [xPanda Logo]            │
│    xPanda Operations Platform    │
│                                  │
│   ┌──────────────────────────┐   │
│   │  Username                │   │
│   └──────────────────────────┘   │
│   ┌──────────────────────────┐   │
│   │  Password                │   │
│   └──────────────────────────┘   │
│                                  │
│   [      Sign In             ]   │
│                                  │
│   (error message area)           │
└──────────────────────────────────┘
```

### HTML structure

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Sign In — xPanda Ops</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" href="/assets/img/favicon.png" sizes="any">
  <style>
    /* All styles inline */
  </style>
</head>
<body>
  <div class="login-wrap">
    <div class="login-card">
      <img src="/logo/xpanda.png" alt="xPanda" class="login-logo" />
      <h1>Operations Platform</h1>

      <!-- Login form -->
      <div id="login-form">
        <input type="text" id="f-username" placeholder="Username" autocomplete="username" autofocus />
        <input type="password" id="f-password" placeholder="Password" autocomplete="current-password" />
        <button id="btn-login" onclick="doLogin()">Sign In</button>
        <div id="login-error" class="error-msg" hidden></div>
      </div>

      <!-- First login / password change form (hidden initially) -->
      <div id="password-form" hidden>
        <p class="info-msg">Welcome! Please set a new password to continue.</p>
        <input type="password" id="f-new-password" placeholder="New password (min 4 characters)" />
        <input type="password" id="f-confirm-password" placeholder="Confirm new password" />
        <button id="btn-set-password" onclick="doChangePassword()">Set Password & Continue</button>
        <div id="password-error" class="error-msg" hidden></div>
      </div>
    </div>
  </div>
</body>
</html>
```

### Styling

- Background: `#f0f2f5` (matches platform)
- Card: white, centered (max-width 380px), `border-radius: 16px`, `box-shadow: 0 4px 24px rgba(0,0,0,0.08)`
- Logo: max-width 100px, centered
- h1: 20px, `#111827`, margin-bottom 24px
- Inputs: full width, 12px 14px padding, 12px border-radius, `#d1d5db` border, 15px font-size, margin-bottom 12px
- Sign In button: full width, `#1e293b` background, white text, 14px 0 padding, 12px border-radius, 15px font-size, bold, cursor pointer
- Sign In button hover: `#334155`
- Error message: `#dc2626` text, 13px, margin-top 12px
- Info message: `#2563eb` text, 13px, margin-bottom 16px

### JavaScript

```javascript
// Check if already logged in
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.ok && data.user) {
      if (data.user.firstLogin) {
        showPasswordForm();
      } else {
        window.location.href = '/';
      }
    }
  } catch {}
}

async function doLogin() {
  const username = document.getElementById('f-username').value.trim();
  const password = document.getElementById('f-password').value;
  const errEl = document.getElementById('login-error');
  errEl.hidden = true;

  if (!username || !password) {
    errEl.textContent = 'Please enter username and password.';
    errEl.hidden = false;
    return;
  }

  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  btn.textContent = 'Signing in...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (data.ok && data.user) {
      if (data.user.firstLogin) {
        showPasswordForm();
      } else {
        window.location.href = '/';
      }
    } else {
      errEl.textContent = data.error || 'Login failed.';
      errEl.hidden = false;
    }
  } catch (e) {
    errEl.textContent = 'Connection error. Please try again.';
    errEl.hidden = false;
  }

  btn.disabled = false;
  btn.textContent = 'Sign In';
}

function showPasswordForm() {
  document.getElementById('login-form').hidden = true;
  document.getElementById('password-form').hidden = false;
}

async function doChangePassword() {
  const newPwd = document.getElementById('f-new-password').value;
  const confirmPwd = document.getElementById('f-confirm-password').value;
  const errEl = document.getElementById('password-error');
  errEl.hidden = true;

  if (newPwd.length < 4) {
    errEl.textContent = 'Password must be at least 4 characters.';
    errEl.hidden = false;
    return;
  }
  if (newPwd !== confirmPwd) {
    errEl.textContent = 'Passwords do not match.';
    errEl.hidden = false;
    return;
  }

  const btn = document.getElementById('btn-set-password');
  btn.disabled = true;

  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_password: newPwd }),
    });
    const data = await res.json();

    if (data.ok) {
      window.location.href = '/';
    } else {
      errEl.textContent = data.error || 'Failed to set password.';
      errEl.hidden = false;
    }
  } catch {
    errEl.textContent = 'Connection error.';
    errEl.hidden = false;
  }

  btn.disabled = false;
}

// Enter key submits
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (!document.getElementById('login-form').hidden) doLogin();
    else if (!document.getElementById('password-form').hidden) doChangePassword();
  }
});

checkAuth();
```

---

## Step 2 — User Management admin page (`admin/users.html`)

Create `admin/users.html`. Same visual structure as the parts admin page and activity log page.

### Layout

- Top bar: logo, "XPANDA FOAM • ADMIN" badge, "User Management" title, "Manage platform users and roles" subtitle
- Back link to `/`
- Cross-links to other admin pages (Parts Library, Activity Log)

### Main content

**Add User button** at top.

**Users table:**
- Columns: Username, Display Name, Role (badge), Password (visible to admin), Status (Active/Disabled), First Login, Actions
- Role badges: Admin = dark slate, Staff = blue, Readonly = gray
- Status: green dot for active, red dot for disabled
- Actions: Edit, Reset Password (sets first_login=1), Disable/Enable toggle, Delete

**Add/Edit modal:**
- Fields:
  - Username (text, required, lowercase enforced — readonly when editing)
  - Display Name (text, required)
  - Password (text, visible — only shown when creating or explicitly resetting)
  - Role (dropdown: admin, staff, readonly)
- Save button → POST for new, PUT for edit
- Cancel button

**Delete confirmation:** "Delete user {displayName}? This will also end their active sessions."

### JavaScript

- `loadUsers()` — fetch GET `/api/users`
- `renderTable()` — build table from users array
- `openModal(user)` — null for add, object for edit
- `saveUser()` — POST or PUT
- `toggleActive(id, currentState)` — PUT with `{ id, is_active: !currentState }`
- `resetPassword(id, displayName)` — confirm, then PUT with `{ id, first_login: 1 }`
- `deleteUser(id, displayName)` — confirm, then DELETE

---

## Step 3 — Add logout to all platform headers

Each module has a shared header JS file that renders the top bar. Add a logout button to each one.

### 3a. Main homepage (`index.html`)

Add a small "Sign Out" link in the hero section or as a fixed element. In the `<body>`, add:

```html
<div id="user-bar" style="position:fixed; top:0; right:0; padding:10px 18px; font-size:13px; color:#5b6472; z-index:1000; display:flex; align-items:center; gap:12px;">
  <span id="user-display"></span>
  <a href="#" onclick="doLogout(); return false;" style="color:#dc2626; text-decoration:none; font-weight:600;">Sign Out</a>
</div>
```

Add script:
```javascript
async function loadCurrentUser() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.ok && data.user) {
      document.getElementById('user-display').textContent = data.user.displayName || data.user.username;
    }
  } catch {}
}
async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}
loadCurrentUser();
```

### 3b. Module headers

For each shared header JS file, add the logout button to the rendered header HTML. These files use `document.write()` to inject the header:

**`logistics/logistics-header.js`** — In the header template string, add before the closing `</header>`:
```html
<div class="header-user-bar" style="position:absolute;top:10px;right:16px;font-size:12px;color:#5b6472;display:flex;align-items:center;gap:8px;">
  <span id="hdr-user-name"></span>
  <a href="#" id="hdr-logout" style="color:#dc2626;text-decoration:none;font-weight:600;">Sign Out</a>
</div>
```

Then in the `DOMContentLoaded` listener in the same file, add:
```javascript
fetch('/api/auth/me').then(r=>r.json()).then(d=>{
  if(d.ok&&d.user){
    const el=document.getElementById('hdr-user-name');
    if(el) el.textContent=d.user.displayName||d.user.username;
  }
}).catch(()=>{});
document.getElementById('hdr-logout')?.addEventListener('click', async (e) => {
  e.preventDefault();
  await fetch('/api/auth/logout',{method:'POST'});
  window.location.href='/login';
});
```

**Repeat for these header files:**
- `jobs/jobs-header.js`
- `production/production-header.js`
- `qc/qc-header.js`
- `reports/reports-header.js`

Each follows the same pattern. The exact HTML injection point varies — look for the closing `</header>` in each template string and add the user bar div just before it. The JS goes in each file's `DOMContentLoaded` listener.

**For the admin pages** (`admin/parts.html`, `admin/activity-log.html`): they have their own inline headers. Add the same user bar div and logout JS directly in each file.

### 3c. Make the header position relative

For the logout button to position correctly (absolute within header), the `<header>` element needs `position: relative`. Add this inline style to the header element in each header JS file if it doesn't already have positioning:

```javascript
// In the template string, add to the <header> tag:
<header class="topbar" style="position:relative;">
```

---

## Step 4 — Update homepage Admin card

In `index.html`, update the Admin card to include the Users link:

```html
<div class="actions">
  <a class="btn btn-admin" href="/admin/parts.html">Parts Library</a>
  <a class="btn btn-admin" href="/admin/activity-log.html">Activity Log</a>
  <a class="btn btn-admin" href="/admin/users.html">Users</a>
</div>
```

Also update the features list:
```html
<ul class="features">
  <li>Parts library management</li>
  <li>Activity log &amp; audit trail</li>
  <li>User management &amp; roles</li>
</ul>
```

---

## Step 5 — Handle 401 on existing pages

When a session expires while a user is on a page, API calls will return 401. Add a global fetch interceptor pattern.

Create a small JS snippet that can be included on pages. Rather than modifying every page, add this to each shared header JS file in the `DOMContentLoaded` block:

```javascript
// Global 401 handler — redirect to login on session expiry
const _origFetch = window.fetch;
window.fetch = async function(...args) {
  const res = await _origFetch.apply(this, args);
  if (res.status === 401 && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
    return res;
  }
  return res;
};
```

This ensures that if any API call returns 401 (expired session), the user is automatically redirected to the login page. Add this to:
- `logistics/logistics-header.js`
- `jobs/jobs-header.js`
- `production/production-header.js`
- `qc/qc-header.js`
- `reports/reports-header.js`
- `index.html` (in a `<script>` block)
- `admin/parts.html` (in the existing script)
- `admin/activity-log.html` (in the existing script)

---

## What NOT to touch

- Do NOT modify `_worker.js` (that was Prompt 21)
- Do NOT modify any business logic, API calls, or calculation code
- Do NOT modify CSS shared files (all styles inline or in `<style>` blocks)
- Do NOT modify the packing slip parser, BOL generator PDF logic, or load builder algorithms
- Do NOT add role-based UI hiding yet (that's a follow-up)
- Keep all style additions inline within the HTML files or in the header JS files

---

## Completion checklist

Before stopping, verify:
- [ ] `login.html` created at project root with login form + first-login password change
- [ ] Login form submits to `/api/auth/login`, handles success/error
- [ ] First-login flow shows password change form, submits to `/api/auth/change-password`
- [ ] `admin/users.html` created with full user CRUD (admin only)
- [ ] Users table shows password column (visible to admin)
- [ ] Add/edit/delete/disable/enable users works
- [ ] Reset password sets `first_login=1`
- [ ] Logout button added to all module headers (logistics, jobs, production, qc, reports)
- [ ] Logout button added to homepage and admin pages
- [ ] Current user display name shown in header
- [ ] 401 fetch interceptor added to all pages
- [ ] Admin card on homepage updated with Users link
- [ ] Enter key submits login and password forms

**Notify Steve:** After deploying:
1. Navigate to any page → should redirect to `/login`
2. Login with username: `admin`, password: `admin`
3. First-login flow will prompt for a new password
4. After setting password, redirected to homepage
5. Go to Admin → Users to create floor accounts (e.g. "crosscutter" / "Cross Cutter" / staff role)
6. The default password is the username if none is provided — user must change on first login
