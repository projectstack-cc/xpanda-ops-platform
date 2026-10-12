// src/app/api/board/[id]/prints/[printId]/route.ts  →  GET/DELETE /v2/api/board/:id/prints/:printId
// board-prints-01. GET streams one print inline; DELETE removes the row, then the R2 object.
// The R2 key is only ever resolved server-side from a row matching BOTH id and job_id.
// Gated on `jobs` (view/edit) by middleware.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";

type Ctx = { params: Promise<{ id: string; printId: string }> };

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { id, printId } = await ctx.params;
  try {
    const { DB, BOL_PHOTOS } = await getEnv();
    const row = await DB.prepare(
      "SELECT filename, content_type, r2_key FROM job_prints WHERE id = ? AND job_id = ?"
    ).bind(printId, id).first<{ filename: string; content_type: string; r2_key: string }>();
    if (!row) return new Response("Not found", { status: 404 });

    const obj = await BOL_PHOTOS.get(row.r2_key);
    if (!obj) return new Response("Not found", { status: 404 });
    // Header-safe filename: printable ASCII only, no quotes/backslashes.
    const safe = row.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return new Response(obj.body as unknown as ReadableStream, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || row.content_type,
        "Content-Disposition": `inline; filename="${safe}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e: any) {
    return new Response(`Server error: ${String(e?.message || e)}`, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id, printId } = await ctx.params;
  try {
    const { DB, BOL_PHOTOS } = await getEnv();
    const userId = request.headers.get("X-User-Id") || null;
    const row = await DB.prepare(
      "SELECT filename, r2_key FROM job_prints WHERE id = ? AND job_id = ?"
    ).bind(printId, id).first<{ filename: string; r2_key: string }>();
    if (!row) return NextResponse.json({ ok: false, error: "Print not found." }, { status: 404 });

    await DB.prepare("DELETE FROM job_prints WHERE id = ? AND job_id = ?").bind(printId, id).run();
    try { await BOL_PHOTOS.delete(row.r2_key); } catch { /* best-effort; the row is already gone */ }

    await logActivity(DB, "delete", "job_print", printId, row.filename, { job_id: id, filename: row.filename }, userId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
