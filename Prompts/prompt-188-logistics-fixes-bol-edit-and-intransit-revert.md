# Prompt NNN — Logistics Fixes: BOL Edit-Step Blank (#4) + Manager Revert In-Transit→Bay (#3)

> **Type:** Two independent logistics fixes. Frontend + one worker change. No migration.
> **Prompt number:** Steve assigns. Replace `NNN` in the filename before running.

## 0. Required reading (do this first)

1. **Pull the repo** (`git pull` on `main`).
2. Read **`AGENTS.md`** and **`xpanda-ops-agents.md`** in full.
3. Assume the **Logistics Agent** (`xpanda-ops-agents.md` §3) as lead, with the **Database & API Agent** (§9) for the `_worker.js/routes/loading.js` change in Part B.

---

## PART A — #4: BOL review **Edit** step shows blank (one-line fix)

### Root cause (confirmed)
The dashboard popup BOL launcher (P171, `openBolModalForJob` in `logistics/index.html`) runs the shared `BolCompose` engine. The review step's PDF preview works (it uses `BolShared`), but clicking **Edit** calls `handleReviewEdit` → `BolEditor.open(...)`. `logistics/load-builder.html` loads `bol-editor.js`; **`logistics/index.html` does not** — so `BolEditor` is undefined on the dashboard, the call throws, and the edit surface renders blank.

### Fix
In **`logistics/index.html`**, add the BolEditor script include alongside the existing BOL script tags (`bol-compose.js`, `bol-shared.js`), matching the ordering load-builder uses (`bol-editor.js` before `bol-compose.js`):

```html
<script src="/logistics/bol-editor.js"></script>
```

- Place it adjacent to the existing `<script src="/logistics/bol-compose.js"></script>` / `<script src="/logistics/bol-shared.js"></script>` lines. Confirm against `load-builder.html`'s include block for exact path/ordering.
- No other change in Part A. Do not modify `bol-compose.js`, `bol-editor.js`, or any BOL logic.

---

## PART B — #3: Managers can move an In-Transit trailer back to a bay (misclick recovery)

### Intent
Operators sometimes misclick "Mark In Transit." Managers need to undo it: revert an `in_transit` assignment back to the bayed, ready state. **Target state: `loading_status = 'loaded'`, `location = 'bay'`, and `in_transit_at` cleared.** (If Steve later wants `not_started` instead, only the target status string changes.)

### B1 — Client: revert control on in-transit cards (`logistics/loading.html`)

In the loading-card action row (where the existing `advanceStatus` / `moveToYard` buttons render, ~lines 595–607), add a **manager-only** button shown only when `a.loading_status === 'in_transit'`:

```js
${isManager && a.loading_status === 'in_transit'
  ? `<button class="ld-btn-yard" onclick="revertToBay('${a.id}')">Move back to bay</button>`
  : ''}
```

Add a `revertToBay(assignmentId)` function that **mirrors the existing `advanceStatus` function's success/refresh/error handling exactly** (same reload call, same alert-on-failure pattern), differing only in the payload and a confirm:

```js
async function revertToBay(assignmentId) {
  if (!confirm('Move this trailer back to a bay? This undoes "In Transit".')) return;
  const { ok, data } = await api.put('/api/loading-assignments', { id: assignmentId, loading_status: 'loaded', location: 'bay' });
  if (!ok) { alert((data && data.error) || 'Failed to move back to bay.'); return; }
  // …then trigger the SAME refresh advanceStatus uses on success.
}
```

Look at `advanceStatus` (~line 631) for the exact refresh call and replicate it — do not invent a new reload path.

### B2 — Worker: gate the reverse transition + clear the timestamp (`_worker.js/routes/loading.js`)

In the PUT handler's `if (payload.loading_status) { … }` block (the section around lines 227–256 that already manager-gates the `→ in_transit` transition), add **two** things:

1. **Manager gate for backward exits from `in_transit`.** Currently nothing stops a non-manager from writing a status backward out of `in_transit`. Add, before the `updates.push('loading_status = ?')` line:

```js
// Manager-only: reverting a trailer backward out of In Transit (misclick recovery).
{
  const FLOW = ['awaiting', 'not_started', 'loading', 'loaded', 'in_transit', 'delivered'];
  const fromIdx = FLOW.indexOf(existing.loading_status);
  const toIdx   = FLOW.indexOf(payload.loading_status);
  if (existing.loading_status === 'in_transit' && toIdx > -1 && fromIdx > -1 && toIdx < fromIdx
      && !isAdministrator && !(userPerms['logistics.loading.manage']?.edit)) {
    return json({ ok: false, error: 'Manager access required to move a trailer out of In Transit.' }, 403);
  }
}
```

2. **Clear `in_transit_at` on revert** so timestamps stay truthful and a future re-advance re-stamps. Add alongside the existing `*_at` write block:

```js
if (existing.loading_status === 'in_transit' && payload.loading_status !== 'in_transit') {
  updates.push('in_transit_at = ?'); binds.push(null);
}
```

- Use the existing `isAdministrator` / `userPerms['logistics.loading.manage']?.edit` pattern already in the file — do not introduce a new permission key.
- The `location: 'bay'` part of the payload is already handled by the existing `payload.location` branch (line ~205); no change needed there.
- Do **not** touch the public driver QR-pickup path (`routes/public.js`) or the forward-transition manager gates.

---

## Scope fences (both parts)
- Files touched: `logistics/index.html` (one script tag), `logistics/loading.html` (one button + one function), `_worker.js/routes/loading.js` (two small inserts). Nothing else.
- No migration, no new permission key, no schema change.
- Do not touch `bol-compose.js`, `bol-editor.js`, `bol-shared.js`, the forward status flow, or the yard logic beyond what's specified.

## Find/replace discipline
- Work on `/tmp` copies. Each find block matches the live file byte-for-byte and verifies `count == 1` via Python `.count()` before applying; on mismatch, re-read live bytes and adjust — never guess.
- Extract inline `<script>` blocks from the modified HTML via `re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S)` to a real temp file and run `node --check` on them.
- Run `node --check _worker.js/routes/loading.js`.

## Deliverable & report
- Per file: changes applied, `node --check` results, any find block that failed `count == 1`.
- Confirm: BolEditor now loads on the dashboard (Edit step renders); in-transit cards show "Move back to bay" for managers only; non-managers get 403 on a backward in_transit transition; `in_transit_at` clears on revert.
