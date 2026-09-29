// src/app/api/production/manage/schedule/reorder/route.ts  →  POST /v2/api/production/manage/schedule/reorder
// Body { plan_date, kind, ids }. `ids` must be exactly that day's lines of that kind, else 409
// schedule_changed (the editor refetches). Writes sort_order = index in one DB.batch. The order is
// what the production TV shows. prod-d-02. Gated production.manage.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { canManageProduction, now } from "@/lib/productionSilos";
import { etToday, validatePlanDate } from "@/lib/productionSchedule";

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
  if (p.kind !== "molding" && p.kind !== "expansion") {
    return NextResponse.json({ ok: false, error: "invalid_kind" }, { status: 400 });
  }
  const ids: unknown = p.ids;
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string") || new Set(ids).size !== ids.length) {
    return NextResponse.json({ ok: false, error: "invalid_param", detail: "ids" }, { status: 400 });
  }

  try {
    const cur = await DB.prepare(`SELECT id FROM production_schedule WHERE plan_date = ? AND kind = ?`)
      .bind(p.plan_date, p.kind)
      .all<{ id: string }>();
    const have = new Set((cur.results ?? []).map((r) => r.id));
    if (have.size !== ids.length || !(ids as string[]).every((x) => have.has(x))) {
      return NextResponse.json({ ok: false, error: "schedule_changed" }, { status: 409 });
    }
    if (ids.length) {
      const ts = now();
      await DB.batch(
        (ids as string[]).map((id, i) =>
          DB.prepare(
            `UPDATE production_schedule SET sort_order = ?, updated_by = ?, updated_at = ?
              WHERE id = ? AND plan_date = ? AND kind = ?`
          ).bind(i, actorId, ts, id, p.plan_date, p.kind)
        )
      );
    }
    await logActivity(
      DB, "update", "production_schedule", `${p.plan_date}:${p.kind}`,
      `${actorName || actorId} reordered the ${p.kind} schedule for ${p.plan_date}`,
      { plan_date: p.plan_date, kind: p.kind, ids }, actorId
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
