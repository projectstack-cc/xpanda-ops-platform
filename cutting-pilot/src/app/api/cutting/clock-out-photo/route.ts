// POST /v2/api/cutting/clock-out-photo  — store a cut-list photo for an open session in R2.
// Optional, best-effort. Operator (from session headers) must own the session.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export async function POST(request: NextRequest) {
  const { DB, BOL_PHOTOS } = await getEnv();
  try {
    const operatorId = request.headers.get("X-User-Id") || "";
    const isAdmin = request.headers.get("X-User-Is-Admin") === "1";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const form = await request.formData();
    const sessionId = String(form.get("session_id") || "");
    const file = form.get("file");
    if (!sessionId || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "session_id and file are required." },
        { status: 400 }
      );
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ ok: false, error: "File must be an image." }, { status: 400 });
    }

    const session = await DB.prepare(
      `SELECT id, operator_id, status FROM cutting_sessions WHERE id = ? LIMIT 1`
    ).bind(sessionId).first<{ id: string; operator_id: string; status: string }>();

    if (!session) {
      return NextResponse.json({ ok: false, error: "Session not found." }, { status: 404 });
    }
    if (session.operator_id !== operatorId && !isAdmin) {
      return NextResponse.json({ ok: false, error: "Access denied." }, { status: 403 });
    }

    const ext = EXT[file.type] || "jpg";
    const key = `cutting-photos/${sessionId}/${crypto.randomUUID()}.${ext}`;
    const bytes = await file.arrayBuffer();

    await BOL_PHOTOS.put(key, bytes, { httpMetadata: { contentType: file.type } });

    await DB.prepare(`UPDATE cutting_sessions SET photo_key = ? WHERE id = ?`)
      .bind(key, sessionId)
      .run();

    return NextResponse.json({ ok: true, photo_key: key });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
