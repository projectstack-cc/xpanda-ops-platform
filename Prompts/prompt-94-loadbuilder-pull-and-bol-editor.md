# P94 — Load Builder "Pull from Job" button + fix tiny inline BOL editor

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **logistics-agent**, with **frontend-designer** for Task B's sizing and **job-board-agent** context for Task A's line-item source. Both tasks live in `logistics/load-builder.html` (Task B also reads, but does NOT modify, `logistics/bol-editor.js`). No DB, no migration.

---

## Task A — "Pull from Job" button

The job→load handoff already exists: **`prefillFromJob(jobId)`** (`load-builder.html` ~line 3085). It fetches `/api/jobs/:id`, matches line items to existing SKUs (creating parts on the fly when needed), and **appends** the resulting entries to `state.cart` (`for (const entry of cartEntries) { state.cart.push(entry); }`). It also sets `state.prefillJobId` / `state.prefillJobData`. It is currently triggered only via the `?job_id=` URL handoff from the job board's "Build Load" button.

Add an in-app **"Pull from Job"** button to the Load Builder that exposes this same mechanism:
- On click, open a job picker. Source the list from `GET /api/jobs?status=done,loading` (reuse the existing fetch/list pattern the dashboard uses — e.g. the job-search list already present in this file). Show customer + INV# per option.
- On selection, call the existing **`prefillFromJob(selectedJobId)`** — do **not** write new parts-mapping, matching, or auto-pack logic.
- Reuse the existing `#job-prefill-banner` (created ~line 3061) to show which job was pulled.

**ASSUMPTIONS (override before running if wrong):** picker lists **Done + Loading** jobs; pulling **APPENDS** to the current load (this is `prefillFromJob`'s existing behavior — do not change it to replace).

## Task B — Inline BOL editor renders tiny on Build Load (BUG)

**Root cause (already traced):** `BolEditor.open(bol, mountEl, ...)` in `bol-editor.js` sizes the canvas from its scroll container — line ~182:
```js
const logicalW = Math.max(200, scrollArea.clientWidth - 24);
```
On the **BOL generator** the mount is `#bol-editor-host` (`bol-generator.html` ~line 1662), styled `flex:1; display:flex; flex-direction:column; ...` inside a laid-out flex column, so `scrollArea.clientWidth` is the full panel width. On the **Load Builder** the mount is `#bol-review-editor-mount-lb` (opened from `openLbBolReviewEditor` ~line 2999/3004). If that mount (or an ancestor) has no resolved width when `open()` runs — because it lacks `flex:1`/`width:100%` sizing, or because `BolEditor.open` is called while its modal is still `display:none`/mid-animation — `scrollArea.clientWidth` is ~0 and `logicalW` collapses to the **200px floor**, producing the tiny render. (A `ResizeObserver` is attached at ~line 313, but if the container is fixed-small or hidden at open time it never gets a correct width.)

**Fix (in `load-builder.html` only — do NOT fork or edit `bol-editor.js`, keep the shared engine single-source):**
1. Give `#bol-review-editor-mount-lb` and its containing modal panel the same layout the generator host has — a flex column with the mount as `flex:1; min-width:0; width:100%;` so it has a real measurable width.
2. Ensure `BolEditor.open(...)` is called **after** the review modal is visible and laid out (e.g. open the modal, then call `open()` on the next frame via `requestAnimationFrame`, or after the modal's transition), so the first `clientWidth` measure is correct rather than 0.

Verify the editor on Build Load now matches the BOL generator's size.

---

## What NOT to change
- The auto-pack algorithm. The `STORAGE_KEY`. The `bol-shared.js` coordinate values. `bol-editor.js` itself. The BOL generator page (it already works). `prefillFromJob`'s append behavior and matching logic.
