# BOL Signatures #5 — Documents Section in the Shipment Modal

> Assign a number before committing (likely **P156**). **Prompt 5 of 5** — the directory. Depends on
> #1 (list/serve endpoints) and #3/#4 (which produce the signed copies). All landed.

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent**, `logistics/index.html`
only. No backend, no migration — it consumes #1's `GET /api/bols/:id/documents` and
`GET /api/bols/documents/:docId`.

## Goal
When a shipment is opened, show a **Documents** section in the modal listing, per linked BOL: a link
to view the base BOL, and view links for each stored **signed copy** (driver/customer) served from
R2. Reuses the `#modal-actions` injection pattern (P148) and `api.get`/`esc` (already on this page).

## Scope note (unsigned driver/customer copies)
The two **signed** copies are surfaced here (the point of the feature). The **unsigned** driver/
customer render-on-demand copies are *not* added in this prompt: `bol-generator.html` only prefills
from `?job_id=` and does not auto-render a chosen copy, so a useful "Driver copy / Customer copy"
link needs a separate small `bol-generator` change (honor a `?copy=` param + auto-render). That's a
clean follow-on (#5b) if you want it — flagged, not bundled.

## File
- `logistics/index.html` — 4 edits

---

### Edit 1 — Documents container in the modal body (after `#modal-actions`)

FIND (count == 1):
```
      <div id="modal-actions" class="logistics-modal-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;"></div>
```
REPLACE:
```
      <div id="modal-actions" class="logistics-modal-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;"></div>
      <div id="modal-documents" style="margin-bottom:12px;"></div>
```

### Edit 2 — populate documents when a shipment opens

FIND (count == 1):
```
  const _mab = document.getElementById('modal-actions');
  if (_mab) _mab.innerHTML = buildActionButtons(s);
```
REPLACE:
```
  const _mab = document.getElementById('modal-actions');
  if (_mab) _mab.innerHTML = buildActionButtons(s);
  loadBolDocuments(s);
```

### Edit 3 — clear documents on the new-shipment modal

FIND (count == 1):
```
  const _mab = document.getElementById('modal-actions'); if (_mab) _mab.innerHTML = '';
```
REPLACE:
```
  const _mab = document.getElementById('modal-actions'); if (_mab) _mab.innerHTML = '';
  const _mdoc = document.getElementById('modal-documents'); if (_mdoc) _mdoc.innerHTML = '';
```

### Edit 4 — the loader (added just before `buildActionButtons`)

FIND (count == 1):
```
function buildActionButtons(shipment) {
  if (!shipment.job_id) return '';
```
REPLACE:
```
async function loadBolDocuments(s) {
  const host = document.getElementById('modal-documents');
  if (!host) return;
  host.innerHTML = '';
  if (!s || !s.job_id) return;
  try {
    const { ok, data } = await api.get('/api/bols?job_id=' + encodeURIComponent(s.job_id));
    const bols = (ok && data && Array.isArray(data.bols)) ? data.bols : [];
    if (!bols.length) return;

    const labelFor = (t) => t === 'driver_signed'   ? 'Driver — signed'
                          : t === 'customer_signed' ? 'Customer — signed' : t;
    const blocks = [];
    for (const bol of bols) {
      let docs = [];
      try {
        const dRes = await api.get('/api/bols/' + encodeURIComponent(bol.id) + '/documents');
        docs = (dRes.ok && Array.isArray(dRes.data)) ? dRes.data : [];
      } catch (e) {}
      const signedLinks = docs.map(d =>
        `<a href="/api/bols/documents/${esc(d.id)}" target="_blank" rel="noopener" style="font-size:13px;">📄 ${esc(labelFor(d.doc_type))}</a>`
      ).join('');
      blocks.push(
        `<div style="margin-bottom:8px;padding:8px;border:1px solid var(--border,#d1d5db);border-radius:8px;">
          <div style="font-size:12px;color:var(--muted,#4b5563);margin-bottom:4px;">BOL ${esc(bol.bol_number || bol.id)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            <a href="/logistics/bol-generator.html?job_id=${esc(s.job_id)}" target="_blank" rel="noopener" style="font-size:13px;">📄 View BOL</a>
            ${signedLinks || '<span style="font-size:12px;color:var(--muted,#4b5563);">No signed copies yet</span>'}
          </div>
        </div>`
      );
    }
    host.innerHTML = `<div style="font-weight:600;font-size:13px;margin:4px 0 6px;">Documents</div>${blocks.join('')}`;
  } catch (e) {
    host.innerHTML = '';
  }
}

function buildActionButtons(shipment) {
  if (!shipment.job_id) return '';
```

---

## Verify
- All FINDs `count == 1`.
- Extract the `logistics/index.html` `<script>` block to a temp `.js` and `node --check` it.
- Confirm `api.get` and `esc` are in scope on this page (they are — used elsewhere here).
- Test: open a shipment whose BOL has signed copies → Documents lists "View BOL" + the signed
  links; clicking a signed link opens the stored PDF from R2. Open a shipment with no BOL → no
  Documents section. Open "New Shipment" → section is empty.

## What NOT to change
- Do NOT load the BOL engine into this page or add `bol-generator` `?copy=` support here (that's the
  optional #5b follow-on).
- Do NOT alter `buildActionButtons`, the modal footer, the list rows, or auto-pack/`STORAGE_KEY`.
- No backend, no migration.

## Deploy
```
git add logistics/index.html
git commit -m "P###: Documents section in shipment modal — base BOL + signed driver/customer copies from R2"
git push
```
