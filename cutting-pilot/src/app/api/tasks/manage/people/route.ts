// src/app/api/tasks/manage/people/route.ts  →  GET /v2/api/tasks/manage/people   (tasks-01)
// Assignee picker: active users with task_assignable = 1 → { ok, people, no_shift_count }.
// Middleware: tasks.manage view; canManageTasks re-checks.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { actorOf } from "@/lib/safety/records";
import { canManageTasks, fail, loadAssignablePeople } from "@/lib/tasks/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!actorOf(request.headers)) return fail(401, "Unauthorized");
  if (!canManageTasks(request.headers)) return fail(403, "Access denied.");
  try {
    const { DB } = await getEnv();
    const people = await loadAssignablePeople(DB);
    return NextResponse.json(
      { ok: true, people, no_shift_count: people.filter((p) => p.shift === null).length },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return fail(500, "Server error.", String(e?.message || e));
  }
}
