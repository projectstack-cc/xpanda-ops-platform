# P141 — Trailer-Assigned Badge on Job Board Card

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. This task is **db-api-agent**
(expose assigned trailer on the jobs list query) + **job-board-agent** (render the badge on the
kanban card). No migration. No schema change.

## Goal
When a trailer is assigned on the loading dashboard (`loading_assignments.trailer_number`),
surface a "Trailer Assigned" indicator on that job's kanban card in `jobs/index.html`. The trailer
lives on `loading_assignments`, not `jobs`, so the jobs list query must expose it.

## Files
- `_worker.js/routes/jobs.js` — 1 edit (JOB_LIST_COLS subquery)
- `jobs/index.html` — 3 edits (CSS rule, JS const, template injection)

---

### Edit 1 — `_worker.js/routes/jobs.js` : expose assigned trailers (read-only subquery)

FIND (must match exactly, count == 1):
```
    j.packing_slip_filename, j.packing_slip_invoice, j.source,
    CASE WHEN EXISTS (SELECT 1 FROM shipments s WHERE s.job_id = j.id AND s.direction = 'outbound') THEN 1 ELSE 0 END AS has_shipment
  `;
```

REPLACE:
```
    j.packing_slip_filename, j.packing_slip_invoice, j.source,
    CASE WHEN EXISTS (SELECT 1 FROM shipments s WHERE s.job_id = j.id AND s.direction = 'outbound') THEN 1 ELSE 0 END AS has_shipment,
    (SELECT GROUP_CONCAT(la.trailer_number, ', ')
       FROM loading_assignments la
      WHERE la.job_id = j.id
        AND COALESCE(la.trailer_number, '') != ''
        AND la.loading_status != 'archived') AS assigned_trailers
  `;
```

### Edit 2 — `jobs/index.html` : add badge CSS

FIND (count == 1):
```
.jobs-slip-badge-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; margin-top: 2px; }
```

REPLACE:
```
.jobs-slip-badge-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; margin-top: 2px; }
.jobs-card-trailer { display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; padding: 2px 8px; font-size: 11px; font-weight: 600; border-radius: 9999px; background: rgba(99,102,241,.12); color: #4338ca; }
```

### Edit 3 — `jobs/index.html` : build the badge string

FIND (count == 1):
```
  const shipmentIcon = job.has_shipment
    ? ` <span class="jobs-card-shipment" title="Outbound shipment record exists">🚚</span>`
    : '';
```

REPLACE:
```
  const shipmentIcon = job.has_shipment
    ? ` <span class="jobs-card-shipment" title="Outbound shipment record exists">🚚</span>`
    : '';
  const trailerBadge = job.assigned_trailers
    ? `<div class="jobs-card-trailer" title="Trailer ${esc(job.assigned_trailers)} assigned on the loading dashboard">🚛 Trailer Assigned</div>`
    : '';
```

### Edit 4 — `jobs/index.html` : inject badge into the card body (after processes)

FIND (count == 1):
```
    ${procHtml}
    ${job.status === 'shipped' ? `<button class="jobs-archive-btn" style="width:100%;margin-top:4px;" onclick="event.stopPropagation();archiveJob('${esc(job.id)}','${esc(job.customer)}')" title="Archive this job">Archive</button>` : ''}
```

REPLACE:
```
    ${procHtml}
    ${trailerBadge}
    ${job.status === 'shipped' ? `<button class="jobs-archive-btn" style="width:100%;margin-top:4px;" onclick="event.stopPropagation();archiveJob('${esc(job.id)}','${esc(job.customer)}')" title="Archive this job">Archive</button>` : ''}
```

---

## Verify
- Each FIND confirmed `count == 1` before applying.
- `cp _worker.js/routes/jobs.js /tmp/jobs.mjs && node --check /tmp/jobs.mjs`
- Extract the `jobs/index.html` `<script>` block to a temp `.js` and `node --check` it (do NOT pipe via /dev/stdin).

## What NOT to change
- Do NOT alter the auto-pack algorithm, `STORAGE_KEY`, or any load-builder code.
- Do NOT add a migration — `loading_assignments.trailer_number` already exists.
- Do NOT touch the loading dashboard or trailer-assignment write path (that's P144).
- `esc()` is the existing escape helper in `jobs/index.html`; do not introduce a new one.

## Deploy
```
git add _worker.js/routes/jobs.js jobs/index.html
git commit -m "P141: trailer-assigned badge on job board card (assigned_trailers subquery + card badge)"
git push
```
