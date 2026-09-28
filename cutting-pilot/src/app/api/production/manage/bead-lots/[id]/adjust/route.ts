// src/app/api/production/manage/bead-lots/[id]/adjust/route.ts
//   →  POST /v2/api/production/manage/bead-lots/:id/adjust
// Manager bag-count correction (prod-b-02): signed non-zero `bags` + required note, ledger `adjust`.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { canManageProduction, getLot, now } from "@/lib/productionSilos";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
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
  const bags = Number(body?.bags);
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (!Number.isInteger(bags) || bags === 0) return NextResponse.json({ ok: false, error: "bags_invalid" }, { status: 400 });
  if (!note) return NextResponse.json({ ok: false, error: "note_required" }, { status: 400 });

  try {
    const lot = await DB.prepare(`SELECT id, lot_no FROM production_bead_lots WHERE id = ?`)
      .bind(id).first<{ id: string; lot_no: string }>();
    if (!lot) return NextResponse.json({ ok: false, error: "lot_unknown" }, { status: 404 });

    await DB.prepare(
      `INSERT INTO production_bead_ledger (id, lot_id, kind, bags, note, operator_id, operator_name, created_at)
       VALUES (?, ?, 'adjust', ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), id, bags, note, actorId, actorName || actorId, now()).run();

    await logActivity(
      DB, "update", "production_bead_lot", id,
      `${actorName || actorId} adjusted lot ${lot.lot_no} by ${bags > 0 ? "+" : ""}${bags} bag${Math.abs(bags) === 1 ? "" : "s"}`,
      { lot_id: id, lot_no: lot.lot_no, bags, note }, actorId
    );

    return NextResponse.json({ ok: true, lot: await getLot(DB, id) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
