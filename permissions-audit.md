# Permissions Audit — xPanda Ops Platform
Generated against worker route table (F2) and PATH/API_PERMISSION_MAP. 2026-06-02

## Summary
- Total API routes audited: 42 (35 in F2 `API_ROUTES` table + 7 pre-session-gate)
- Gated by `API_PERMISSION_MAP`: 31
- **Ungated gap (matched no pattern — open to any authenticated user): 1** — `/api/saved-loads`
- Intentionally open — any authenticated user, by design: 3 (`/api/notifications`, `/api/push/subscribe`, `/api/push/unsubscribe`)
- Intentionally open — pre-session-gate (pre-login or escape-hatch): 7 (all `/api/auth/*` + `/api/push/vapid-public-key`)

---

## Page Routes (PATH_PERMISSION_MAP)

| Page Pattern | Permission Key | Notes |
|---|---|---|
| `/admin/*` | `admin` | |
| `/jobs/*` | `jobs` | |
| `/logistics/bol-generator*` | `logistics.bol` | |
| `/logistics/load-builder*` | `logistics.load-builder` | |
| `/logistics/loading*` | `logistics.loading` | |
| `/logistics/*` | `logistics.dashboard` | Catch-all for remaining logistics pages |
| `/production/(block-calculator\|holey-board-calculator)*` | `production.calculators` | |
| `/production/*` | `production.inventory` | Catch-all for remaining production pages |
| `/qc/*` | `qc` | |
| `/safety/*` | `safety` | No API routes exist for safety today |
| `/reports/*` | `reports` | |

---

## API Routes (API_PERMISSION_MAP × API_ROUTES)

Routes are grouped by the F2 table's section ordering. Auth and pre-gate routes appear separately at the bottom.

| Route | Match Type | Permission Key | Status |
|---|---|---|---|
| `/api/users` | prefix | `admin` | ✅ Gated |
| `/api/roles` | prefix | `admin` | ✅ Gated |
| `/api/completions` | exact | `qc` | ✅ Gated |
| `/api/scrap-log` | exact | `qc` | ✅ Gated |
| `/api/reports/scrap-summary` | exact | `reports` | ✅ Gated (via `/^\/api\/reports/`) |
| `/api/reports/scrap-trend` | exact | `reports` | ✅ Gated (via `/^\/api\/reports/`) |
| `/api/reports/scrap-reasons` | exact | `reports` | ✅ Gated (via `/^\/api\/reports/`) |
| `/api/reports/incidents-trend` | exact | `reports` | ✅ Gated (via `/^\/api\/reports/`) |
| `/api/reports/incidents-summary` | exact | `reports` | ✅ Gated (via `/^\/api\/reports/`) |
| `/api/reports/incidents-list` | exact | `reports` | ✅ Gated (via `/^\/api\/reports/`) |
| `/api/reports/incidents-detail` | exact | `reports` | ✅ Gated (via `/^\/api\/reports/`) |
| `/api/parts` | exact | `production.calculators` | ✅ Gated |
| `/api/combos` | exact | `production.calculators` | ✅ Gated |
| `/api/bead-types` | exact | `production.inventory` | ✅ Gated (via `/^\/api\/bead/`) |
| `/api/bead-stock` | exact | `production.inventory` | ✅ Gated (via `/^\/api\/bead/`) |
| `/api/block-inventory` | exact | `production.inventory` | ✅ Gated (via `/^\/api\/block/`) |
| `/api/molding-log` | exact | `production.inventory` | ✅ Gated |
| `/api/block-consumption` | exact | `production.inventory` | ✅ Gated (via `/^\/api\/block/`) |
| `/api/jobs` | prefix | `jobs` | ✅ Gated |
| `/api/shipments` | exact | `logistics.dashboard` | ✅ Gated |
| `/api/bol-customers/seed` | exact | `logistics.bol` | ✅ Gated (via `/^\/api\/bol-customers/`) |
| `/api/bol-customers` | exact | `logistics.bol` | ✅ Gated |
| `/api/bol-carriers` | exact | `logistics.bol` | ✅ Gated |
| `/api/bols` | prefix | `logistics.bol` | ✅ Gated |
| `/api/load-builder-skus/seed` | exact | `logistics.load-builder` | ✅ Gated (via `/^\/api\/load-builder-skus/`) |
| `/api/load-builder-skus/all` | exact | `logistics.load-builder` | ✅ Gated (via `/^\/api\/load-builder-skus/`) |
| `/api/load-builder-skus` | prefix | `logistics.load-builder` | ✅ Gated |
| `/api/saved-loads` | prefix | _(none)_ | ⚠️ **GAP** — no matching pattern in `API_PERMISSION_MAP` |
| `/api/loading-bays` | prefix | `logistics.loading` | ✅ Gated |
| `/api/loading-assignments` | prefix | `logistics.loading` | ✅ Gated |
| `/api/loading-photos` | prefix | `logistics.loading` | ✅ Gated |
| `/api/activity-log` | prefix | `admin` | ✅ Gated |
| `/api/notifications` | prefix | _(none)_ | ✅ Intentionally open — cross-module per-user data, any authenticated user |
| `/api/push/subscribe` | exact | _(none)_ | ✅ Intentionally open — push infrastructure, any authenticated user |
| `/api/push/unsubscribe` | exact | _(none)_ | ✅ Intentionally open — push infrastructure, any authenticated user |
| `/api/auth/login` | exact (pre-gate) | _(none)_ | ✅ Intentionally open — pre-auth |
| `/api/auth/logout` | exact (pre-gate) | _(none)_ | ✅ Intentionally open — pre-auth |
| `/api/auth/me` | exact (pre-gate) | _(none)_ | ✅ Intentionally open — pre-auth |
| `/api/auth/change-password` | exact (pre-gate) | _(none)_ | ✅ Intentionally open — pre-auth |
| `/api/auth/simulate-role` (POST) | exact (pre-gate) | _(none)_ | ✅ Intentionally open — admin escape hatch, real-admin only enforced by handler |
| `/api/auth/simulate-role` (DELETE) | exact (pre-gate) | _(none)_ | ✅ Intentionally open — admin escape hatch |
| `/api/push/vapid-public-key` | exact (pre-gate, inline) | _(none)_ | ✅ Intentionally open — VAPID public key is not secret |

