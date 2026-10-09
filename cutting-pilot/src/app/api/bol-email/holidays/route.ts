// src/app/api/bol-email/holidays/route.ts  ->  GET/POST /v2/api/bol-email/holidays (bem-01)
// Port of legacy handleHolidays (GET + POST branches) — same SQL, YYYY-MM-DD check, 409 on duplicate.
// bem-01 Decision 4: POST also writes logActivity (legacy didn't).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { requireBolEdit } from "@/lib/logistics/bolEmail";

export async function GET(request: NextRequest) {
  const denied = requireBolEdit(request);
  if (denied) return denied;
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  const r = await DB.prepare("SELECT id, holiday_date, label FROM plant_holidays ORDER BY holiday_date ASC").all();
  return NextResponse.json({ ok: true, holidays: r.results || [] });
}

export async function POST(request: NextRequest) {
  const denied = requireBolEdit(request);
  if (denied) return denied;
  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  let p: any;
  try {
    p = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const date = String(p.holiday_date || "").trim();
  const label = String(p.label || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ ok: false, error: "Date must be YYYY-MM-DD." }, { status: 400 });
  let id: unknown;
  try {
    const res = await DB.prepare("INSERT INTO plant_holidays (holiday_date, label) VALUES (?, ?)").bind(date, label).run();
    id = res.meta?.last_row_id;
  } catch {
    return NextResponse.json({ ok: false, error: "That date is already listed." }, { status: 409 });
  }
  await logActivity(DB, "create", "plant_holiday", String(id ?? date),
    `Added plant closure ${date}${label ? ` (${label})` : ""}`, { id, holiday_date: date, label },
    request.headers.get("X-User-Id") || null);
  return NextResponse.json({ ok: true, id });
}
