// src/app/api/production/expansion/sessions/[id]/route.ts  →  /v2/api/production/expansion/sessions/:id
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

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
      `SELECT * FROM production_expansion_sessions WHERE id = ?`
    ).bind(id).first<any>();
    if (!session) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

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
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let p: any;
  try {
    p = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const sets: string[] = [];
  const binds: any[] = [];

  if ("status" in p) {
    if (p.status !== "open" && p.status !== "closed") {
      return NextResponse.json({ ok: false, error: "Invalid status." }, { status: 400 });
    }
    sets.push("status = ?");
    binds.push(p.status);
  }
  if ("silo" in p) {
    const n = p.silo === "" || p.silo === null ? null : Number(p.silo);
    sets.push("silo = ?");
    binds.push(Number.isFinite(n as number) ? n : null);
  }
  if ("log_date" in p) { sets.push("log_date = ?"); binds.push(p.log_date ?? null); }
  if ("control_no" in p) { sets.push("control_no = ?"); binds.push(p.control_no ?? null); }
  if ("start_time" in p) { sets.push("start_time = ?"); binds.push(p.start_time ?? null); }
  if ("finish_time" in p) { sets.push("finish_time = ?"); binds.push(p.finish_time ?? null); }
  if ("density" in p) { sets.push("density = ?"); binds.push(numOrNull(p.density)); }
  if ("target_weight_g" in p) { sets.push("target_weight_g = ?"); binds.push(numOrNull(p.target_weight_g)); }
  if ("bead_type" in p) { sets.push("bead_type = ?"); binds.push(p.bead_type ?? null); }
  if ("lot" in p) { sets.push("lot = ?"); binds.push(p.lot ?? null); }
  if ("operator_1" in p) { sets.push("operator_1 = ?"); binds.push(p.operator_1 ?? null); }
  if ("operator_2" in p) { sets.push("operator_2 = ?"); binds.push(p.operator_2 ?? null); }

  if (!sets.length) return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });
  sets.push("updated_at = ?");
  binds.push(now());

  try {
    const result = await DB.prepare(
      `UPDATE production_expansion_sessions SET ${sets.join(", ")} WHERE id = ?`
    ).bind(...binds, id).run();
    if (!result.meta.changes) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
