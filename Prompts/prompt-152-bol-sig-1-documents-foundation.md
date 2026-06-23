# BOL Signatures #1 — `bol_documents` Foundation + Storage Endpoints

> Assign a prompt number before committing (next is likely **P152**). This is **prompt 1 of 5** in
> the in-house BOL signature feature. It is fully unblocked — does **not** need the new templates.

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **db-api-agent** — migration +
`_worker.js` endpoints only. No frontend, no rendering changes.

## Goal
Stand up storage for signed BOL copies so later prompts can write/list/serve them:
- New `bol_documents` table — one row per stored signed PDF.
- **Public, token-scoped** store endpoint (the driver/customer sign on the public `track/` page, no session).
- **Authed** list + serve endpoints (the dashboard's Documents section, behind the session gate).

Unsigned driver/customer copies are render-on-demand (later prompts) and are **not** stored here —
only signed copies are. Signed copies live in the existing `BOL_PHOTOS` R2 bucket under
`signed-bols/<bolId>/`. This does **not** touch the existing delivery-photo flow (`signed_bol_photo_key`).

## Files
- `DB_Migrations/add-bol-documents.sql` — new migration (**run in D1 console before deploying the worker**)
- `_worker.js/routes/public.js` — new public store handler
- `_worker.js/routes/bols.js` — list + serve matches
- `_worker.js/index.js` — import + route registration

---

### File 1 — `DB_Migrations/add-bol-documents.sql` (new)

```sql
-- Signed BOL copies (driver / customer). One row per stored PDF in R2.
CREATE TABLE IF NOT EXISTS bol_documents (
  id         TEXT PRIMARY KEY,
  bol_id     TEXT NOT NULL,
  doc_type   TEXT NOT NULL,   -- 'driver_signed' | 'customer_signed'
  r2_key     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bol_documents_bol_id ON bol_documents(bol_id);
```

> **Deploy ordering:** Steve runs this in the Cloudflare D1 Dashboard Console **before** the worker
> deploy. Claude Code does not execute migrations.

### File 2 — `_worker.js/routes/public.js` : public token-scoped store handler

Add this **before** the existing delivery handler. FIND (count == 1):
```
export async function handleApiPublicBolDelivery(request, env) {
```

REPLACE:
```
export async function handleApiPublicBolDocument(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);
  const url = new URL(request.url);
  const token = url.pathname.replace('/api/public/bol-document/', '').replace(/\/$/, '');
  if (!token || token.length < 8) return json({ ok: false, error: 'Invalid token' }, 400);

  let payload;
  try { payload = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const docType = String(payload.doc_type || '');
  if (!['driver_signed', 'customer_signed'].includes(docType)) {
    return json({ ok: false, error: 'doc_type must be driver_signed|customer_signed' }, 400);
  }
  const pdfBase64 = String(payload.pdf_base64 || '');
  if (!pdfBase64 || pdfBase64.length < 100) {
    return json({ ok: false, error: 'pdf_base64 is required' }, 400);
  }
  if (pdfBase64.length > 8 * 1024 * 1024) {
    return json({ ok: false, error: 'Document too large.' }, 413);
  }

  const db = env.DB;
  const bol = await db.prepare("SELECT id FROM bols WHERE access_token = ?").bind(token).first();
  if (!bol) return json({ ok: false, error: 'expired_or_invalid' }, 404);

  const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
  const r2Key = `signed-bols/${bol.id}/${docType}-${Date.now()}.pdf`;
  try {
    await env.BOL_PHOTOS.put(r2Key, pdfBytes, { httpMetadata: { contentType: 'application/pdf' } });
  } catch (e) {
    return json({ ok: false, error: 'upload_failed', detail: String(e?.message || e) }, 500);
  }

  const docId  = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  await db.prepare(
    "INSERT INTO bol_documents (id, bol_id, doc_type, r2_key, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(docId, bol.id, docType, r2Key, nowIso).run();

  return json({ ok: true, data: { id: docId, doc_type: docType } });
}

export async function handleApiPublicBolDelivery(request, env) {
```

### File 3 — `_worker.js/routes/bols.js` : list + serve matches

Add right after the existing signed-photo serve block. FIND (count == 1):
```
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=300',
      },
    });
  }
```

REPLACE:
```
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=300',
      },
    });
  }

  // ── GET /api/bols/documents/:docId — serve a stored signed copy from R2 ────
  const docServeMatch = url.pathname.match(/^\/api\/bols\/documents\/([^/]+)$/);
  if (docServeMatch && request.method === 'GET') {
    const dRow = await env.DB.prepare("SELECT r2_key FROM bol_documents WHERE id = ?").bind(docServeMatch[1]).first();
    if (!dRow?.r2_key) return new Response('Not found', { status: 404 });
    const dObj = await env.BOL_PHOTOS.get(dRow.r2_key);
    if (!dObj) return new Response('Not found', { status: 404 });
    return new Response(dObj.body, {
      headers: {
        'Content-Type': dObj.httpMetadata?.contentType || 'application/pdf',
        'Cache-Control': 'private, max-age=300',
      },
    });
  }

  // ── GET /api/bols/:id/documents — list stored signed copies ───────────────
  const docsListMatch = url.pathname.match(/^\/api\/bols\/([^/]+)\/documents$/);
  if (docsListMatch && request.method === 'GET') {
    const dRows = await env.DB.prepare(
      "SELECT id, bol_id, doc_type, created_at FROM bol_documents WHERE bol_id = ? ORDER BY created_at DESC"
    ).bind(docsListMatch[1]).all();
    return json({ ok: true, data: dRows.results || [] });
  }
```

### File 4 — `_worker.js/index.js` : import + route

Edit 4a — import. FIND (count == 1):
```
import { handleApiPublicBolLookup, handleApiPublicBolPickup, handleApiPublicBolDelivery } from './routes/public.js';
```
REPLACE:
```
import { handleApiPublicBolLookup, handleApiPublicBolPickup, handleApiPublicBolDelivery, handleApiPublicBolDocument } from './routes/public.js';
```

Edit 4b — route row. FIND (count == 1):
```
  { prefix: '/api/public/bol-delivery', handler: (req, env) => handleApiPublicBolDelivery(req, env) },
```
REPLACE:
```
  { prefix: '/api/public/bol-delivery', handler: (req, env) => handleApiPublicBolDelivery(req, env) },
  { prefix: '/api/public/bol-document', handler: (req, env) => handleApiPublicBolDocument(req, env) },
```

---

## Verify
- All FINDs `count == 1`.
- `for f in index public bols; do cp _worker.js/routes/$f.js /tmp/$f.mjs 2>/dev/null; done; cp _worker.js/index.js /tmp/wi.mjs && node --check /tmp/wi.mjs && node --check /tmp/public.mjs && node --check /tmp/bols.mjs`
- Confirm `json` is in scope in `public.js` (it is — used throughout) and in `bols.js`.
- The two `/api/bols/...documents` regexes are non-overlapping (serve = `/documents/:id`, list = `/:id/documents`); serve is checked first as a guard. Confirm both are inside `handleApiBols` where `url`/`request`/`env` are in scope.

## What NOT to change
- Do NOT touch the existing delivery-photo flow or `signed_bol_photo_key`.
- Do NOT add rendering, templates, or signature UI (those are prompts #2–#5).
- Do NOT touch auto-pack, `STORAGE_KEY`, `bol-shared.js`, or `bol-compose.js`.

## Deploy
1. Run `DB_Migrations/add-bol-documents.sql` in the D1 console.
2. Then:
```
git add DB_Migrations/add-bol-documents.sql _worker.js/routes/public.js _worker.js/routes/bols.js _worker.js/index.js
git commit -m "P###: bol_documents table + public store / authed list+serve endpoints for signed BOL copies"
git push
```
