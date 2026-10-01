// src/app/api/shipments/[id]/loading-photo/[photoId]/route.ts  ->  GET /v2/api/shipments/:id/loading-photo/:photoId
// lgx-photos-01: serves a loading-dock photo for ShipmentDetailPanel's per-load thumbnails. Lives under
// the /v2/api/shipments prefix so it inherits logistics.dashboard (the existing
// /v2/api/loading-photos/* routes are gated on logistics.loading) -- same pattern as lgx-signed-01 /
// lgx-slip-01. The JOIN on shipments is the ownership check: a photo id is only served via the
// shipment whose job it belongs to.
// Byte-serving logic mirrors src/app/api/loading-photos/[id]/image/route.ts exactly (R2 photo_key
// first, legacy base64-in-D1 fallback) -- keep the two in sync.
import { type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const { DB, BOL_PHOTOS } = await getEnv();
  const { id, photoId } = await params;

  try {
    const row = await DB.prepare(
      "SELECT lp.photo_key, lp.photo_data FROM loading_photos lp JOIN shipments s ON s.job_id = lp.job_id WHERE s.id = ? AND lp.id = ?"
    )
      .bind(id, photoId)
      .first<{ photo_key: string | null; photo_data: string | null }>();
    if (!row) return new Response("Not found", { status: 404 });

    if (row.photo_key) {
      const obj = await BOL_PHOTOS.get(row.photo_key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body as any, {
        headers: {
          "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    if (row.photo_data && row.photo_data.length > 10) {
      const mime = row.photo_data.startsWith("iVBOR") ? "image/png" : "image/jpeg";
      const bytes = Uint8Array.from(atob(row.photo_data), (c) => c.charCodeAt(0));
      return new Response(bytes, {
        headers: { "Content-Type": mime, "Cache-Control": "private, max-age=300" },
      });
    }

    return new Response("Not found", { status: 404 });
  } catch {
    return new Response("Server error", { status: 500 });
  }
}
