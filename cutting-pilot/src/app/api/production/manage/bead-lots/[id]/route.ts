// src/app/api/production/manage/bead-lots/[id]/route.ts  →  PATCH /v2/api/production/manage/bead-lots/:id
// Edit a received lot (prod-b-02). bead_supplier / bead_type / lot_no are immutable — they're
// stamped onto silos and sheet rows. Gated production.manage by the middleware prefix.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { canManageProduction, getLot, now } from "@/lib/productionSilos";

const IMMUTABLE = ["bead_supplier", "bead_type", "lot_no"];

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
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
  p = p ?? {};
  if (IMMUTABLE.some((k) => k in p)) {
    return NextResponse.json({ ok: false, error: "lot_immutable_field" }, { status: 400 });
  }

  const sets: string[] = [];
  const binds: unknown[] = [];
  const changed: string[] = [];
  const text = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

  if ("label_weight" in p) {
    const w = Number(p.label_weight);
    if (!(w > 0)) return NextResponse.json({ ok: false, error: "label_invalid" }, { status: 400 });
    sets.push("label_weight = ?"); binds.push(w); changed.push("label_weight");
  }
  if ("label_unit" in p) {
    if (p.label_unit !== "kg" && p.label_unit !== "lb") {
      return NextResponse.json({ ok: false, error: "label_invalid" }, { status: 400 });
    }
    sets.push("label_unit = ?"); binds.push(p.label_unit); changed.push("label_unit");
  }
  if ("po_no" in p) { sets.push("po_no = ?"); binds.push(text(p.po_no)); changed.push("po_no"); }
  if ("notes" in p) { sets.push("notes = ?"); binds.push(text(p.notes)); changed.push("notes"); }
  if ("received_date" in p) {
    const d = text(p.received_date);
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return NextResponse.json({ ok: false, error: "Invalid received_date." }, { status: 400 });
    }
    sets.push("received_date = ?"); binds.push(d); changed.push("received_date");
  }
  if ("active" in p) { sets.push("active = ?"); binds.push(p.active ? 1 : 0); changed.push("active"); }

  if (!sets.length) return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });
  sets.push("updated_at = ?");
  binds.push(now());

  try {
    const result = await DB.prepare(
      `UPDATE production_bead_lots SET ${sets.join(", ")} WHERE id = ?`
    ).bind(...binds, id).run();
    if (!result.meta.changes) return NextResponse.json({ ok: false, error: "lot_unknown" }, { status: 404 });

    const lot = await getLot(DB, id);
    await logActivity(
      DB, "update", "production_bead_lot", id,
      `${actorName || actorId} edited bead lot ${lot?.lot_no ?? id}`,
      { lot_id: id, fields: changed }, actorId
    );

    return NextResponse.json({ ok: true, lot });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
