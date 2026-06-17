# Prompt 183 — Job Board List view: inline status dropdown

## Required reading
1. Read `AGENTS.md` and `xpanda-ops-agents.md`.
2. Assume the **job-board-agent** role. Single file: `jobs/index.html`. Frontend only. Assumes P182 has landed.

## Context
On the List view, make the Status cell an inline dropdown so a row's status can be changed without opening the job. Editable statuses are the three manually-settable ones (Not Started / In Production / Done) — the same set the job modal allows. Jobs in a logistics-driven state (loading / shipped / archived) stay a read-only pill, since those are set by the loading flow, not by hand. Changing the dropdown reuses the existing `moveCard` path (optimistic update, server PUT, revert on failure, bead prompt on Done), and the List re-renders so tab counts stay in sync.

All edits byte-exact, each count==1. Confirm before applying.

## Edit 1 — Build a status cell (dropdown when editable, pill otherwise) (`jobs/index.html`)
FIND (exactly once):
```
    const sc          = STATUS_COLORS[job.status] || STATUS_COLORS.not_started;
    const statusLabel = STATUS_LABELS[job.status] || job.status;
    const lo          = LIST_LOADING[job.loading_status_indicator];
```
REPLACE:
```
    const sc          = STATUS_COLORS[job.status] || STATUS_COLORS.not_started;
    const statusLabel = STATUS_LABELS[job.status] || job.status;
    const lo          = LIST_LOADING[job.loading_status_indicator];
    const editable    = ['not_started', 'in_production', 'done'].includes(job.status);
    let statusCell;
    if (editable) {
      const opts = ['not_started', 'in_production', 'done'].map(s =>
        `<option value="${s}"${s === job.status ? ' selected' : ''}>${esc(STATUS_LABELS[s] || s)}</option>`).join('');
      statusCell = `<select onclick="event.stopPropagation();" onchange="event.stopPropagation();listStatusChange('${esc(job.id)}',this.value);" style="padding:3px 22px 3px 9px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid ${sc.border};background:${sc.bg};color:${sc.text};cursor:pointer;">${opts}</select>`;
    } else {
      statusCell = `<span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;background:${sc.bg};color:${sc.text};">${esc(statusLabel)}</span>`;
    }
```

## Edit 2 — Use the status cell in the row (`jobs/index.html`)
FIND (exactly once):
```
      <td style="padding:9px 12px;"><span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;background:${sc.bg};color:${sc.text};">${esc(statusLabel)}</span></td>
```
REPLACE:
```
      <td style="padding:9px 12px;">${statusCell}</td>
```

## Edit 3 — Wire the change handler to the existing moveCard path (`jobs/index.html`)
Add immediately before `renderList`.
FIND (exactly once):
```
function renderList(jobs) {
```
REPLACE:
```
function listStatusChange(jobId, newStatus) {
  const job = (allJobs || []).find(j => j.id === jobId);
  if (!job || job.status === newStatus) return;
  moveCard(jobId, newStatus);
}

function renderList(jobs) {
```

## Validation
Extract `jobs/index.html` inline `<script>` blocks via `re.findall` to real temp files and `node --check` each (do NOT pipe via `/dev/stdin`).

## Manual sanity (Steve)
- On the List view, rows in Not Started / In Production / Done show a status dropdown; changing it moves the job (and updates tab counts) without opening the modal. Moving to Done still triggers the bead prompt. Loading/Shipped rows show a read-only pill. Clicking the dropdown does not open the job modal; clicking elsewhere on the row still does.

## What NOT to change
- Do NOT make loading/shipped/archived statuses selectable from the List (those are driven by the loading flow).
- Do NOT alter `moveCard`, the kanban, the calendar, or the job modal.
- Do NOT touch the worker, DB, or any other file.

## Deliverables
- `jobs/index.html` — `statusCell` (dropdown/pill), row uses it, `listStatusChange` reusing `moveCard`.
- Inline scripts pass `node --check`.
