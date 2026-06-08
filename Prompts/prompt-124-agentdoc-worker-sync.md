# Prompt 124 — Doc sync: correct stale `_worker.js` description in `xpanda-ops-agents.md`

## What this is
**Documentation only.** No code, no migration, no `_worker.js` change, no behavior change. `xpanda-ops-agents.md` still describes the worker as a 227KB monolith with flat `if/else` routing that must never be split. Since then, F2 replaced the dispatch with the `API_ROUTES` table and F5 file-split the worker into `_worker.js/index.js` + `_worker.js/lib/` + `_worker.js/routes/*.js` (bundled by Cloudflare Pages Advanced Mode into one worker). The stale text mis-routes future work — most dangerously the "NO ES6 imports/exports" rule, which the worker now relies on. Fix all of it in one pass so the doc is internally consistent.

## Scope
Edit **only** `xpanda-ops-agents.md` at the repo root. Twelve exact replacements below. Each FIND string is unique in the file. Do not touch `AGENTS.md`, code, or anything else.

---

### 1
FIND:
```
# Total Files: ~50+ across 8 modules, 1 monolithic worker (227KB), 12 DB migrations
```
REPLACE:
```
# Total Files: ~60+ across 8 modules, 1 worker (file-split: _worker.js/index.js + lib/ + routes/, ~5,500 lines), 20 DB migrations
```

### 2
FIND:
```
  _worker.js              (227KB — ALL API routes in single file)
```
REPLACE:
```
  _worker.js/             (Pages Advanced Mode worker — file-split, bundled into ONE worker)
    index.js              (entry: session gate + F2 API_ROUTES table dispatch)
    lib/core.js           (json/error, validateSession, PATH/API_PERMISSION_MAP, logActivity, helpers)
    lib/push.js           (web-push / VAPID notification dispatch)
    routes/*.js           (per-domain handlers: auth, jobs, bols, loading, production,
                           qc, reports, admin, notifications, public)
```

### 3
FIND:
```
- **NO module systems**: No ES6 imports/exports. Scripts load via `<script src="">`.
```
REPLACE:
```
- **NO module systems in browser code**: front-end scripts load via `<script src="">` — no ES6 imports/exports, no bundler. (The worker bundle is the one exception: `_worker.js/index.js` uses ES `import`/`export` across `lib/` and `routes/`; Cloudflare Pages bundles it with no build step of ours.)
```

### 4
FIND:
```
- **Single worker file**: All APIs stay in `_worker.js`. Never split into separate files.
```
REPLACE:
```
- **One bundled worker, file-split source**: the worker is `_worker.js/index.js` + `_worker.js/lib/` + `_worker.js/routes/`, bundled by Pages (Advanced Mode) into a single worker. Add an endpoint by writing the handler in the right `routes/*.js` and adding one row to the `API_ROUTES` table in `index.js` — do NOT collapse it back into a monolithic file.
```

### 5
FIND:
```
// PATH_PERMISSION_MAP and API_PERMISSION_MAP in _worker.js
```
REPLACE:
```
// PATH_PERMISSION_MAP and API_PERMISSION_MAP live in _worker.js/lib/core.js
```

### 6
FIND:
```
1. Add key to `PATH_PERMISSION_MAP` and `API_PERMISSION_MAP` in `_worker.js`
```
REPLACE:
```
1. Add key to `PATH_PERMISSION_MAP` and `API_PERMISSION_MAP` in `_worker.js/lib/core.js`
```

### 7
FIND:
```
You architect and maintain the data layer and API backend. You own `_worker.js` (227KB monolithic worker) and all `DB Migrations/*.sql` files. You enforce data integrity, API consistency, and the "single worker file" rule.
```
REPLACE:
```
You architect and maintain the data layer and API backend. You own the `_worker.js/` worker (entry `index.js`, shared `lib/`, per-domain `routes/`, bundled by Pages into one worker) and all `DB_Migrations/*.sql` files. You enforce data integrity, API consistency, and the file-split-but-single-bundle worker structure.
```

### 8
FIND:
```
- **Single Worker**: `_worker.js` contains ALL API routes using flat `if (url.pathname === "...")` checks
```
REPLACE:
```
- **One bundled worker, split source**: `_worker.js/index.js` runs the session gate, then dispatches through the F2 `API_ROUTES` table to handlers in `routes/*.js`; shared helpers live in `lib/core.js` + `lib/push.js`. Pages Advanced Mode bundles the directory into a single worker (no build step of ours).
```

### 9
FIND:
```
- Flat if/else routing in `_worker.js` — verbose at 37+ routes, but router abstraction not planned
```
REPLACE:
```
- (Resolved) Flat if/else routing was replaced by the F2 `API_ROUTES` declarative table in `index.js`, and the worker was file-split into `lib/` + `routes/` under F5. Keep that structure.
```

### 10
FIND:
```
3. Backend API handler in `_worker.js`
```
REPLACE:
```
3. Backend API handler in the appropriate `_worker.js/routes/*.js` (+ one `API_ROUTES` row in `index.js`)
```

### 11
FIND:
```
5. Add permission key to `PATH_PERMISSION_MAP` and `API_PERMISSION_MAP` if new module
```
REPLACE:
```
5. Add permission key to `PATH_PERMISSION_MAP` and `API_PERMISSION_MAP` (in `lib/core.js`) if new module
```

### 12
FIND:
```
| `_worker.js` | 227KB | Monitor — consider splitting ONLY if explicitly approved |
```
REPLACE:
```
| `_worker.js/` (split) | ~5,500 lines | Already file-split (index.js + lib/ + routes/) under F2/F5; largest is `routes/bols.js` (~840 lines). Add to the right module, never back into one file. |
```

---

## Verify
- After editing, none of these strings remain in `xpanda-ops-agents.md`: `227KB`, `monolithic worker`, `ALL API routes in single file`, `router abstraction not planned`.
- The doc still reads coherently — the db-api-agent section now describes `index.js` + `lib/` + `routes/`, and the cross-cutting rules no longer forbid the ES imports the worker actually uses.

## Out of scope (left for a later doc pass — do NOT touch now)
The Section-1 migrations list is also stale (missing `render-overrides.sql`, `add-bol-access-token.sql`, `add-signed-bol-and-delivery-meta.sql`, etc.) and the dir is `DB_Migrations/` (underscore), written `DB Migrations/` in a few spots. Not part of this prompt.

## Deploy
```
git add xpanda-ops-agents.md
git commit -m "P124: doc sync — xpanda-ops-agents.md worker section to post-F2/F5 reality (file-split worker, API_ROUTES, ESM in worker bundle)"
git push
```
