# Prompt 53 — Trailer Number Permission Guard + Saved Loads Button on Load Tab

## Goal

Two small, independent fixes:

1. **Backend permission guard on trailer number updates.** The loading dashboard UI already hides the trailer number input for non-managers, but the `PUT /api/loading-bays` endpoint has no server-side permission check. Anyone who crafts a request can update a bay's trailer number. Add a manager-only guard.

2. **Move "Saved Loads" button to the Load Builder's initial tab.** Currently the SAVE LOAD and LOAD (open saved loads) buttons are only on the Results tab. Users have to build a load and navigate to Results before they can access previously saved loads. Add a SAVED LOADS button to the Load tab so users can open saved loads immediately on page load.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Fix 1 — Permission guard on `PUT /api/loading-bays`

In `_worker.js`, find `handleApiLoadingBays` (around line 4160). The PUT handler starts around line 4175.

Currently it looks like:

```javascript
if (request.method === 'PUT') {
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    const { id, trailer_number, label } = payload;
    if (!id) return json({ ok: false, error: 'id is required.' }, 400);
```

Add a permission check **before** the payload parsing. The function needs access to the user's permission headers, so add header reads at the top of the PUT block:

```javascript
if (request.method === 'PUT') {
    const userPerms = JSON.parse(request.headers.get('X-User-Permissions') || '{}');
    const isAdministrator = request.headers.get('X-User-Is-Admin') === '1';

    if (!isAdministrator && !(userPerms['logistics.loading.manage']?.edit)) {
      return json({ ok: false, error: 'Manager access required to update bay settings.' }, 403);
    }

    let payload;
    // ... rest of existing PUT handler unchanged
```

That's the only change for Fix 1.

---

## Fix 2 — Saved Loads button on Load tab

In `logistics/load-builder.html`, find the `renderLoadTab()` function (around line 1339). It builds content for the LOAD tab. Currently it starts with the trailer type selector card.

Add a SAVED LOADS button row **at the very top of the Load tab**, before the trailer type card. After `cont.innerHTML = '';` and before the trailer type card:

```javascript
// Saved Loads quick-access button
const savedRow = h('div', { className: 'flex gap-10 flex-wrap mb-14' });
savedRow.appendChild(h('button', { className: 'btn btn-white', onClick: openLoadModal }, '📂 SAVED LOADS'));
cont.appendChild(savedRow);
```

This calls the existing `openLoadModal()` function — no new logic needed. The button goes above the trailer type card so it's the first thing the user sees.

**Do NOT** remove the existing SAVE LOAD and LOAD buttons from the Results tab — those stay exactly where they are.

---

## What NOT to touch

- Do NOT modify `loading.html` frontend code
- Do NOT modify `bol-shared.js` or `bol-generator.html`
- Do NOT modify any other API handlers
- Do NOT modify the Results tab button layout
- Do NOT rename any existing functions or routes
- Do NOT refactor unrelated code

---

## Completion checklist

- [ ] `_worker.js`: `handleApiLoadingBays` PUT handler checks `logistics.loading.manage` edit permission before processing
- [ ] `_worker.js`: Returns 403 with clear error message for non-managers
- [ ] `load-builder.html`: `renderLoadTab()` includes a SAVED LOADS button at the top of the Load tab
- [ ] SAVED LOADS button calls existing `openLoadModal()` — no new functions
- [ ] Results tab SAVE LOAD and LOAD buttons are unchanged
- [ ] No console errors

**Notify Steve:** No migrations needed. Deploy and test:
1. Log in as a non-manager (Staff role) → open Loading Dashboard → confirm trailer number field is read-only (already was)
2. Attempt a direct `PUT /api/loading-bays` request as a non-manager → should get 403
3. Log in as a manager → confirm trailer number field is still editable and saves correctly
4. Open Load Builder → Load tab should show SAVED LOADS button at the top
5. Click SAVED LOADS → saved loads modal opens (same as from Results tab)
