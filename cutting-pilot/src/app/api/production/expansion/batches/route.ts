// src/app/api/production/expansion/batches/route.ts  →  POST /v2/api/production/expansion/batches
// Appends one batch row to an Expansion session. lot_no serves as the batch #; silo is per row.
// prod-b-02: lot must be a received active lot matching the sheet; the silo must be empty (starts
// a fill with that lot) or already filling with the same lot — one lot per silo.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import {
  canExpandInto, eventInsert, getSilo, now, siloIsGate, siloNoOrNull, siloStampGate, transitionUpdate,
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

  const { session_id, lot_no, silo, weight_kg, heating_time_s, bucket_weight_g } = body ?? {};

  if (!session_id) return NextResponse.json({ ok: false, error: "session_id is required." }, { status: 400 });
  const siloNo = siloNoOrNull(silo);
  if (siloNo === null) return NextResponse.json({ ok: false, error: "silo_required" }, { status: 400 });
  const lotInput = typeof lot_no === "string" ? lot_no.trim() : "";
  if (!lotInput) return NextResponse.json({ ok: false, error: "lot_required" }, { status: 400 });

  try {
    const session = await DB.prepare(
      `SELECT id, status, bead_supplier, bead_type, density FROM production_expansion_sessions
        WHERE id = ? AND deleted_at IS NULL`
    ).bind(session_id).first<{
      id: string; status: string; bead_supplier: string | null; bead_type: string | null; density: number | null;
    }>();
    if (!session) return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });
    if (session.status === "closed") {
      return NextResponse.json({ ok: false, error: "sheet_closed" }, { status: 409 });
    }

    // The lot must be a received, active lot of the sheet's supplier + bead type.
    const lot = await DB.prepare(
      `SELECT id, lot_no, bead_type FROM production_bead_lots WHERE lot_no = ? AND bead_supplier = ? AND active = 1`
    ).bind(lotInput, session.bead_supplier ?? "").first<{ id: string; lot_no: string; bead_type: string }>();
    if (!lot) return NextResponse.json({ ok: false, error: "lot_unknown" }, { status: 400 });
    if (lot.bead_type !== session.bead_type) {
      return NextResponse.json({ ok: false, error: "lot_sheet_mismatch" }, { status: 400 });
    }

    const current = await getSilo(DB, siloNo);
    if (!current) return NextResponse.json({ ok: false, error: "silo_required" }, { status: 400 });
    const check = canExpandInto(current, lot.id);
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, detail: current.state }, { status: 409 });

    const id = crypto.randomUUID();
    const ts = now();
    const startsFill = current.state === "empty";
    const gate = siloIsGate(siloNo, "filling", lot.id);

    // One-lot-per-silo concurrency pattern — see lib/productionSilos.ts.
    const stmts = [];
    if (startsFill) {
      stmts.push(transitionUpdate(DB, {
        siloNo, from: "empty", fromLotId: null, to: "filling",
        patch: {
          lot_id: lot.id, lot_no: lot.lot_no,
          bead_supplier: session.bead_supplier, bead_type: session.bead_type, density: session.density,
          fill_started_at: ts, full_at: null,
        },
        operatorId, ts,
      }));
    }
    stmts.push(DB.prepare(
      `INSERT INTO production_expansion_batches
         (id, session_id, lot_no, silo, weight_kg, heating_time_s, bucket_weight_g,
          operator_id, operator_name, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${gate.sql}`
    ).bind(
      id, session_id,
      lot.lot_no, siloNo, numOrNull(weight_kg), numOrNull(heating_time_s), numOrNull(bucket_weight_g),
      operatorId, operatorName || operatorId,
      ts,
      ...gate.binds
    ));
    if (startsFill) {
      stmts.push(eventInsert(DB, {
        siloNo, from: "empty", to: "filling", lotNo: lot.lot_no, source: "expansion", refId: id,
        operatorId, operatorName, ts,
        gates: [
          { sql: `EXISTS (SELECT 1 FROM production_expansion_batches WHERE id = ?)`, binds: [id] },
          siloStampGate(siloNo, operatorId, ts),
        ],
      }));
    }
    const results = await DB.batch(stmts);
    if (!results[startsFill ? 1 : 0].meta.changes) {
      return NextResponse.json({ ok: false, error: "silo_state_changed" }, { status: 409 });
    }

    if (startsFill) {
      await logActivity(
        DB, "update", "production_silo", String(siloNo),
        `${operatorName || operatorId} started filling ${current.label} with lot ${lot.lot_no}`,
        { silo_no: siloNo, from: "empty", to: "filling", lot_no: lot.lot_no, batch_id: id }, operatorId
      );
    }

    return NextResponse.json({ ok: true, batch_id: id, silo: await getSilo(DB, siloNo) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
