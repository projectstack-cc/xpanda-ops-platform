// src/app/api/production/expansion/batches/[id]/route.ts  →  /v2/api/production/expansion/batches/:id
// Row-level edit/delete for an Expansion batch. Locked to the parent session's open status.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

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
      `SELECT s.status FROM production_expansion_batches b
         JOIN production_expansion_sessions s ON s.id = b.session_id
        WHERE b.id = ?`
    ).bind(id).first<{ status: string }>();
    if (!lock) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    if (lock.status === "closed") {
      return NextResponse.json({ ok: false, error: "sheet_closed" }, { status: 409 });
    }

    const sets: string[] = [];
    const binds: any[] = [];
    const changed: string[] = [];

    if ("batch_no" in p) { sets.push("batch_no = ?"); binds.push(p.batch_no ?? null); changed.push("batch_no"); }
    if ("weight_kg" in p) { sets.push("weight_kg = ?"); binds.push(numOrNull(p.weight_kg)); changed.push("weight_kg"); }
    if ("heating_time_s" in p) { sets.push("heating_time_s = ?"); binds.push(numOrNull(p.heating_time_s)); changed.push("heating_time_s"); }
    if ("bucket_weight_g" in p) { sets.push("bucket_weight_g = ?"); binds.push(numOrNull(p.bucket_weight_g)); changed.push("bucket_weight_g"); }

    if (!sets.length) return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });

    const ts = now();
    const result = await DB.prepare(
      `UPDATE production_expansion_batches SET ${sets.join(", ")} WHERE id = ?`
    ).bind(...binds, id).run();
    if (!result.meta.changes) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

    try {
      await DB.prepare(
        `INSERT INTO activity_log
           (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
         VALUES (?, ?, 'update', 'production_expansion_batch', ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        ts,
        id,
        `${actorName || actorId} edited an Expansion batch`,
        JSON.stringify({ batch_id: id, fields: changed }),
        actorId,
        ts
      ).run();
    } catch (e: any) {
      console.error("activity_log failed:", String(e?.message || e));
    }

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
      `SELECT s.status, b.session_id FROM production_expansion_batches b
         JOIN production_expansion_sessions s ON s.id = b.session_id
        WHERE b.id = ?`
    ).bind(id).first<{ status: string; session_id: string }>();
    if (!lock) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    if (lock.status === "closed") {
      return NextResponse.json({ ok: false, error: "sheet_closed" }, { status: 409 });
    }

    const result = await DB.prepare(
      `DELETE FROM production_expansion_batches WHERE id = ?`
    ).bind(id).run();
    if (!result.meta.changes) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

    const ts = now();
    try {
      await DB.prepare(
        `INSERT INTO activity_log
           (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
         VALUES (?, ?, 'delete', 'production_expansion_batch', ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        ts,
        id,
        `${actorName || actorId} deleted an Expansion batch`,
        JSON.stringify({ batch_id: id, session_id: lock.session_id }),
        actorId,
        ts
      ).run();
    } catch (e: any) {
      console.error("activity_log failed:", String(e?.message || e));
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
