// GET /v2/api/cutting/photo/[sessionId]  — stream the session's cut-list photo from R2.
// Gated by middleware (manufacturing.cutting). 404 when the session has no photo.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  const { DB, BOL_PHOTOS } = await getEnv();
  try {
    const { sessionId } = params;
    const row = await DB.prepare(
      `SELECT photo_key FROM cutting_sessions WHERE id = ? LIMIT 1`
    ).bind(sessionId).first<{ photo_key: string | null }>();

    if (!row?.photo_key) {
      return NextResponse.json({ ok: false, error: "No photo." }, { status: 404 });
    }

    const object = await BOL_PHOTOS.get(row.photo_key);
    if (!object) {
      return NextResponse.json({ ok: false, error: "Photo missing." }, { status: 404 });
    }

    const contentType = object.httpMetadata?.contentType || "image/jpeg";
    return new Response(object.body as any, {
      headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
