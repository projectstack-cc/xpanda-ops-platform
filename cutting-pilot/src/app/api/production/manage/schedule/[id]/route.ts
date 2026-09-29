// src/app/api/production/manage/schedule/[id]/route.ts  →  /v2/api/production/manage/schedule/:id
// PATCH = edit qty and/or note only (key fields → 400 key_immutable; delete + re-add to change a
// key). DELETE = hard delete (plans aren't audit records; the activity log keeps the trail). Past
// plan dates are read-only → 400 date_out_of_range. prod-d-02. Gated production.manage.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { canManageProduction, now } from "@/lib/productionSilos";
import { etToday, normQty, type ScheduleLine } from "@/lib/productionSchedule";

const KEY_FIELDS = ["plan_date", "kind", "block_type", "bead_supplier", "bead_type", "density"];

function guard(request: NextRequest) {
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  if (!actorId) return { res: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  if (!canManageProduction(request.headers)) {
    return { res: NextResponse.json({ ok: false, error: "manage_required" }, { status: 403 }) };
  }
  return { actorId, actorName };
}

const label = (l: ScheduleLine) =>
  l.kind === "molding" ? `${l.block_type}` : `${l.bead_supplier} ${l.bead_type} ${l.density} pcf`;

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  const g = guard(request);
  if (g.res) return g.res;

  let p: any;
  try {
    p = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  p = p ?? {};
  if (KEY_FIELDS.some((k) => k in p)) return NextResponse.json({ ok: false, error: "key_immutable" }, { status: 400 });

  const sets: string[] = [];
  const binds: unknown[] = [];
  const changed: string[] = [];
  if ("qty" in p) {
    const qty = normQty(p.qty);
    if (qty === null) return NextResponse.json({ ok: false, error: "qty_invalid" }, { status: 400 });
    sets.push("qty = ?"); binds.push(qty); changed.push("qty");
  }
  if ("note" in p) {
    const note = typeof p.note === "string" && p.note.trim() ? p.note.trim() : null;
    sets.push("note = ?"); binds.push(note); changed.push("note");
  }
  if (!sets.length) return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });

  try {
    const cur = await DB.prepare(`SELECT * FROM production_schedule WHERE id = ?`).bind(id).first<ScheduleLine>();
    if (!cur) return NextResponse.json({ ok: false, error: "schedule_not_found" }, { status: 404 });
    if (cur.plan_date < etToday()) return NextResponse.json({ ok: false, error: "date_out_of_range" }, { status: 400 });

    sets.push("updated_by = ?", "updated_at = ?");
    binds.push(g.actorId, now());
    const result = await DB.prepare(`UPDATE production_schedule SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id).run();
    if (!result.meta.changes) return NextResponse.json({ ok: false, error: "schedule_not_found" }, { status: 404 });

    const line = await DB.prepare(`SELECT * FROM production_schedule WHERE id = ?`).bind(id).first<ScheduleLine>();
    await logActivity(
      DB, "update", "production_schedule", id,
      `${g.actorName || g.actorId} edited schedule line ${label(cur)} (${cur.plan_date})`,
      { schedule_id: id, plan_date: cur.plan_date, fields: changed, qty: line?.qty, note: line?.note }, g.actorId!
    );
    return NextResponse.json({ ok: true, line });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  const g = guard(request);
  if (g.res) return g.res;

  try {
    const cur = await DB.prepare(`SELECT * FROM production_schedule WHERE id = ?`).bind(id).first<ScheduleLine>();
    if (!cur) return NextResponse.json({ ok: false, error: "schedule_not_found" }, { status: 404 });
    if (cur.plan_date < etToday()) return NextResponse.json({ ok: false, error: "date_out_of_range" }, { status: 400 });

    const result = await DB.prepare(`DELETE FROM production_schedule WHERE id = ?`).bind(id).run();
    if (!result.meta.changes) return NextResponse.json({ ok: false, error: "schedule_not_found" }, { status: 404 });

    await logActivity(
      DB, "delete", "production_schedule", id,
      `${g.actorName || g.actorId} removed schedule line ${label(cur)} (${cur.plan_date})`,
      { ...cur }, g.actorId!
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