---

## Gaps Found

### `/api/saved-loads` — prefix

**What it is:** Stores and retrieves saved load configurations from the Load Builder. Handlers: `handleApiSavedLoads`.

**Why it's a gap:** No entry in `API_PERMISSION_MAP` matches `/api/saved-loads`. Any authenticated user can read, write, and delete saved loads regardless of whether they have `logistics.load-builder` access.

**Recommended permission key:** `logistics.load-builder`
(The Load Builder page itself is gated by `logistics.load-builder`, and `/api/load-builder-skus` is gated the same way. Saved loads are exclusively a Load Builder concern.)

**Recommended one-line addition to `API_PERMISSION_MAP`** (insert after the `load-builder-skus` entry):
```javascript
{ pattern: /^\/api\/saved-loads/, key: 'logistics.load-builder' },
```

---

## Intentionally Open Routes

| Route | Reason |
|---|---|
| `/api/notifications` | Per-user cross-module data. The notification bell is shown to jobs, logistics, and production users — there's no single module permission key that fits. Any authenticated user reading their own notifications is correct behavior. |
| `/api/push/subscribe` | Any authenticated user on any module can opt in to push notifications. Tying this to a specific module permission would prevent non-logistics users from getting push alerts. |
| `/api/push/unsubscribe` | Same rationale as subscribe. |
| `/api/auth/login` | Must work before any session exists. |
| `/api/auth/logout` | Must work to clear the session. |
| `/api/auth/me` | Used by shared-header.js on every page to hydrate `window.__xpandaUser`. |
| `/api/auth/change-password` | Password changes must work even for restricted-permission accounts. |
| `/api/auth/simulate-role` (POST/DELETE) | Admin-only escape hatch; the handler itself checks `X-User-Is-Admin`. The session gate would block non-admins before reaching the handler via the `ESCAPE_PREFIXES` logic. |
| `/api/push/vapid-public-key` | The VAPID public key is by definition public — it's needed client-side to subscribe. Pre-gate by design. |

---

## Permission Keys Inventory

| Key | Used in PATH_PERMISSION_MAP | Used in API_PERMISSION_MAP | In `PERMISSION_LABELS`? |
|---|---|---|---|
| `admin` | `/admin/*` | `/api/users`, `/api/roles`, `/api/activity-log` | ✅ Yes |
| `jobs` | `/jobs/*` | `/api/jobs` | ✅ Yes |
| `logistics.dashboard` | `/logistics/*` (catch-all) | `/api/shipments` | ✅ Yes |
| `logistics.bol` | `/logistics/bol-generator*` | `/api/bols`, `/api/bol-customers`, `/api/bol-carriers` | ✅ Yes |
| `logistics.load-builder` | `/logistics/load-builder*` | `/api/load-builder-skus` | ✅ Yes |
| `logistics.loading` | `/logistics/loading*` | `/api/loading-bays`, `/api/loading-assignments`, `/api/loading-photos` | ✅ Yes |
| `logistics.loading.manage` | _(not in map)_ | _(not in map)_ | ✅ Yes — client-side only |
| `production.calculators` | `/production/(block-calculator\|holey-board-calculator)*` | `/api/parts`, `/api/combos` | ✅ Yes |
| `production.inventory` | `/production/*` (catch-all) | `/api/bead-*`, `/api/block-*`, `/api/molding-log` | ✅ Yes |
| `qc` | `/qc/*` | `/api/completions`, `/api/scrap-log` | ✅ Yes |
| `safety` | `/safety/*` | _(no API routes)_ | ✅ Yes |
| `reports` | `/reports/*` | `/api/reports/*` | ✅ Yes |

**Notes:**

- **`logistics.loading.manage`** appears in `PERMISSION_LABELS` and is used by page scripts (`loading.html`, `bol-generator.html`) to gate bay-management UI within the loading dashboard. It is intentionally absent from both permission maps — it's a sub-capability checked client-side after the session gate has already verified `logistics.loading` access. No gap.

- **`safety`** has a page-route gate but no API routes today. If a safety API is added in the future, add `{ pattern: /^\/api\/safety/, key: 'safety' }` to `API_PERMISSION_MAP`.

- All keys referenced in either permission map are present in `PERMISSION_LABELS`. No unconfigurable keys.

---

## Action Items

| Priority | Item |
|---|---|
| 🔴 High | Add `{ pattern: /^\/api\/saved-loads/, key: 'logistics.load-builder' }` to `API_PERMISSION_MAP` in `_worker.js` |
| ⬜ Future | When safety API routes are added, add a matching `API_PERMISSION_MAP` entry for `safety` |
| ⬜ Future | Consider whether `logistics.loading.manage` should have an API-level gate for any future manager-only endpoints |
