# P95 — F3 follow-up: close the `/api/saved-loads` permission gap

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **admin-auth-agent** and **db-api-agent**. Foundation Roadmap **Phase F3** loose end.

The P78 permissions audit (`/permissions-audit.md`) found exactly **one** ungated API route: `/api/saved-loads` matches no entry in `API_PERMISSION_MAP`, so any authenticated user can read/write/delete saved loads regardless of Load Builder access. The Load Builder page and `/api/load-builder-skus` are both gated by `logistics.load-builder`; saved loads are exclusively a Load Builder concern.

## Change (`_worker.js`)

Add one entry to `API_PERMISSION_MAP`, immediately after the `/api/load-builder-skus` entry:

```javascript
{ pattern: /^\/api\/saved-loads/, key: 'logistics.load-builder' },
```

Confirm the key `logistics.load-builder` already exists in `PERMISSION_LABELS` (the audit says all referenced keys are present — no label change needed). No DB, no migration, no frontend change.

After adding it, re-scan `API_PERMISSION_MAP` to confirm `/api/saved-loads` now matches before any broader/catch-all pattern, and that no other route regressed.

## What NOT to change
- Any other permission entries. The `logistics.loading.manage` sub-capability (intentionally client-side only, per the audit). The `STORAGE_KEY`. Auto-pack. Saved-loads handler logic itself — this only adds the gate.
