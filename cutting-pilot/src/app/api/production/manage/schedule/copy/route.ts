// src/app/api/production/manage/schedule/copy/route.ts  →  POST /v2/api/production/manage/schedule/copy
// Body { from_date, to_date }. Copies every from_date line whose key isn't already on to_date,
// appended after to_date's existing lines (per kind) in from_date order, in one DB.batch. to_date
// must be inside the editable window. Returns { ok, copied, skipped }. prod-d-02. Gated
// production.manage.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { canManageProduction, now } from "@/lib/productionSilos";
import { etToday, lineKey, validatePlanDate, type ScheduleLine } from "@/lib/productionSchedule";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  if (typeof p.from_date !== "string" || !DATE_RE.test(p.from_date)) {
    return NextResponse.json({ ok: false, error: "invalid_plan_date" }, { status: 400 });
  }
  const dateErr = validatePlanDate(p.to_date, etToday());
  if (dateErr) return NextResponse.json({ ok: false, error: dateErr }, { status: 400 });
  const fromDate: string = p.from_date;
  const toDate: string = p.to_date;
  if (fromDate === toDate) return NextResponse.json({ ok: true, copied: 0, skipped: 0 });

  try {
    const [srcRes, dstRes] = await DB.batch([
      DB.prepare(`SELECT * FROM production_schedule WHERE plan_date = ? ORDER BY kind, sort_order, created_at`).bind(fromDate),
      DB.prepare(`SELECT * FROM production_schedule WHERE plan_date = ?`).bind(toDate),
    ]);
    const src = (srcRes.results ?? []) as unknown as ScheduleLine[];
    const dst = (dstRes.results ?? []) as unknown as ScheduleLine[];
    const existing = new Set(dst.map(lineKey));
    const nextSort: Record<string, number> = { molding: 0, expansion: 0 };
    for (const l of dst) nextSort[l.kind] = Math.max(nextSort[l.kind], l.sort_order + 1);

    const ts = now();
    const toInsert = src.filter((l) => !existing.has(lineKey(l)));
    const stmts = toInsert.map((l) =>
      DB.prepare(
        `INSERT INTO production_schedule
           (id, plan_date, kind, block_type, bead_supplier, bead_type, density, qty, sort_order, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), toDate, l.kind, l.block_type, l.bead_supplier, l.bead_type, l.density, l.qty,
        nextSort[l.kind]++, l.note, actorId, ts
      )
    );
    if (stmts.length) {
      try {
        await DB.batch(stmts);
      } catch (e: any) {
        // Someone added one of these keys to to_date between our read and write.
        if (/UNIQUE constraint failed/i.test(String(e?.message || e))) {
          return NextResponse.json({ ok: false, error: "schedule_changed" }, { status: 409 });
        }
        throw e;
      }
    }
    const copied = stmts.length;
    const skipped = src.length - copied;
    await logActivity(
      DB, "create", "production_schedule", toDate,
      `${actorName || actorId} copied the schedule from ${fromDate} to ${toDate} (${copied} copied, ${skipped} skipped)`,
      { from_date: fromDate, to_date: toDate, copied, skipped }, actorId
    );
    return NextResponse.json({ ok: true, copied, skipped });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
