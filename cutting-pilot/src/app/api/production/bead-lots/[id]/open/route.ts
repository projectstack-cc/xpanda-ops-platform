// src/app/api/production/bead-lots/[id]/open/route.ts  →  POST /v2/api/production/bead-lots/:id/open
// "+1 bag" on an open expansion sheet: ledger `open`, bags -1 (prod-b-02). Never blocked on stock —
// negative on-hand is allowed because receiving can lag the floor.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { getLot, loadBagContext, now } from "@/lib/productionSilos";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
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
  const sessionId = typeof body?.session_id === "string" ? body.session_id : "";

  try {
    const c = await loadBagContext(DB, id, sessionId);
    if ("status" in c) return NextResponse.json({ ok: false, error: c.error }, { status: c.status });

    await DB.prepare(
      `INSERT INTO production_bead_ledger (id, lot_id, kind, bags, session_id, operator_id, operator_name, created_at)
       VALUES (?, ?, 'open', -1, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), id, sessionId, operatorId, operatorName || operatorId, now()).run();

    await logActivity(
      DB, "update", "production_bead_lot", id,
      `${operatorName || operatorId} opened a bag of lot ${c.lot.lot_no}`,
      { lot_id: id, lot_no: c.lot.lot_no, session_id: sessionId, bags: -1 }, operatorId
    );

    return NextResponse.json({ ok: true, lot: await getLot(DB, id, sessionId) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
