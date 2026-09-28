// src/app/api/production/silos/[no]/state/route.ts  →  POST /v2/api/production/silos/:no/state
// Operator-reported silo transitions from the floor's switch prompts (prod-b-02):
//   filling -> full   (expansion operator: "Is silo N full?")
//   in_use  -> empty  (molding operator:    "Is silo N empty?")
// Anything else is a manager correction (manage/silos/[no]). Guarded UPDATE + gated event in one
// batch — see the concurrency pattern in lib/productionSilos.ts.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import {
  eventInsert, getSilo, now, siloIsGate, siloNoOrNull, siloStampGate, transitionUpdate, type SiloState,
} from "@/lib/productionSilos";

const ALLOWED: Record<string, { from: SiloState; source: "expansion" | "molding" }> = {
  full: { from: "filling", source: "expansion" },
  empty: { from: "in_use", source: "molding" },
};

export async function POST(request: NextRequest, ctx: { params: Promise<{ no: string }> }) {
  const { no } = await ctx.params;
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

  const siloNo = siloNoOrNull(no);
  if (siloNo === null) return NextResponse.json({ ok: false, error: "silo_invalid" }, { status: 400 });
  const to = body?.to;
  const rule = ALLOWED[to];

  try {
    const silo = await getSilo(DB, siloNo);
    if (!silo) return NextResponse.json({ ok: false, error: "silo_invalid" }, { status: 400 });
    if (!rule || silo.state !== rule.from) {
      return NextResponse.json({ ok: false, error: "bad_transition", detail: silo.state }, { status: 409 });
    }

    const toState = to as SiloState;
    const ts = now();
    const postLotId = toState === "empty" ? null : silo.lot_id;
    const results = await DB.batch([
      transitionUpdate(DB, {
        siloNo, from: silo.state, fromLotId: silo.lot_id, to: toState,
        patch: toState === "full" ? { full_at: ts } : undefined,
        operatorId, ts,
      }),
      eventInsert(DB, {
        siloNo, from: silo.state, to: toState, lotNo: silo.lot_no, source: rule.source,
        refId: typeof body?.ref_id === "string" ? body.ref_id : null,
        operatorId, operatorName, ts,
        gates: [siloIsGate(siloNo, toState, postLotId), siloStampGate(siloNo, operatorId, ts)],
      }),
    ]);
    if (!results[0].meta.changes) {
      return NextResponse.json({ ok: false, error: "silo_state_changed" }, { status: 409 });
    }

    await logActivity(
      DB, "update", "production_silo", String(siloNo),
      `${operatorName || operatorId} reported ${silo.label} ${toState === "full" ? "full" : "empty"}`,
      { silo_no: siloNo, from: silo.state, to: toState, lot_no: silo.lot_no }, operatorId
    );

    return NextResponse.json({ ok: true, silo: await getSilo(DB, siloNo) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
