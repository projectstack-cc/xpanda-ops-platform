// src/app/api/production/expansion/batches/[id]/route.ts  →  /v2/api/production/expansion/batches/:id
// Row-level edit/delete for an Expansion batch. Locked to the parent session's open status;
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
      `SELECT s.status, s.deleted_at FROM production_expansion_batches b
         JOIN production_expansion_sessions s ON s.id = b.session_id
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

    if ("lot_no" in p) { sets.push("lot_no = ?"); binds.push(p.lot_no ?? null); changed.push("lot_no"); }
    if ("silo" in p) { sets.push("silo = ?"); binds.push(numOrNull(p.silo)); changed.push("silo"); }
    if ("weight_kg" in p) { sets.push("weight_kg = ?"); binds.push(numOrNull(p.weight_kg)); changed.push("weight_kg"); }
    if ("heating_time_s" in p) { sets.push("heating_time_s = ?"); binds.push(numOrNull(p.heating_time_s)); changed.push("heating_time_s"); }
    if ("bucket_weight_g" in p) { sets.push("bucket_weight_g = ?"); binds.push(numOrNull(p.bucket_weight_g)); changed.push("bucket_weight_g"); }

    if (!sets.length) return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });

    const ts = now();
    sets.push("updated_at = ?");
    binds.push(ts);

    const result = await DB.prepare(
      `UPDATE production_expansion_batches SET ${sets.join(", ")} WHERE id = ?`
    ).bind(...binds, id).run();
    if (!result.meta.changes) return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });

    await logActivity(
      DB, "update", "production_expansion_batch", id,
      `${actorName || actorId} edited an Expansion batch`,
      { batch_id: id, fields: changed }, actorId
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
      `SELECT s.status, s.deleted_at, b.session_id FROM production_expansion_batches b
         JOIN production_expansion_sessions s ON s.id = b.session_id
        WHERE b.id = ?`
    ).bind(id).first<{ status: string; deleted_at: string | null; session_id: string }>();
    if (!lock || lock.deleted_at !== null) {
      return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });
    }
    if (lock.status === "closed") {
      return NextResponse.json({ ok: false, error: "sheet_closed" }, { status: 409 });
    }

    const result = await DB.prepare(
      `DELETE FROM production_expansion_batches WHERE id = ?`
    ).bind(id).run();
    if (!result.meta.changes) return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });

    await logActivity(
      DB, "delete", "production_expansion_batch", id,
      `${actorName || actorId} deleted an Expansion batch`,
      { batch_id: id, session_id: lock.session_id }, actorId
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
