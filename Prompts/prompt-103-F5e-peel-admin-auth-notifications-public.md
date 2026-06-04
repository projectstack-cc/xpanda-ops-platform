# P103 — F5e: Peel Admin, Auth, Notifications, and Public groups (final peel)

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **db-api-agent** (lead) and **admin-auth-agent** + **logistics-agent** (public BOL flow). Foundation Roadmap **Phase F5 — step F5e**, the final peel. **Depends on F5a–F5d.** After this, `index.js` is just the entry + middleware + the `API_ROUTES` table; the 5,191-line monolith is fully decomposed. Behavior-identical. No DB, no migration, no frontend change.

Four modules. **Auth has a wiring difference — read Module 2 carefully.**

## Module 1 — `_worker.js/routes/admin.js`
- `handleApiUsers`       → `/api/users`
- `handleApiRoles`       → `/api/roles`
- `handleApiActivityLog` → `/api/activity-log`

These are admin-gated CRUD. Note: `logActivity` lives in `lib/core.js` (F5a) and is imported, not moved here.

## Module 2 — `_worker.js/routes/auth.js`  ⚠️ wired inline, NOT via `API_ROUTES`
Move these handlers:
- `handleAuthLogin`        → called inline for `/api/auth/login`
- `handleAuthLogout`       → `/api/auth/logout`
- `handleAuthMe`           → `/api/auth/me`
- `handleAuthChangePassword` → `/api/auth/change-password`
- `handleSimulateRoleStart`  → `/api/auth/simulate-role` (POST)
- `handleSimulateRoleStop`   → `/api/auth/simulate-role` (DELETE)

**Critical:** these are invoked by the **inline `if (url.pathname === '/api/auth/...')` block inside `fetch` in `index.js`**, *above* the session gate — they are NOT in the `API_ROUTES` table. So: import them into `index.js` and the existing inline calls resolve via the import; do not move them into the route table. The session-creation / cookie / password helpers that only auth uses move into `routes/auth.js` with them. `validateSession` stays in `lib/core.js` (middleware uses it) — import it into `auth.js` if login/logout need it; do not duplicate.

## Module 3 — `_worker.js/routes/notifications.js`
- `handleApiNotifications`   → `/api/notifications`
- `handleApiPushSubscribe`   → `/api/push/subscribe`
- `handleApiPushUnsubscribe` → `/api/push/unsubscribe`

Note: the VAPID Web-Push **send** helper (Web Crypto) is likely shared with the loading/delivery flows. If it was already moved to `lib/core.js` (or `lib/push.js`) in an earlier peel, import it. If it's still in `index.js` and used by more than one group, move it to `lib/core.js`/`lib/push.js` now and import from both. The inline `/api/push/vapid-public-key` handler in `fetch` (it just returns `env.VAPID_PUBLIC_KEY`) stays inline in `index.js` — leave it.

## Module 4 — `_worker.js/routes/public.js`
- `handleApiPublicBolLookup`   → `/api/public/bol-lookup`
- `handleApiPublicBolPickup`   → `/api/public/bol-pickup`
- `handleApiPublicBolDelivery` → `/api/public/bol-delivery`

These bypass the session gate (gated by the unguessable `access_token` in the path) and are dispatched via `API_ROUTES`. The delivery handler writes the signed BOL photo to R2 (P83) and shares BOL helpers with `routes/bols.js` — import those shared helpers from `lib/core.js`/`lib/bol.js`, don't duplicate.

## Wire
Add imports to `index.js` for all four modules, delete the moved bodies. `API_ROUTES` entries (admin, notifications, public) unchanged; the inline auth calls now resolve via the `auth.js` import.
```js
import { handleApiUsers, handleApiRoles, handleApiActivityLog } from './routes/admin.js';
import { handleAuthLogin, handleAuthLogout, handleAuthMe, handleAuthChangePassword,
         handleSimulateRoleStart, handleSimulateRoleStop } from './routes/auth.js';
import { handleApiNotifications, handleApiPushSubscribe, handleApiPushUnsubscribe } from './routes/notifications.js';
import { handleApiPublicBolLookup, handleApiPublicBolPickup, handleApiPublicBolDelivery } from './routes/public.js';
```

## Verify before declaring done
Full smoke pass since this is the last peel: login/logout, `/api/auth/me`, first-login password change, **"View as Role" simulate start/stop**, a notification fetch + push subscribe, and the public driver flow (`/track` → lookup → pickup → delivery with signed-photo upload to R2 + office push). Confirm `index.js` now contains only the entry/middleware/`API_ROUTES` (plus the inline auth dispatch + vapid-public-key) and no handler bodies. Bundle builds clean.

## What NOT to change
- Handler logic. The inline auth dispatch placement (above the session gate) or the vapid-public-key inline handler. `API_ROUTES`. Middleware order. The R2 signed-BOL flow. Already-peeled groups. No `functions/`, no `package.json`, no build step.
