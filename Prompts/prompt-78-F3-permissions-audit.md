# Prompt 78 — F3: Permissions Audit (read-only)

## Agents to assume

**Read BOTH `AGENTS.md` AND `xpanda-ops-agents.md`.** Assume:
- **Lead: admin-auth-agent** — owns auth/permission surface.
- **Reading from: db-api-agent's `_worker.js`** for the route table (F2) and permission maps.

**Output is a markdown document, not code.** No source files change.

## Context

F2 shipped the `API_ROUTES` table. F3 produces `/permissions-audit.md` at the repo root: a matrix of every API route × the permission key that gates it × any gap, so we know exactly what's exposed before R2 / module expansion lands.

The session gate logic lives in `_worker.js`:
- `PATH_PERMISSION_MAP` (page paths) and `API_PERMISSION_MAP` (API paths) at lines ~449–484
- `getPermissionKey(pathname, isApi)` returns `null` if no pattern matches
- `hasPermission(user, null, action)` returns **`true`** when `permKey` is `null`

**Critical implication:** any API route not matched by `API_PERMISSION_MAP` is effectively open to any authenticated user. The audit's primary job is to flag those.

---

## Part 1 — Produce `/permissions-audit.md`

The file lives at the repo root. Structure:

```markdown
# Permissions Audit — xPanda Ops Platform
Generated against worker route table (F2) and PATH/API_PERMISSION_MAP. <date>

## Summary
- Total API routes: N
- Gated by API_PERMISSION_MAP: N
- **Ungated (matched no pattern — open to any authenticated user): N**
- Intentionally open (auth/push/notifications): N

## Page Routes (PATH_PERMISSION_MAP)

| Page Pattern | Permission Key | Notes |
|---|---|---|
| `/admin/*` | `admin` | |
| `/jobs/*` | `jobs` | |
| `/logistics/bol-generator*` | `logistics.bol` | |
| ... | ... | |

## API Routes (API_PERMISSION_MAP × API_ROUTES)

| Route | Match Type | Permission Key | Status |
|---|---|---|---|
| `/api/auth/login` | exact | _(none)_ | ✅ Intentionally open |
| `/api/auth/me` | exact | _(none)_ | ✅ Intentionally open |
| `/api/parts` | exact | `production.calculators` | ✅ Gated |
| `/api/jobs` | prefix | `jobs` | ✅ Gated |
| `/api/saved-loads` | prefix | _(none)_ | ⚠️ **GAP** — no matching pattern in API_PERMISSION_MAP |
| ... | ... | ... | ... |

## Gaps Found

For each route with status `⚠️ GAP`, list:
- The exact route definition (path or prefix)
- What permission key it SHOULD have (best inference based on neighboring routes — e.g. `/api/saved-loads` is a load-builder concern → `logistics.load-builder`)
- Recommended one-line addition to `API_PERMISSION_MAP`

## Intentionally Open Routes

List routes that have no permission key by design (auth flow, push subscription, anything that must work pre-login or for any logged-in user). Confirm each is genuinely safe to be open.

## Permission Keys Inventory

| Key | Used By (page patterns) | Used By (api patterns) | Defined in roles.html PERMISSION_LABELS? |
|---|---|---|---|
| `jobs` | `/jobs/*` | `/api/jobs` | yes/no |
| ... | ... | ... | ... |

Flag any permission key referenced in either map but missing from `admin/roles.html` `PERMISSION_LABELS` (which would mean admins can't configure it).
```

## Part 2 — How to build the matrix

1. Read `_worker.js`:
   - Extract every entry of the `API_ROUTES` table (F2).
   - Extract `API_PERMISSION_MAP` and `PATH_PERMISSION_MAP`.
2. For each API route in `API_ROUTES`:
   - Take its `path` or `prefix` value.
   - Test it against each `API_PERMISSION_MAP` pattern in order; record the first match.
   - If no match, mark as gap.
3. Read `admin/roles.html`:
   - Extract `PERMISSION_LABELS` keys.
   - Cross-reference against the union of keys used in both maps.
4. Render the table.

## Part 3 — Inference rules for the "Recommended addition" column

When suggesting a permission key for a gapped route:
- Look at neighboring routes in the same module group (the F2 table's section comments make this easy).
- Prefer the most specific existing key in that group.
- Where ambiguous, default to the module-level key (e.g. `logistics.dashboard` for a generic logistics route).
- If the route looks intentionally open (auth, push, notifications, vapid keys), classify as Intentionally Open instead of recommending a key.

---

## Scope

- **One deliverable:** `/permissions-audit.md` at the repo root.
- Read-only against `_worker.js` and `admin/roles.html`. No code changes.
- No fixes applied. Recommendations are documented; each fix becomes its own one-line follow-up prompt that Steve runs selectively.
- Do not list every individual handler function — the audit is at the route level (API_ROUTES table grain).

## Verify

1. File exists at `/permissions-audit.md`.
2. Every entry in `API_ROUTES` appears exactly once in the API table.
3. The Gaps Found section is non-empty if and only if at least one route has no matching pattern in `API_PERMISSION_MAP`.
4. Permission keys inventory cross-references roles.html accurately.

## Next

Each gap becomes a one-line `API_PERMISSION_MAP` addition (one short prompt per gap, or one batched prompt covering all gaps if they share a clear domain). After fixes, regenerate this audit and check the Gaps section is empty. Then F4 (R2 migration phased per blob type) begins.
