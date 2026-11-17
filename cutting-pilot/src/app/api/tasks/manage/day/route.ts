// src/app/api/tasks/manage/day/route.ts  →  GET /v2/api/tasks/manage/day?date=YYYY-MM-DD   (tasks-01)
// Manager table for one date: flat task rows (slot NULL last, sort_order, title) + every assignable person with
// their task_count for that date. Middleware: tasks.manage view; canManageTasks re-checks.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { actorOf, etToday, isValidYmd } from "@/lib/safety/records";
import { canManageTasks, fail, loadAssignablePeople, loadDayTasks, toManageRow } from "@/lib/tasks/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!actorOf(request.headers)) return fail(401, "Unauthorized");
  if (!canManageTasks(request.headers)) return fail(403, "Access denied.");
  const raw = request.nextUrl.searchParams.get("date");
  const date = raw === null || raw === "" ? etToday() : raw;
  if (!isValidYmd(date)) return fail(400, "invalid_date", "date must be YYYY-MM-DD.");
  try {
    const { DB } = await getEnv();
    const [tasks, people] = await Promise.all([loadDayTasks(DB, date), loadAssignablePeople(DB)]);
    const counts = new Map<string, number>();
    for (const t of tasks) for (const a of t.assignees) counts.set(a.id, (counts.get(a.id) ?? 0) + 1);
    return NextResponse.json(
      {
        ok: true,
        date,
        tasks: tasks.map(toManageRow),
        people: people.map((p) => ({ ...p, task_count: counts.get(p.id) ?? 0 })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return fail(500, "Server error.", String(e?.message || e));
  }
}
