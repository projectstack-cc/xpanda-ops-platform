// src/app/api/production/molding/blocks/route.ts  →  POST /v2/api/production/molding/blocks
// Appends one block row to an open (or any existing) Molding session.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

function numOrNull(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  const operatorId = request.headers.get("X-User-Id") || "";
  if (!operatorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const {
    session_id, block_no, block_type, block_size,
    rc_pct_open, rc_speed, virgin_pct_open, virgin_speed,
    mold_time, block_weight_lbs, init_oper,
  } = body ?? {};

  if (!session_id) return NextResponse.json({ ok: false, error: "session_id is required." }, { status: 400 });

  try {
    const session = await DB.prepare(
      `SELECT id FROM production_molding_sessions WHERE id = ?`
    ).bind(session_id).first<{ id: string }>();
    if (!session) return NextResponse.json({ ok: false, error: "Session not found." }, { status: 404 });

    const id = crypto.randomUUID();
    const ts = now();

    await DB.prepare(
      `INSERT INTO production_molding_blocks
         (id, session_id, block_no, block_type, block_size, rc_pct_open, rc_speed,
          virgin_pct_open, virgin_speed, mold_time, block_weight_lbs, init_oper, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, session_id,
      block_no ?? null, block_type ?? null, block_size ?? null,
      numOrNull(rc_pct_open), numOrNull(rc_speed),
      numOrNull(virgin_pct_open), numOrNull(virgin_speed),
      mold_time ?? null, numOrNull(block_weight_lbs), init_oper ?? null,
      ts
    ).run();

    return NextResponse.json({ ok: true, block_id: id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
