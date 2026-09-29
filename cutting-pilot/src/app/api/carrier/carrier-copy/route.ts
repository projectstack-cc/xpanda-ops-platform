// src/app/api/carrier/carrier-copy/route.ts  →  GET /v2/api/carrier/carrier-copy?token=…
// Streams the carrier's newest uploaded physical BOL copy (bol_documents doc_type='carrier_upload',
// written by legacy /api/public/bol-delivery since carrier-02) from R2. Carrier-scoped via
// resolveCarrierBol. The driver-signed QR copy stays at /api/public/bol-signed/<token>.
import { getEnv } from "@/lib/db";
import { resolveCarrierBol } from "@/lib/carrier/scope";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  try {
    const { DB, BOL_PHOTOS } = await getEnv();
    const bol = await resolveCarrierBol(DB, token);
    if (!bol) return new Response("Not found", { status: 404 });

    const doc = await DB.prepare(
      "SELECT r2_key FROM bol_documents WHERE bol_id = ? AND doc_type = 'carrier_upload' ORDER BY created_at DESC LIMIT 1"
    )
      .bind(bol.id)
      .first<{ r2_key: string }>();
    if (!doc?.r2_key) return new Response("Not found", { status: 404 });

    const obj = await BOL_PHOTOS.get(doc.r2_key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body as unknown as ReadableStream, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e: any) {
    return new Response(`Server error: ${String(e?.message || e)}`, { status: 500 });
  }
}
