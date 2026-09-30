// src/app/api/shipments/signed-bol/file/route.ts  ->  GET /v2/api/shipments/signed-bol/file?doc_id=<id>
//                                                    | GET /v2/api/shipments/signed-bol/file?photo_bol_id=<id>
// lgx-signed-01. Streams one signed artifact from BOL_PHOTOS R2. Keys are ONLY ever resolved server-side
// through these two lookups (bol_documents.r2_key / bols.signed_bol_photo_key) — never accepted from the
// client. Same streaming pattern as api/carrier/carrier-copy/route.ts. Gate inherited from middleware's
// /v2/api/shipments -> logistics.dashboard rule.
import { getEnv } from "@/lib/db";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const docId = (params.get("doc_id") || "").trim();
  const photoBolId = (params.get("photo_bol_id") || "").trim();
  if ((docId && photoBolId) || (!docId && !photoBolId)) {
    return new Response("Provide exactly one of doc_id or photo_bol_id.", { status: 400 });
  }

  try {
    const { DB, BOL_PHOTOS } = await getEnv();
    const row = docId
      ? await DB.prepare("SELECT r2_key FROM bol_documents WHERE id = ?").bind(docId).first<{ r2_key: string | null }>()
      : await DB.prepare("SELECT signed_bol_photo_key AS r2_key FROM bols WHERE id = ?").bind(photoBolId).first<{ r2_key: string | null }>();
    if (!row?.r2_key) return new Response("Not found", { status: 404 });

    const obj = await BOL_PHOTOS.get(row.r2_key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body as unknown as ReadableStream, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || (docId ? "application/pdf" : "image/jpeg"),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e: any) {
    return new Response(`Server error: ${String(e?.message || e)}`, { status: 500 });
  }
}
