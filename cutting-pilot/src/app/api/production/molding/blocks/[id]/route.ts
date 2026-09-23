// src/app/api/production/molding/blocks/[id]/route.ts  →  /v2/api/production/molding/blocks/:id
// Row-level edit/delete for a Molding block. Locked to the parent session's open status;
// blocked entirely if the parent sheet is soft-deleted. Operator is not editable.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

function numOrNull(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
    const lock = await DB.prepare(
      `SELECT s.status, s.deleted_at FROM production_molding_blocks b
         JOIN production_molding_sessions s ON s.id = b.session_id
        WHERE b.id = ?`
    ).bind(id).first<{ status: string; deleted_at: string | null }>();
    if (!lock || lock.deleted_at !== null) {
      return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });
    }
    if (lock.status === "closed") {
      return NextResponse.json({ ok: false, error: "sheet_closed" }, { status: 409 });
    }

    const sets: string[] = [];
    const binds: any[] = [];
    const changed: string[] = [];

    if ("block_no" in p) { sets.push("block_no = ?"); binds.push(p.block_no ?? null); changed.push("block_no"); }
    if ("block_size" in p) { sets.push("block_size = ?"); binds.push(p.block_size ?? null); changed.push("block_size"); }
    if ("silo" in p) { sets.push("silo = ?"); binds.push(numOrNull(p.silo)); changed.push("silo"); }
    if ("lot_no" in p) { sets.push("lot_no = ?"); binds.push(p.lot_no ?? null); changed.push("lot_no"); }
    if ("rc_pct_open" in p) { sets.push("rc_pct_open = ?"); binds.push(numOrNull(p.rc_pct_open)); changed.push("rc_pct_open"); }
    if ("rc_speed" in p) { sets.push("rc_speed = ?"); binds.push(numOrNull(p.rc_speed)); changed.push("rc_speed"); }
    if ("virgin_pct_open" in p) { sets.push("virgin_pct_open = ?"); binds.push(numOrNull(p.virgin_pct_open)); changed.push("virgin_pct_open"); }
    if ("virgin_speed" in p) { sets.push("virgin_speed = ?"); binds.push(numOrNull(p.virgin_speed)); changed.push("virgin_speed"); }
    if ("block_weight_lbs" in p) { sets.push("block_weight_lbs = ?"); binds.push(numOrNull(p.block_weight_lbs)); changed.push("block_weight_lbs"); }
    if ("mold_time" in p) { sets.push("mold_time = ?"); binds.push(p.mold_time ?? null); changed.push("mold_time"); }

    if (!sets.length) return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });

    const ts = now();
    sets.push("updated_at = ?");
    binds.push(ts);

    const result = await DB.prepare(
      `UPDATE production_molding_blocks SET ${sets.join(", ")} WHERE id = ?`
    ).bind(...binds, id).run();
    if (!result.meta.changes) return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });

    await logActivity(
      DB, "update", "production_molding_block", id,
      `${actorName || actorId} edited a Molding block`,
      { block_id: id, fields: changed }, actorId
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const lock = await DB.prepare(
      `SELECT s.status, s.deleted_at, b.session_id FROM production_molding_blocks b
         JOIN production_molding_sessions s ON s.id = b.session_id
        WHERE b.id = ?`
    ).bind(id).first<{ status: string; deleted_at: string | null; session_id: string }>();
    if (!lock || lock.deleted_at !== null) {
      return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });
    }
    if (lock.status === "closed") {
      return NextResponse.json({ ok: false, error: "sheet_closed" }, { status: 409 });
    }

    const result = await DB.prepare(
      `DELETE FROM production_molding_blocks WHERE id = ?`
    ).bind(id).run();
    if (!result.meta.changes) return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });

    await logActivity(
      DB, "delete", "production_molding_block", id,
      `${actorName || actorId} deleted a Molding block`,
      { block_id: id, session_id: lock.session_id }, actorId
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
