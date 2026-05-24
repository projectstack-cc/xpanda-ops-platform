# Prompt 43 — Loading Dashboard QC Fixes

**Context:** The loading dashboard (`/logistics/loading.html`) and admin roles page (`/admin/roles.html`) have three bugs that need targeted fixes. No new features — strictly bug fixes.

Reference `AGENTS.md` for platform conventions.

---

## Bug 1: Pull Job modal appears on page load

**Root cause:** The `.ld-modal-backdrop` CSS class sets `display: flex`, which overrides the HTML `hidden` attribute. The `hidden` attribute is low-specificity and loses to any explicit CSS `display` value.

**Fix in `/logistics/loading.html`:**

In the `<style>` block, add this rule:

```css
.ld-modal-backdrop[hidden] { display: none !important; }
```

This ensures the `hidden` attribute always wins, regardless of the base `display: flex` on `.ld-modal-backdrop`.

**Do NOT** change the modal HTML or the JavaScript that sets `hidden`. Only add the CSS rule.

---

## Bug 2: Modal Cancel and Pull to Loading buttons don't work

**Root cause:** Same CSS issue as Bug 1. When `closePullJobModal()` sets `.hidden = true`, the CSS `display: flex` still overrides it, so the modal never closes. When `confirmPullJob()` calls `closePullJobModal()` after a successful save, the modal stays open, making it look like the save failed.

**Fix:** The CSS rule from Bug 1 resolves this too — once `[hidden]` properly hides the modal, both Cancel and Pull to Loading will work correctly. No JavaScript changes needed.

**Verify after fixing:** Confirm that `closePullJobModal()` sets `document.getElementById('pull-job-modal').hidden = true;` (it already does on line ~370). No changes needed there.

---

## Bug 3: Admin role shows two unchecked permissions in roles editor

**Root cause:** In `/admin/roles.html`, `renderPermissionEditor()` at ~line 484 reads checkbox state from the stored permissions JSON:

```js
const perm = perms[key] || { view: false, edit: false };
```

For the Administrator role, the DB permissions JSON may not contain the newer keys (`logistics.loading` and `logistics.loading.manage`) because the `json_set` migration used dot-path syntax that conflicts with SQLite's JSON path interpretation. At runtime this doesn't matter because the worker checks `user.isAdministrator` first and bypasses permissions entirely. But the roles editor UI reads from the stored JSON and shows unchecked boxes.

**Fix in `/admin/roles.html`:**

In the `renderPermissionEditor()` function, change the line that reads:

```js
const perm = perms[key] || { view: false, edit: false };
```

To:

```js
const perm = isAdmin ? { view: true, edit: true } : (perms[key] || { view: false, edit: false });
```

This forces all permission checkboxes to display as checked for the Administrator role, matching the runtime behavior. The checkboxes are already `disabled` for admin so the user can't interact with them — this just makes the visual state accurate.

**Do NOT** change anything else in `renderPermissionEditor()`. Do NOT modify the worker, the SQL, or the permission enforcement logic.

---

## Files to modify

1. `/logistics/loading.html` — Add one CSS rule (Bug 1 + Bug 2)
2. `/admin/roles.html` — Change one JS line in `renderPermissionEditor()` (Bug 3)

## Files NOT to modify

- `_worker.js` — No API changes
- `logistics-header.js` — No header changes
- `logistics-shared.css` — No shared CSS changes
- Any SQL files — No schema changes

---

## Verification checklist

After applying fixes:

- [ ] Loading dashboard loads without any modal popup
- [ ] Clicking "+ Pull Job" opens the modal
- [ ] Searching for a job, selecting it, and clicking "Pull to Loading" saves and closes the modal
- [ ] Clicking "Cancel" closes the modal
- [ ] In Admin → Roles, selecting Administrator shows ALL permission checkboxes as checked
- [ ] Non-admin roles still show their actual stored permission state (not forced to checked)
