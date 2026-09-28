// src/app/api/production/manage/silos/[no]/route.ts  →  PATCH /v2/api/production/manage/silos/:no
// Manager silo correction (prod-b-02): label, active, and any-state -> any-state with a required
// note. A non-empty target state needs an existing lot (snapshots lot_no/supplier/type, density
// NULL). Gated production.manage by the middleware prefix; re-checked here as defense-in-depth.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import {
  SILO_STATES, canManageProduction, eventInsert, getSilo, now, siloIsGate, siloNoOrNull, siloStampGate,
  transitionUpdate, type SiloPatch, type SiloState,
} from "@/lib/productionSilos";

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ no: string }> }) {
  const { no } = await ctx.params;
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageProduction(request.headers)) {
    return NextResponse.json({ ok: false, error: "manage_required" }, { status: 403 });
  }

  let p: any;
  try {
    p = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const siloNo = siloNoOrNull(no);
  if (siloNo === null) return NextResponse.json({ ok: false, error: "silo_invalid" }, { status: 400 });

  try {
    const silo = await getSilo(DB, siloNo);
    if (!silo) return NextResponse.json({ ok: false, error: "silo_invalid" }, { status: 400 });

    const patch: SiloPatch = {};
    const changed: string[] = [];
    if ("label" in p) {
      const label = typeof p.label === "string" ? p.label.trim() : "";
      if (!label) return NextResponse.json({ ok: false, error: "Label is required." }, { status: 400 });
      patch.label = label;
      changed.push("label");
    }
    if ("active" in p) { patch.active = p.active ? 1 : 0; changed.push("active"); }

    // State/lot correction: any state -> any state, note required.
    const wantsState = "state" in p || "lot_id" in p;
    const toState: SiloState = "state" in p ? p.state : silo.state;
    let toLotId: string | null = silo.lot_id;
    let toLotNo: string | null = silo.lot_no;
    if (wantsState) {
      if (!SILO_STATES.includes(toState)) {
        return NextResponse.json({ ok: false, error: "bad_transition", detail: silo.state }, { status: 400 });
      }
      const note = typeof p.note === "string" ? p.note.trim() : "";
      if (!note) return NextResponse.json({ ok: false, error: "note_required" }, { status: 400 });
      if (toState === "empty") {
        toLotId = null;
        toLotNo = null;
      } else {
        const lotId = "lot_id" in p ? p.lot_id : silo.lot_id;
        const lot = lotId
          ? await DB.prepare(
              `SELECT id, lot_no, bead_supplier, bead_type FROM production_bead_lots WHERE id = ?`
            ).bind(lotId).first<{ id: string; lot_no: string; bead_supplier: string; bead_type: string }>()
          : null;
        if (!lot) return NextResponse.json({ ok: false, error: "lot_unknown" }, { status: 400 });
        const newLot = lot.id !== silo.lot_id;
        toLotId = lot.id;
        toLotNo = lot.lot_no;
        const ts0 = now();
        patch.lot_id = lot.id;
        patch.lot_no = lot.lot_no;
        patch.bead_supplier = lot.bead_supplier;
        patch.bead_type = lot.bead_type;
        if (newLot || silo.state === "empty") {
          patch.density = null;
          patch.fill_started_at = ts0;
          patch.full_at = toState === "filling" ? null : ts0;
        } else {
          patch.full_at = toState === "filling" ? null : (silo.full_at ?? ts0);
        }
      }
      changed.push("state");
    }

    if (!changed.length) return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });

    const ts = now();
    const stmts = [
      transitionUpdate(DB, {
        siloNo, from: silo.state, fromLotId: silo.lot_id, to: toState, patch, operatorId: actorId, ts,
      }),
    ];
    if (wantsState) {
      stmts.push(eventInsert(DB, {
        siloNo, from: silo.state, to: toState, lotNo: toLotNo, source: "manual",
        note: String(p.note).trim(), operatorId: actorId, operatorName: actorName, ts,
        gates: [siloIsGate(siloNo, toState, toLotId), siloStampGate(siloNo, actorId, ts)],
      }));
    }
    const results = await DB.batch(stmts);
    if (!results[0].meta.changes) {
      return NextResponse.json({ ok: false, error: "silo_state_changed" }, { status: 409 });
    }

    await logActivity(
      DB, "update", "production_silo", String(siloNo),
      `${actorName || actorId} corrected ${silo.label}`,
      {
        silo_no: siloNo, fields: changed,
        ...(wantsState ? { from: silo.state, to: toState, lot_no: toLotNo, note: String(p.note).trim() } : {}),
      },
      actorId
    );

    return NextResponse.json({ ok: true, silo: await getSilo(DB, siloNo) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
