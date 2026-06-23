# P142 — Move to Yard Permission Gate

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. This task is **logistics-agent**
(hide the button) + **db-api-agent** (enforce on the server). No migration. Reuses the existing
`logistics.loading.manage` permission key (same key already gating bay assignment and trailer
edits) — no new permission key, no `roles.html` change.

## Goal
"Move to Yard" is currently callable by anyone with `logistics.loading` edit. Gate it to managers
(admin OR `logistics.loading.manage` edit), matching how Assign Bay and trailer edits are gated.
Hide the button for non-managers, and enforce server-side so the API can't be called directly.

## Files
- `logistics/loading.html` — 1 edit (wrap button in `isManager`)
- `_worker.js/routes/loading.js` — 1 edit (server enforcement on `location === 'yard'`)

---

### Edit 1 — `logistics/loading.html` : hide button for non-managers

The card render function already computes `isManager` (admin OR `logistics.loading.manage` edit).
Wrap the Move to Yard button in it.

FIND (count == 1):
```
        ${a.bay_id && ['not_started','loading','loaded'].includes(a.loading_status)
          ? `<button class="ld-btn-yard" onclick="moveToYard('${a.id}')">Move to Yard</button>`
          : ''}
```

REPLACE:
```
        ${isManager && a.bay_id && ['not_started','loading','loaded'].includes(a.loading_status)
          ? `<button class="ld-btn-yard" onclick="moveToYard('${a.id}')">Move to Yard</button>`
          : ''}
```

### Edit 2 — `_worker.js/routes/loading.js` : enforce on the server

The PUT handler already reads `isAdministrator` and `userPerms` from request headers near the top.
Add a manager check when the caller is moving an assignment to the yard.

FIND (count == 1):
```
    if (payload.location !== undefined) {
      updates.push('location = ?');
      binds.push(payload.location === 'yard' ? 'yard' : 'bay');
    }
```

REPLACE:
```
    if (payload.location !== undefined) {
      if (payload.location === 'yard' && !isAdministrator && !(userPerms['logistics.loading.manage']?.edit)) {
        return json({ ok: false, error: 'Manager access required to move a trailer to the yard.' }, 403);
      }
      updates.push('location = ?');
      binds.push(payload.location === 'yard' ? 'yard' : 'bay');
    }
```

---

## Verify
- Both FINDs confirmed `count == 1`.
- `cp _worker.js/routes/loading.js /tmp/loading.mjs && node --check /tmp/loading.mjs`
- Extract the `logistics/loading.html` `<script>` block to a temp `.js` and `node --check` it.
- Confirm `isManager` is in scope at the button-render site (it is defined in the same card-render
  function that emits this button — verify before applying).

## What NOT to change
- Do NOT introduce a new permission key or edit `admin/roles.html`; reuse `logistics.loading.manage`.
- Do NOT change the existing bay-assignment or trailer-edit gating.
- Do NOT touch the auto-pack algorithm, `STORAGE_KEY`, or load-builder.

## Deploy
```
git add logistics/loading.html _worker.js/routes/loading.js
git commit -m "P142: gate Move to Yard behind logistics.loading.manage (frontend hide + server 403)"
git push
```
