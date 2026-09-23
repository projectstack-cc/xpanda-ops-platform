// src/app/api/production/expansion/sessions/[id]/route.ts  →  /v2/api/production/expansion/sessions/:id
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

function numOrNull(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  try {
    const session = await DB.prepare(
      `SELECT * FROM production_expansion_sessions WHERE id = ? AND deleted_at IS NULL`
    ).bind(id).first<any>();
    if (!session) return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });

    const batches = await DB.prepare(
      `SELECT * FROM production_expansion_batches WHERE session_id = ? ORDER BY created_at ASC`
    ).bind(id).all();

    return NextResponse.json({ ok: true, session, batches: batches.results ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let p: any;
  try {
    p = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const existing = await DB.prepare(
      `SELECT bead_supplier, bead_type FROM production_expansion_sessions WHERE id = ? AND deleted_at IS NULL`
    ).bind(id).first<{ bead_supplier: string | null; bead_type: string | null }>();
    if (!existing) return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });

    const sets: string[] = [];
    const binds: any[] = [];
    const changed: string[] = [];

    if ("bead_supplier" in p || "bead_type" in p) {
      const supplier = "bead_supplier" in p ? p.bead_supplier : existing.bead_supplier;
      const type = "bead_type" in p ? p.bead_type : existing.bead_type;
      if (!supplier || !type) {
        return NextResponse.json({ ok: false, error: "unknown_bead_type" }, { status: 400 });
      }
      const supplierOption = await DB.prepare(
        `SELECT id FROM production_options WHERE kind = 'bead_supplier' AND value = ? AND active = 1`
      ).bind(supplier).first<{ id: string }>();
      const typeOption = await DB.prepare(
        `SELECT id FROM production_options WHERE kind = 'bead_type' AND grp = ? AND value = ? AND active = 1`
      ).bind(supplier, type).first<{ id: string }>();
      if (!supplierOption || !typeOption) {
        return NextResponse.json({ ok: false, error: "unknown_bead_type" }, { status: 400 });
      }
      if ("bead_supplier" in p) { sets.push("bead_supplier = ?"); binds.push(supplier); changed.push("bead_supplier"); }
      if ("bead_type" in p) { sets.push("bead_type = ?"); binds.push(type); changed.push("bead_type"); }
    }

    if ("status" in p) {
      if (p.status !== "open" && p.status !== "closed") {
        return NextResponse.json({ ok: false, error: "Invalid status." }, { status: 400 });
      }
      sets.push("status = ?");
      binds.push(p.status);
      changed.push("status");
    }
    if ("start_time" in p) { sets.push("start_time = ?"); binds.push(p.start_time ?? null); changed.push("start_time"); }
    if ("finish_time" in p) { sets.push("finish_time = ?"); binds.push(p.finish_time ?? null); changed.push("finish_time"); }
    if ("density" in p) { sets.push("density = ?"); binds.push(numOrNull(p.density)); changed.push("density"); }
    if ("target_weight_g" in p) { sets.push("target_weight_g = ?"); binds.push(numOrNull(p.target_weight_g)); changed.push("target_weight_g"); }

    if (!sets.length) return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });
    sets.push("updated_at = ?");
    binds.push(now());

    const result = await DB.prepare(
      `UPDATE production_expansion_sessions SET ${sets.join(", ")} WHERE id = ?`
    ).bind(...binds, id).run();
    if (!result.meta.changes) return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });

    await logActivity(
      DB, "update", "production_expansion_session", id,
      `${actorName || actorId} edited an Expansion sheet`,
      { session_id: id, fields: changed }, actorId
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
