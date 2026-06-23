# FIX — Signed BOL copies never display (array read one level too shallow)

> Assign a number before committing. The signed copies upload and store fine; the Documents section
> just reads the response wrong. Reflects HEAD `49683d3`.

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent** —
`logistics/index.html` only. No worker, no migration.

## Root cause
`api.get` returns `{ ok, data: <parsed response body> }`. The worker's two endpoints use different
top-level keys:
- `GET /api/bols?job_id=…` → body `{ ok, bols: [...] }` → array at `res.data.bols` ✅ (read correctly)
- `GET /api/bols/:id/documents` → body `{ ok, data: [...] }` → array at `res.data.data`

`loadBolDocuments` checks `Array.isArray(dRes.data)`, but `dRes.data` is the **body object**
(`{ ok, data: [...] }`), never an array — so `docs` is always `[]` and every BOL shows
"No signed copies yet," even though the `bol_documents` rows exist.

## Fix

### Edit 1 — `logistics/index.html`: read the array at the right level

FIND (count == 1):
```
        const dRes = await api.get('/api/bols/' + encodeURIComponent(bol.id) + '/documents');
        docs = (dRes.ok && Array.isArray(dRes.data)) ? dRes.data : [];
```
REPLACE:
```
        const dRes = await api.get('/api/bols/' + encodeURIComponent(bol.id) + '/documents');
        const dArr = dRes.data && dRes.data.data;
        docs = (dRes.ok && Array.isArray(dArr)) ? dArr : [];
```

---

## Verify
- FIND `count == 1`. Extract the `logistics/index.html` script to a temp `.js` and `node --check`.
- Open the shipment you delivered (the one whose bol has rows, e.g. `728609f2-…`): the Documents
  section now lists "Driver — signed" and "Customer — signed" links; clicking each opens the stored
  PDF from `/api/bols/documents/:id`.
- A shipment with no signed copies still shows "No signed copies yet".

## What NOT to change
- Do NOT change the worker, the `/documents` response shape, or `api.get`.
- The `bols` list read (`data.bols`) is already correct — leave it.

## Deploy
```
git add logistics/index.html
git commit -m "P###: fix signed BOL copies not displaying — read /documents array at res.data.data"
git push
```
