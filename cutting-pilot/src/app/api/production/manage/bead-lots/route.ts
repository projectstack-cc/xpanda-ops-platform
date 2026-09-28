// src/app/api/production/manage/bead-lots/route.ts  →  POST /v2/api/production/manage/bead-lots
// Receive bead (prod-b-02): creates the lot + a `receive` ledger entry, or — if (supplier, lot_no)
// already exists with the same bead type — re-activates it and appends another `receive` entry
// (label fields untouched). Gated production.manage by the middleware prefix; re-checked here.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { etDateParts } from "@/lib/productionNumbering";
import { canManageProduction, getLot, now } from "@/lib/productionSilos";

function str(v: any): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageProduction(request.headers)) {
    return NextResponse.json({ ok: false, error: "manage_required" }, { status: 403 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const supplier = str(body?.bead_supplier);
  const beadType = str(body?.bead_type);
  const lotNo = str(body?.lot_no);
  const bags = Number(body?.bags);
  const labelWeight = Number(body?.label_weight);
  const labelUnit = body?.label_unit;
  const receivedDate = str(body?.received_date) || etDateParts().ymd;

  if (!Number.isInteger(bags) || bags <= 0) return NextResponse.json({ ok: false, error: "bags_invalid" }, { status: 400 });
  if (!(labelWeight > 0) || (labelUnit !== "kg" && labelUnit !== "lb")) {
    return NextResponse.json({ ok: false, error: "label_invalid" }, { status: 400 });
  }
  if (!lotNo) return NextResponse.json({ ok: false, error: "lot_no_required" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedDate)) {
    return NextResponse.json({ ok: false, error: "Invalid received_date." }, { status: 400 });
  }

  try {
    const supplierOpt = supplier
      ? await DB.prepare(
          `SELECT id FROM production_options WHERE kind = 'bead_supplier' AND value = ? AND active = 1`
        ).bind(supplier).first<{ id: string }>()
      : null;
    if (!supplierOpt) return NextResponse.json({ ok: false, error: "unknown_supplier" }, { status: 400 });
    const typeOpt = beadType
      ? await DB.prepare(
          `SELECT id FROM production_options WHERE kind = 'bead_type' AND grp = ? AND value = ? AND active = 1`
        ).bind(supplier, beadType).first<{ id: string }>()
      : null;
    if (!typeOpt) return NextResponse.json({ ok: false, error: "unknown_bead_type" }, { status: 400 });

    const ts = now();
    const receiveEntry = (lotId: string) =>
      DB.prepare(
        `INSERT INTO production_bead_ledger (id, lot_id, kind, bags, operator_id, operator_name, created_at)
         VALUES (?, ?, 'receive', ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), lotId, bags, actorId, actorName || actorId, ts);

    const existing = await DB.prepare(
      `SELECT id, bead_type, active FROM production_bead_lots WHERE bead_supplier = ? AND lot_no = ?`
    ).bind(supplier, lotNo).first<{ id: string; bead_type: string; active: number }>();

    let lotId: string;
    let created: boolean;
    if (existing) {
      if (existing.bead_type !== beadType) {
        return NextResponse.json({ ok: false, error: "lot_conflict", detail: existing.bead_type }, { status: 409 });
      }
      lotId = existing.id;
      created = false;
      const stmts = [receiveEntry(lotId)];
      if (!existing.active) {
        stmts.unshift(
          DB.prepare(`UPDATE production_bead_lots SET active = 1, updated_at = ? WHERE id = ?`).bind(ts, lotId)
        );
      }
      await DB.batch(stmts);
    } else {
      lotId = crypto.randomUUID();
      created = true;
      await DB.batch([
        DB.prepare(
          `INSERT INTO production_bead_lots
             (id, bead_supplier, bead_type, lot_no, label_weight, label_unit, po_no, received_date, notes,
              active, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        ).bind(
          lotId, supplier, beadType, lotNo, labelWeight, labelUnit,
          str(body?.po_no) || null, receivedDate, str(body?.notes) || null, actorId, ts
        ),
        receiveEntry(lotId),
      ]);
    }

    await logActivity(
      DB, created ? "create" : "update", "production_bead_lot", lotId,
      `${actorName || actorId} received ${bags} bag${bags === 1 ? "" : "s"} of ${supplier} ${beadType} lot ${lotNo}`,
      { lot_id: lotId, bead_supplier: supplier, bead_type: beadType, lot_no: lotNo, bags, created }, actorId
    );

    return NextResponse.json({ ok: true, lot: await getLot(DB, lotId), created }, { status: created ? 201 : 200 });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (/UNIQUE/i.test(msg)) {
      // Lost a race with a simultaneous first receive of the same (supplier, lot_no); nothing was
      // written by this request (the batch rolled back). Resubmitting appends to the existing lot.
      return NextResponse.json({ ok: false, error: "lot_conflict", detail: msg }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: "Server error.", detail: msg }, { status: 500 });
  }
}
