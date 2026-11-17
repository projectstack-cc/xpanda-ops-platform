// src/app/api/tasks/board/route.ts  →  GET /v2/api/tasks/board?date=YYYY-MM-DD   (tasks-01)
// Schedule TV read: the day's tasks grouped by shift → team blocks / individual blocks (lib/tasks/board.ts).
// Default date = today (ET). Gated by middleware on schedule / schedule.desk / tasks.manage — no manage check here
// (the wall display account only has `schedule`).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { etNowWallClock } from "@/lib/etDateTime";
import { etToday, isValidYmd } from "@/lib/safety/records";
import { buildBoard } from "@/lib/tasks/board";
import { fail, loadDayTasks } from "@/lib/tasks/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("date");
  const today = etToday();
  const date = raw === null || raw === "" ? today : raw;
  if (!isValidYmd(date)) return fail(400, "invalid_date", "date must be YYYY-MM-DD.");
  try {
    const { DB } = await getEnv();
    const tasks = await loadDayTasks(DB, date);
    const board = buildBoard(date, tasks, etNowWallClock().minutes, date === today);
    return NextResponse.json({ ok: true, ...board }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return fail(500, "Server error.", String(e?.message || e));
  }
}
