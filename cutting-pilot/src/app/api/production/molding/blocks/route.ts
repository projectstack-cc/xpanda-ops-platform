// src/app/api/production/molding/blocks/route.ts  →  POST /v2/api/production/molding/blocks
// Appends one block row to a Molding session. block_no/mold_time auto-compute when blank.
// prod-b-02: the silo must be full / in_use; lot_no is stamped server-side from the silo (any
// client lot_no is ignored). The first block from a `full` silo moves it to `in_use`.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { nextBlockNo, etClockLabel } from "@/lib/productionNumbering";
import {
  canMoldFrom, eventInsert, getSilo, now, siloIsGate, siloNoOrNull, siloStampGate, transitionUpdate,
} from "@/lib/productionSilos";

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
    session_id, block_no, block_size, silo,
    rc_pct_open, rc_speed, virgin_pct_open, virgin_speed,
    mold_time, block_weight_lbs,
  } = body ?? {};

  if (!session_id) return NextResponse.json({ ok: false, error: "session_id is required." }, { status: 400 });
  if (block_weight_lbs === undefined || block_weight_lbs === null || block_weight_lbs === "") {
    return NextResponse.json({ ok: false, error: "weight_required" }, { status: 400 });
  }
  const siloNum = siloNoOrNull(silo);
  if (siloNum === null) return NextResponse.json({ ok: false, error: "silo_required" }, { status: 400 });

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

    const current = await getSilo(DB, siloNum);
    if (!current) return NextResponse.json({ ok: false, error: "silo_required" }, { status: 400 });
    const check = canMoldFrom(current);
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, detail: current.state }, { status: 409 });

    const id = crypto.randomUUID();
    const ts = now();
    const startsUse = current.state === "full";
    const gate = siloIsGate(siloNum, "in_use", current.lot_id);

    // One-lot-per-silo concurrency pattern — see lib/productionSilos.ts.
    const stmts = [];
    if (startsUse) {
      stmts.push(transitionUpdate(DB, {
        siloNo: siloNum, from: "full", fromLotId: current.lot_id, to: "in_use", operatorId, ts,
      }));
    }
    stmts.push(DB.prepare(
      `INSERT INTO production_molding_blocks
         (id, session_id, block_no, block_size, silo, lot_no, rc_pct_open, rc_speed,
          virgin_pct_open, virgin_speed, mold_time, block_weight_lbs, operator_id, operator_name, created_at,
          bead_supplier, bead_type, density, silo_full_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${gate.sql}`
    ).bind(
      id, session_id,
      finalBlockNo, block_size ?? null, siloNum, current.lot_no,
      numOrNull(rc_pct_open), numOrNull(rc_speed),
      numOrNull(virgin_pct_open), numOrNull(virgin_speed),
      finalMoldTime, numOrNull(block_weight_lbs),
      operatorId, operatorName || operatorId,
      ts,
      // Bead snapshot from the silo row already loaded (full_at survives full -> in_use).
      current.bead_supplier, current.bead_type, current.density, current.full_at,
      ...gate.binds
    ));
    if (startsUse) {
      stmts.push(eventInsert(DB, {
        siloNo: siloNum, from: "full", to: "in_use", lotNo: current.lot_no, source: "molding", refId: id,
        operatorId, operatorName, ts,
        gates: [
          { sql: `EXISTS (SELECT 1 FROM production_molding_blocks WHERE id = ?)`, binds: [id] },
          siloStampGate(siloNum, operatorId, ts),
        ],
      }));
    }
    const results = await DB.batch(stmts);
    if (!results[startsUse ? 1 : 0].meta.changes) {
      return NextResponse.json({ ok: false, error: "silo_state_changed" }, { status: 409 });
    }

    if (startsUse) {
      await logActivity(
        DB, "update", "production_silo", String(siloNum),
        `${operatorName || operatorId} started molding from ${current.label} (lot ${current.lot_no})`,
        { silo_no: siloNum, from: "full", to: "in_use", lot_no: current.lot_no, block_id: id }, operatorId
      );
    }

    return NextResponse.json(
      {
        ok: true, block_id: id, block_no: finalBlockNo, mold_time: finalMoldTime,
        lot_no: current.lot_no, silo: await getSilo(DB, siloNum),
      },
      { status: 201 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
