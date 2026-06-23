# P147 — "Generate BOL" → "View BOL" on Logistics Dashboard

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent** (button label) +
**db-api-agent** (expose `bol_count` on the shipments query). No migration.

## Goal
On the logistics dashboard, the BOL action button always says "Generate BOL." When a BOL already
exists for the job, it should read "View BOL" — mirroring the loading-dashboard card. The existing
`bol-generator.html?job_id=` link already opens the saved BOL, so only the label needs to switch;
the shipments query must return a `bol_count` to drive it.

## Files
- `_worker.js/routes/jobs.js` — 1 edit (shipments SELECT)
- `logistics/index.html` — 1 edit (`buildActionButtons`)

---

### Edit 1 — `_worker.js/routes/jobs.js` : add `bol_count` to the shipments list query

FIND (count == 1):
```
        `SELECT * FROM shipments ${clause} ORDER BY ship_date DESC, created_at DESC`
```

REPLACE:
```
        `SELECT *, (SELECT COUNT(*) FROM bols b WHERE b.job_id = shipments.job_id) AS bol_count FROM shipments ${clause} ORDER BY ship_date DESC, created_at DESC`
```

### Edit 2 — `logistics/index.html` : swap the label when a BOL exists

FIND (count == 1):
```
function buildActionButtons(shipment) {
  if (!shipment.job_id) return '';
  if (['delivered', 'cancelled'].includes(shipment.status)) return '';

  return `<a class="logistics-action-btn action-load" href="/logistics/load-builder.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">Build Load</a> <a class="logistics-action-btn action-bol" href="/logistics/bol-generator.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">Generate BOL</a>`;
}
```

REPLACE:
```
function buildActionButtons(shipment) {
  if (!shipment.job_id) return '';
  if (['delivered', 'cancelled'].includes(shipment.status)) return '';

  const bolLabel = Number(shipment.bol_count || 0) > 0 ? 'View BOL' : 'Generate BOL';
  return `<a class="logistics-action-btn action-load" href="/logistics/load-builder.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">Build Load</a> <a class="logistics-action-btn action-bol" href="/logistics/bol-generator.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">${bolLabel}</a>`;
}
```

---

## Verify
- Both FINDs `count == 1`.
- `cp _worker.js/routes/jobs.js /tmp/jobs.mjs && node --check /tmp/jobs.mjs`
- Extract the `logistics/index.html` `<script>` block to a temp `.js` and `node --check` it.
- Correlated subquery references the outer table by name (`shipments.job_id`) — confirm it parses.

## What NOT to change
- Do NOT add a BOL viewer to the logistics page; the existing `bol-generator.html?job_id=` link is the view path.
- Do NOT touch the loading dashboard, `bol-shared.js`, `bol-compose.js`, auto-pack, or `STORAGE_KEY`.
- No migration.

## Deploy
```
git add _worker.js/routes/jobs.js logistics/index.html
git commit -m "P147: logistics dashboard BOL button shows View BOL when bol_count>0 (shipments query + label swap)"
git push
```
