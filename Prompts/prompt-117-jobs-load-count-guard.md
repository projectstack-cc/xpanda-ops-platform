# Prompt 117 — Job Board: confirm guard when Load Count exceeds 10

Read `AGENTS.md` and `xpanda-ops-agents.md` first. This is a frontend-only guard on job save —
assume the **job-board-agent** (`xpanda-ops-agents.md`).

Scope: **`jobs/index.html` only.** Frontend only. **No migration. No backend change. No `max`
clamp on the input** — the field still accepts any value; this only adds a confirmation step.

Single-source anchor (verified): the `const payload = {` block inside `saveJob()` is the only one
in the file. Apply as exact find/replace.

---

## Edit — Confirm before saving when load count > 10

FIND:
```
  const shipDate = document.getElementById('f-ship-date').value;

  const payload = {
    customer,
```
REPLACE:
```
  const shipDate = document.getElementById('f-ship-date').value;

  const loadCountVal = parseInt(document.getElementById('f-load-count').value, 10) || 1;
  if (loadCountVal > 10 && !confirm('Are you sure you want more than 10 trailers?')) {
    return;
  }

  const payload = {
    customer,
```

---

## Result
When `saveJob()` runs (create or edit) and the Load Count field is greater than 10, a confirm
dialog asks "Are you sure you want more than 10 trailers?". On **OK** the save proceeds exactly as
before. On **Cancel** the function returns and the modal stays open with all entered values intact
for editing. Load counts of 10 or fewer save with no prompt and no behavior change.

## Verify after editing
- Confirm the change actually deployed to Cloudflare (live page).
- Enter a job with Load Count = 11 and save → prompt appears; Cancel keeps the form open, OK saves.
- Enter Load Count = 5 and save → no prompt, saves normally.
