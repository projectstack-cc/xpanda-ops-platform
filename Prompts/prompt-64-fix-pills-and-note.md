# Prompt 64 — Fix Status Badge Pills + Remove Job-Linked Note

## Goal

Two fixes to `logistics/index.html`. Nothing else.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Problem 1 — Status badges display as raw text for some statuses

The `ready_to_ship` and `in_production` statuses show as raw underscored text (e.g. `ready_to_ship`) instead of styled pills. This is caused by duplicate CSS definitions. Lines 44–45 in the inline `<style>` block define `.status-in_production` and `.status-ready_to_ship` with extra properties that conflict with the base `.logistics-status-badge` styles in `logistics-shared.css`.

### Fix

Delete lines 44–45 from the inline `<style>` block. Remove these two lines entirely:

```css
.status-in_production { background: #fef3c7; color: #92400e; border-radius: 6px; padding: 2px 8px; font-size: 12px; font-weight: 600; }
.status-ready_to_ship { background: #dcfce7; color: #166534; border-radius: 6px; padding: 2px 8px; font-size: 12px; font-weight: 600; }
```

These classes already exist in `logistics-shared.css` at lines 305–306 with the correct styling that matches all other status badges.

---

## Problem 2 — Job-linked note is unnecessary

The blue info banner that says "This shipment is linked to a job. Changes to customer, carrier, address, and dates should be made on the Job Board to stay in sync." is confusing because the logistics dashboard IS now the place to edit these fields — changes sync back to the job via `syncJobFromModal()`.

### Fix

In the `openEdit()` function, find this block:

```javascript
  // Job-linked note
  const jobNote = document.getElementById('job-linked-note');
  if (jobNote) {
    if (s.job_id) {
      jobNote.style.display = '';
      jobNote.innerHTML = `<span style="color:#0369a1;">ℹ</span> This shipment is linked to a job. Changes to customer, carrier, address, and dates should be made on the <a href="/jobs/?job_id=${s.job_id}" style="color:#0369a1;font-weight:600;">Job Board</a> to stay in sync.`;
    } else {
      jobNote.style.display = 'none';
    }
  }
```

Replace the entire block with:

```javascript
  // Hide job-linked note — edits here sync back to the job automatically
  const jobNote = document.getElementById('job-linked-note');
  if (jobNote) jobNote.style.display = 'none';
```

---

## What NOT to touch

- Do NOT modify `_worker.js`
- Do NOT modify any other file
- Do NOT modify the modal HTML fields
- Do NOT modify any JS functions other than the one block in `openEdit()` specified above
- Do NOT modify `logistics-shared.css`
