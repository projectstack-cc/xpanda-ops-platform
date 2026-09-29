// src/app/api/production/manage/schedule/route.ts  →  POST /v2/api/production/manage/schedule
// Create a schedule line (prod-d-02). One line per key per day (unique indexes, prod-d-01) →
// 409 schedule_exists. sort_order = max + 1 within (plan_date, kind). Plan date must be inside the
// editable window [today, today + 14]. Gated production.manage by the middleware prefix; also
// checked directly below as defense-in-depth.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { canManageProduction, now } from "@/lib/productionSilos";
import { etToday, validateLineInput, validatePlanDate, type ScheduleLine } from "@/lib/productionSchedule";

export async function POST(request: NextRequest) {
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

  const dateErr = validatePlanDate(p.plan_date, etToday());
  if (dateErr) return NextResponse.json({ ok: false, error: dateErr }, { status: 400 });
  const v = validateLineInput(p.kind, p);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  const line = v.value;
  const planDate: string = p.plan_date;

  try {
    if (line.kind === "molding") {
      const opt = await DB.prepare(
        `SELECT id FROM production_options WHERE kind = 'block_type' AND value = ? AND active = 1`
      ).bind(line.block_type).first<{ id: string }>();
      if (!opt) return NextResponse.json({ ok: false, error: "unknown_block_type" }, { status: 400 });
    } else {
      const sup = await DB.prepare(
        `SELECT id FROM production_options WHERE kind = 'bead_supplier' AND value = ? AND active = 1`
      ).bind(line.bead_supplier).first<{ id: string }>();
      const typ = sup
        ? await DB.prepare(
            `SELECT id FROM production_options WHERE kind = 'bead_type' AND grp = ? AND value = ? AND active = 1`
          ).bind(line.bead_supplier, line.bead_type).first<{ id: string }>()
        : null;
      if (!sup || !typ) return NextResponse.json({ ok: false, error: "unknown_bead_type" }, { status: 400 });
    }

    const dup =
      line.kind === "molding"
        ? await DB.prepare(
            `SELECT id FROM production_schedule WHERE kind = 'molding' AND plan_date = ? AND block_type = ?`
          ).bind(planDate, line.block_type).first<{ id: string }>()
        : await DB.prepare(
            `SELECT id FROM production_schedule
              WHERE kind = 'expansion' AND plan_date = ? AND bead_supplier = ? AND bead_type = ? AND density = ?`
          ).bind(planDate, line.bead_supplier, line.bead_type, line.density).first<{ id: string }>();
    if (dup) return NextResponse.json({ ok: false, error: "schedule_exists", id: dup.id }, { status: 409 });

    const id = crypto.randomUUID();
    const ts = now();
    try {
      await DB.prepare(
        `INSERT INTO production_schedule
           (id, plan_date, kind, block_type, bead_supplier, bead_type, density, qty, sort_order, note, created_by, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?,
                COALESCE((SELECT MAX(sort_order) FROM production_schedule WHERE plan_date = ? AND kind = ?), -1) + 1,
                ?, ?, ?`
      ).bind(
        id, planDate, line.kind, line.block_type, line.bead_supplier, line.bead_type, line.density, line.qty,
        planDate, line.kind, line.note, actorId, ts
      ).run();
    } catch (e: any) {
      if (/UNIQUE constraint failed/i.test(String(e?.message || e))) {
        return NextResponse.json({ ok: false, error: "schedule_exists" }, { status: 409 });
      }
      throw e;
    }

    const row = await DB.prepare(`SELECT * FROM production_schedule WHERE id = ?`).bind(id).first<ScheduleLine>();
    const label = line.kind === "molding" ? line.block_type : `${line.bead_supplier} ${line.bead_type} ${line.density} pcf`;
    await logActivity(
      DB, "create", "production_schedule", id,
      `${actorName || actorId} scheduled ${line.qty} × ${label} (${line.kind}) for ${planDate}`,
      { schedule_id: id, plan_date: planDate, ...line }, actorId
    );
    return NextResponse.json({ ok: true, line: row }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
