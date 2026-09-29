// src/app/api/production/schedule/route.ts  →  GET /v2/api/production/schedule?from=&to=
// Production schedule lines with derived progress (prod-d-02). Defaults: from = today (ET),
// to = from + 6. Reversed dates are swapped; spans over 31 days → 400 range_too_large. Read-only;
// gated production.log by the /v2/api/production middleware prefix.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { MAX_READ_SPAN_DAYS, addDays, dayDiff, etToday, loadScheduleWithProgress } from "@/lib/productionSchedule";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const q = new URL(request.url).searchParams;
  const today = etToday();
  let from = (q.get("from") ?? "").trim() || today;
  let to = (q.get("to") ?? "").trim() || addDays(from, 6);
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ ok: false, error: "invalid_param", detail: "from/to" }, { status: 400 });
  }
  if (from > to) [from, to] = [to, from];
  if (dayDiff(from, to) + 1 > MAX_READ_SPAN_DAYS) {
    return NextResponse.json({ ok: false, error: "range_too_large" }, { status: 400 });
  }
  try {
    const lines = await loadScheduleWithProgress(DB, from, to, today);
    return NextResponse.json({ ok: true, today, from, to, lines });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
