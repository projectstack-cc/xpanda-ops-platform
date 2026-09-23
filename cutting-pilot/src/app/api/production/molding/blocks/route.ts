// src/app/api/production/molding/blocks/route.ts  →  POST /v2/api/production/molding/blocks
// Appends one block row to a Molding session. block_no/mold_time auto-compute when blank.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { nextBlockNo, etClockLabel } from "@/lib/productionNumbering";

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

function numOrNull(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  const operatorId = request.headers.get("X-User-Id") || "";
  const operatorName = request.headers.get("X-User-Name") || "";
  if (!operatorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const {
    session_id, block_no, block_size, silo, lot_no,
    rc_pct_open, rc_speed, virgin_pct_open, virgin_speed,
    mold_time, block_weight_lbs,
  } = body ?? {};

  if (!session_id) return NextResponse.json({ ok: false, error: "session_id is required." }, { status: 400 });
  if (block_weight_lbs === undefined || block_weight_lbs === null || block_weight_lbs === "") {
    return NextResponse.json({ ok: false, error: "weight_required" }, { status: 400 });
  }

  try {
    const session = await DB.prepare(
      `SELECT id, status FROM production_molding_sessions WHERE id = ? AND deleted_at IS NULL`
    ).bind(session_id).first<{ id: string; status: string }>();
    if (!session) return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });
    if (session.status === "closed") {
      return NextResponse.json({ ok: false, error: "sheet_closed" }, { status: 409 });
    }

    if (block_size) {
      const option = await DB.prepare(
        `SELECT id FROM production_options WHERE kind = 'block_size' AND value = ? AND active = 1`
      ).bind(block_size).first<{ id: string }>();
      if (!option) return NextResponse.json({ ok: false, error: "unknown_block_size" }, { status: 400 });
    }

    let finalBlockNo = typeof block_no === "string" ? block_no.trim() : "";
    if (!finalBlockNo) {
      const existing = await DB.prepare(
        `SELECT block_no FROM production_molding_blocks WHERE session_id = ?`
      ).bind(session_id).all<{ block_no: string | null }>();
      finalBlockNo = nextBlockNo((existing.results ?? []).map((r) => r.block_no));
    }

    const finalMoldTime = typeof mold_time === "string" && mold_time.trim() ? mold_time.trim() : etClockLabel();

    const siloNum = numOrNull(silo);
    const id = crypto.randomUUID();
    const ts = now();

    await DB.prepare(
      `INSERT INTO production_molding_blocks
         (id, session_id, block_no, block_size, silo, lot_no, rc_pct_open, rc_speed,
          virgin_pct_open, virgin_speed, mold_time, block_weight_lbs, operator_id, operator_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, session_id,
      finalBlockNo, block_size ?? null, siloNum, lot_no ?? null,
      numOrNull(rc_pct_open), numOrNull(rc_speed),
      numOrNull(virgin_pct_open), numOrNull(virgin_speed),
      finalMoldTime, numOrNull(block_weight_lbs),
      operatorId, operatorName || operatorId,
      ts
    ).run();

    return NextResponse.json(
      { ok: true, block_id: id, block_no: finalBlockNo, mold_time: finalMoldTime },
      { status: 201 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
