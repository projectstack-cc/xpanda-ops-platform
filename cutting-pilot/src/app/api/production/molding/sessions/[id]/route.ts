// src/app/api/production/molding/sessions/[id]/route.ts  →  /v2/api/production/molding/sessions/:id
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  try {
    const session = await DB.prepare(
      `SELECT * FROM production_molding_sessions WHERE id = ?`
    ).bind(id).first<any>();
    if (!session) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

    const blocks = await DB.prepare(
      `SELECT * FROM production_molding_blocks WHERE session_id = ? ORDER BY created_at ASC`
    ).bind(id).all();

    return NextResponse.json({ ok: true, session, blocks: blocks.results ?? [] });
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
  if ("operator_1" in p) { sets.push("operator_1 = ?"); binds.push(p.operator_1 ?? null); }
  if ("operator_2" in p) { sets.push("operator_2 = ?"); binds.push(p.operator_2 ?? null); }

  if (!sets.length) return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });
  sets.push("updated_at = ?");
  binds.push(now());

  try {
    const result = await DB.prepare(
      `UPDATE production_molding_sessions SET ${sets.join(", ")} WHERE id = ?`
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
