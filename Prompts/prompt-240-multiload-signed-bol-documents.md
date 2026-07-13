# Prompt 240 — Logistics dashboard: show signed BOL copies for EVERY load, not just the first

## Agent
Read **BOTH** `AGENTS.md` **AND** `xpanda-ops-agents.md`. You are the **logistics-agent** (§3, Logistics Module). Identify yourself as such at the start.

Frontend-only, **one function**, one file: `logistics/index.html`. **No** worker, **no** migration, **no** DB change, **no** change to `bol-shared.js` / `bol-compose.js` / `track/index.html`.

## Bug
On a multi-load job, every BOL in the group **does** have signed copies stored (confirmed in D1: `bol_documents` rows exist for every `load_number`). But the shipment modal's Documents section only surfaces signed-copy links for the **first** BOL; the rest render "No signed copies yet."

Cause is in `loadBolDocuments()` (`logistics/index.html`, ~line 853):
- The per-BOL `GET /api/bols/:id/documents` call is wrapped in an **empty `catch (e) {}`** — any failure silently degrades to `docs = []` and the card lies.
- It reads exactly one response envelope (`dRes.data && dRes.data.data`); anything else evaluates falsy → `[]`.
- Sequential `await` inside the `for` loop, no dedupe of stale regeneration rows, and no load-number labelling — so a multi-load job's Documents section is unreadable even when it works.

Intended behavior (confirmed): **each trailer is scanned and signed separately and keeps its own signatures.** Do NOT propagate signatures across `bol_group_id`. Just display what is stored, for every load.

## Fix — replace `loadBolDocuments` wholesale

Anchor start (verified `grep -Fc` == 1):
```
async function loadBolDocuments(s) {
```
Anchor end — the replacement ends immediately before this line (verified `grep -Fc` == 1), which must remain untouched:
```
let currentBolBlobUrl = null;
```

Replace the entire existing `loadBolDocuments` function body with:

```js
async function loadBolDocuments(s) {
  const host = document.getElementById('modal-documents');
  if (!host) return;
  host.innerHTML = '';
  if (!s || !s.job_id) return;
  try {
    const { ok, data } = await api.get('/api/bols?job_id=' + encodeURIComponent(s.job_id));
    const all = (ok && data && Array.isArray(data.bols)) ? data.bols : [];
    if (!all.length) return;

    // Dedupe to the latest BOL per load_number (regenerations can leave stale rows), then
    // order by load. Mirrors the rule viewBolForJob already uses. No load_number => key 0.
    const byLoad = {};
    for (const b of all) {
      const ln = (b.load_number != null) ? Number(b.load_number) : 0;
      const prev = byLoad[ln];
      if (!prev || String(b.created_at || '') > String(prev.created_at || '')) byLoad[ln] = b;
    }
    const bols = Object.keys(byLoad).sort((a, c) => Number(a) - Number(c)).map(k => byLoad[k]);

    const labelFor = (t) => t === 'driver_signed'   ? 'Driver — signed'
                          : t === 'customer_signed' ? 'Customer — signed' : t;

    // Fetch every BOL's stored copies in parallel. Tolerate either response envelope
    // ({ data: { data: [] } } or { data: [] }); mark real failures instead of swallowing them.
    const results = await Promise.all(bols.map(async (bol) => {
      try {
        const dRes = await api.get('/api/bols/' + encodeURIComponent(bol.id) + '/documents');
        const body = dRes && dRes.data;
        const arr = Array.isArray(body) ? body
                  : (body && Array.isArray(body.data)) ? body.data
                  : null;
        if (!arr) return { bol, docs: [], failed: true };
        return { bol, docs: arr, failed: false };
      } catch (e) {
        console.error('loadBolDocuments: documents fetch failed for BOL', bol.id, e);
        return { bol, docs: [], failed: true };
      }
    }));

    const blocks = results.map(({ bol, docs, failed }) => {
      const loadLabel = (bol.load_number != null && bol.load_count != null && Number(bol.load_count) > 1)
        ? `Load ${esc(String(bol.load_number))} of ${esc(String(bol.load_count))} — `
        : '';
      const signedLinks = docs.map(d =>
        `<a href="/api/bols/documents/${esc(d.id)}" target="_blank" rel="noopener" style="font-size:13px;">📄 ${esc(labelFor(d.doc_type))}</a>`
      ).join('');
      const fallback = failed
        ? '<span style="font-size:12px;color:var(--danger,#ef4444);">Could not load signed copies</span>'
        : '<span style="font-size:12px;color:var(--muted,#4b5563);">No signed copies yet</span>';
      return `<div style="margin-bottom:8px;padding:8px;border:1px solid var(--input-border);border-radius:8px;">
          <div style="font-size:12px;color:var(--muted,#4b5563);margin-bottom:4px;">${loadLabel}BOL ${esc(bol.bol_number || bol.id)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            <a href="#" onclick="event.preventDefault();viewBolForJob('${esc(s.job_id)}')" style="font-size:13px;">📄 View BOL</a>
            ${signedLinks || fallback}
          </div>
        </div>`;
    });

    const _u = window.__xpandaUser;
    const _isMgr = _u && (_u.isAdministrator || (_u.permissions && _u.permissions['logistics.loading.manage'] && _u.permissions['logistics.loading.manage'].edit));
    const delBtn = _isMgr
      ? `<button onclick="deleteAllBolsForJob('${esc(s.job_id)}', ${all.length})" style="margin-left:auto;font-size:12px;color:var(--danger,#ef4444);background:none;border:1px solid var(--danger,#ef4444);border-radius:6px;padding:2px 8px;cursor:pointer;">Delete all BOLs</button>`
      : '';
    host.innerHTML = `<div style="display:flex;align-items:center;font-weight:600;font-size:13px;margin:4px 0 6px;">Documents${delBtn}</div>${blocks.join('')}`;
  } catch (e) {
    console.error('loadBolDocuments failed:', e);
    host.innerHTML = '';
  }
}

```

## Notes
- `deleteAllBolsForJob` still receives the **raw** count (`all.length`, pre-dedupe) — it deletes every row for the job, so the confirm count must match reality. Do not pass the deduped length.
- The per-card "View BOL" link keeps calling `viewBolForJob(job_id)` (the combined all-loads packet) — unchanged, out of scope.
- Dark-mode: tokens only (`--input-border`, `--muted`, `--danger`), matching the existing block.

## Verification gate (mandatory)
1. Confirm both anchors matched exactly once (`grep -Fc`) **before** editing.
2. `node --check` on the extracted inline script of `logistics/index.html` — **use a named temp file**; piping via `/dev/stdin` does not work.
3. Reason through: a 3-load job with signed driver+customer copies on all three renders three cards, labelled "Load 1 of 3 …", each with its own two signed links; a single-load job renders exactly as before (no load prefix).

## Docs (same commit)
- `CHANGELOG.md` → **Logistics** section, newest-first: add a **P240** entry.
- `BACKLOG.md` → nothing to remove.

## Commit
`Prompts/prompt-240-multiload-signed-bol-documents.md` committed alongside the change, on `main`.
