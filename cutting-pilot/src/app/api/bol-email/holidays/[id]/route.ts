// src/app/api/bol-email/holidays/[id]/route.ts  ->  DELETE /v2/api/bol-email/holidays/:id (bem-01)
// Port of legacy handleHolidays (DELETE branch) — same SQL. bem-01 Decision 4: writes logActivity.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { requireBolEdit } from "@/lib/logistics/bolEmail";

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireBolEdit(request);
  if (denied) return denied;
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  const existing = await DB.prepare("SELECT holiday_date, label FROM plant_holidays WHERE id = ?").bind(id).first<any>();
  await DB.prepare("DELETE FROM plant_holidays WHERE id = ?").bind(id).run();
  await logActivity(DB, "delete", "plant_holiday", id,
    `Removed plant closure ${existing?.holiday_date || id}`,
    { id, holiday_date: existing?.holiday_date ?? null, label: existing?.label ?? null },
    request.headers.get("X-User-Id") || null);
  return NextResponse.json({ ok: true });
}
