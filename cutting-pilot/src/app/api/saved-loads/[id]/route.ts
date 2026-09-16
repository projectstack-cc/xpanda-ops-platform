// src/app/api/saved-loads/[id]/route.ts  ->  GET /v2/api/saved-loads/:id (live) |
// PUT /v2/api/saved-loads/:id (fenced) | DELETE /v2/api/saved-loads/:id (fenced)
// lb-ui-04. Same shared `saved_loads` table as ../route.ts -- see that file's header for why no
// migration was needed and why GET runs live/unfenced (read-only) while writes are fenced.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { V2_LOGISTICS_WRITES_ENABLED } from "@/lib/logistics/writeFence";
import { logActivity } from "@/lib/activityLog";

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: loadId } = await ctx.params;
  const { DB } = await getEnv();

  try {
    const row = await DB.prepare("SELECT * FROM saved_loads WHERE id = ?").bind(loadId).first();
    if (!row) return NextResponse.json({ ok: false, error: "Saved load not found." }, { status: 404 });
    return NextResponse.json({ ok: true, load: row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!V2_LOGISTICS_WRITES_ENABLED) {
    return NextResponse.json(
      { ok: false, error: "v2 logistics writes disabled (read-only migration phase)" },
      { status: 501 }
    );
  }

  const { id: loadId } = await ctx.params;
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof payload.state_json !== "string" || !payload.state_json.trim()) {
    return NextResponse.json({ ok: false, error: "state_json is required." }, { status: 400 });
  }

  const existing = await DB.prepare("SELECT id FROM saved_loads WHERE id = ?").bind(loadId).first();
  if (!existing) return NextResponse.json({ ok: false, error: "Saved load not found." }, { status: 404 });

  const now = new Date().toISOString();
  const expires_at = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  try {
    await DB.prepare(
      `UPDATE saved_loads SET
         name = ?, job_id = ?, customer = ?, trailer_type = ?,
         state_json = ?, updated_at = ?, expires_at = ?
       WHERE id = ?`
    )
      .bind(
        String(payload.name || "").trim(),
        payload.job_id ? String(payload.job_id).trim() : null,
        String(payload.customer || "").trim(),
        String(payload.trailer_type || "").trim(),
        payload.state_json,
        now,
        expires_at,
        loadId
      )
      .run();

    await logActivity(
      DB,
      "update",
      "saved_load",
      loadId,
      `Updated saved load "${payload.name || loadId}"`,
      { name: payload.name, customer: payload.customer, trailer_type: payload.trailer_type },
      actorId
    );

    const row = await DB.prepare("SELECT * FROM saved_loads WHERE id = ?").bind(loadId).first();
    return NextResponse.json({ ok: true, load: row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!V2_LOGISTICS_WRITES_ENABLED) {
    return NextResponse.json(
      { ok: false, error: "v2 logistics writes disabled (read-only migration phase)" },
      { status: 501 }
    );
  }

  const { id: loadId } = await ctx.params;
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const existing = await DB.prepare("SELECT id, name, customer FROM saved_loads WHERE id = ?").bind(loadId).first<any>();
  if (!existing) return NextResponse.json({ ok: false, error: "Saved load not found." }, { status: 404 });

  try {
    await DB.prepare("DELETE FROM saved_loads WHERE id = ?").bind(loadId).run();
    await logActivity(
      DB,
      "delete",
      "saved_load",
      loadId,
      `Deleted saved load "${existing.name || loadId}" for ${existing.customer || ""}`,
      { name: existing.name, customer: existing.customer },
      actorId
    );
    return NextResponse.json({ ok: true, message: "Saved load deleted." });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
