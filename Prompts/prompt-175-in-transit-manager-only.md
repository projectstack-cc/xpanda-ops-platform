# Prompt 175 — Restrict "Mark In Transit" to managers (loading team can no longer move an order to In Transit)

## Required reading (do this first)
1. Read `AGENTS.md` (platform conventions).
2. Read `xpanda-ops-agents.md` (multi-agent definition).
3. Two agents: **logistics-agent** (`logistics/loading.html`) for the button gate, and **db-api-agent** (`_worker.js/routes/loading.js`) for the server guard. No migration, no new permission key (reuses `logistics.loading.manage`).

## Context
On the loading dashboard, the "Mark In Transit" advance button is shown to anyone (`next && status !== 'awaiting'`), and the loading PUT handler has no role guard on the `in_transit` transition. So loading-team users can move a trailer to In Transit, which they shouldn't. This gates the in_transit transition to managers on both the client and server.

The driver QR-scan pickup path (`handleApiPublicBolPickup` in `routes/public.js`) is a **separate public handler** and is intentionally left untouched — drivers still trigger In Transit by scanning. The normal loading-team advances (Start Loading, Mark Loaded) stay available to the team.

Both edits are byte-exact find/replace, each verified to appear exactly once at HEAD. Confirm `count == 1` before applying.

---

## Edit 1 — Gate the advance button for `in_transit` (`logistics/loading.html`)
`isManager` is already in scope in this render function.

FIND (exactly once):
```
        ${next && a.loading_status !== 'awaiting'
          ? `<button class="ld-btn-advance" onclick="advanceStatus('${a.id}', '${next}')">${getAdvanceLabel(next)}</button>`
          : ''}
```
REPLACE:
```
        ${next && a.loading_status !== 'awaiting' && (next !== 'in_transit' || isManager)
          ? `<button class="ld-btn-advance" onclick="advanceStatus('${a.id}', '${next}')">${getAdvanceLabel(next)}</button>`
          : ''}
```

---

## Edit 2 — Server guard: reject in_transit from non-managers (`_worker.js/routes/loading.js`)
`userPerms` and `isAdministrator` are already defined in this PUT handler.

FIND (exactly once):
```
          return json({ ok: false, error: 'Manager access required for bay assignment.' }, 403);
        }
      }

      updates.push('loading_status = ?'); binds.push(payload.loading_status);
```
REPLACE:
```
          return json({ ok: false, error: 'Manager access required for bay assignment.' }, 403);
        }
      }

      // Manager-only: moving a trailer to In Transit. The loading team must not.
      // The public driver QR-pickup path is a separate handler and is unaffected.
      if (payload.loading_status === 'in_transit' && existing.loading_status !== 'in_transit'
          && !isAdministrator && !(userPerms['logistics.loading.manage']?.edit)) {
        return json({ ok: false, error: 'Manager access required to mark a trailer In Transit.' }, 403);
      }

      updates.push('loading_status = ?'); binds.push(payload.loading_status);
```

---

## Step 3 — Validation
- `_worker.js/routes/loading.js` is standalone `.js`: `node --check _worker.js/routes/loading.js`.
- `logistics/loading.html` inline `<script>` blocks: extract each with `re.findall` to **real temp files** (do NOT pipe via `/dev/stdin`), `node --check` each, confirm all pass, delete temp files.

## Step 4 — Manual sanity (notes for Steve)
- As a loading-team (non-manager) user: a `loaded` card no longer shows "Mark In Transit"; Start Loading / Mark Loaded still work. If the request is forced, the server 403s.
- As a manager/admin: "Mark In Transit" still appears and works.
- Driver scans the QR on a loaded trailer → still flips to In Transit (public pickup path unchanged).

## What NOT to change
- Do NOT touch `routes/public.js` (the driver pickup/transit path stays open).
- Do NOT change the loading/loaded/delivered transitions or their timestamp writes.
- Do NOT add a new permission key — reuse `logistics.loading.manage` (+ admin).
- Do NOT alter drag-and-drop gating (already manager-only in overview, disabled in bay view).

## Deliverables summary
- `logistics/loading.html` — advance button hidden for in_transit unless manager.
- `_worker.js/routes/loading.js` — 403 guard on in_transit for non-managers.
- Both files pass `node --check` (loading.html via inline-script extraction).
