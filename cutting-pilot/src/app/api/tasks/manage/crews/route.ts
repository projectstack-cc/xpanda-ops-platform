// src/app/api/tasks/manage/crews/route.ts  →  GET / POST /v2/api/tasks/manage/crews   (tasks-01)
// Saved crews (named groups of users). Picking a crew in the UI expands to individual assignees at save time; tasks
// keep crew_id only as a label. GET: active crews with members [{id,name,shift,assignable}], by name.
// POST { name (1–40), member_ids[2..10] (each assignable) }. Duplicate active name (case-insensitive) → 409.
// Middleware: tasks.manage (GET view / POST edit); handlers re-check.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { actorOf } from "@/lib/safety/records";
import { MAX_ASSIGNEES } from "@/lib/tasks/board";
import {
  CREW_NAME_MAX, canEditTasks, canManageTasks, checkAssignees, crewNameTaken, fail, idList, isUniqueViolation, loadCrews, nowTs,
} from "@/lib/tasks/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!actorOf(request.headers)) return fail(401, "Unauthorized");
  if (!canManageTasks(request.headers)) return fail(403, "Access denied.");
  try {
    const { DB } = await getEnv();
    return NextResponse.json({ ok: true, crews: await loadCrews(DB) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return fail(500, "Server error.", String(e?.message || e));
  }
}

export async function POST(request: NextRequest) {
  const actor = actorOf(request.headers);
  if (!actor) return fail(401, "Unauthorized");
  if (!canEditTasks(request.headers)) return fail(403, "Access denied.");

  let body: any;
  try { body = await request.json(); } catch { return fail(400, "Invalid JSON"); }
  if (!body || typeof body !== "object") return fail(400, "Invalid JSON");
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return fail(400, "name_required", "Crew name is required.");
  if (name.length > CREW_NAME_MAX) return fail(400, "name_too_long", `Max ${CREW_NAME_MAX} characters.`);
  const members = idList(body.member_ids, 2, MAX_ASSIGNEES, "member_ids");
  if (!members.ok) return fail(400, members.error, members.detail);

  try {
    const { DB } = await getEnv();
    const badA = await checkAssignees(DB, members.ids);
    if (badA) return fail(400, badA.error, "Not assignable users.", { ids: badA.ids });
    if (await crewNameTaken(DB, name, null)) return fail(409, "crew_name_taken", `A crew named "${name}" already exists.`);
    const id = crypto.randomUUID();
    try {
      await DB.batch([
        DB.prepare(`INSERT INTO task_crews (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`).bind(id, name, actor.id, nowTs()),
        ...members.ids.map((u) => DB.prepare(`INSERT INTO task_crew_members (crew_id, user_id) VALUES (?, ?)`).bind(id, u)),
      ]);
    } catch (e) {
      if (isUniqueViolation(e)) return fail(409, "crew_name_taken", `A crew named "${name}" already exists.`);
      throw e;
    }
    await logActivity(DB, "create", "task_crew", id, `Crew "${name}" created (${members.ids.length} people)`,
      { name, member_ids: members.ids }, actor.id);
    const [row] = await loadCrews(DB, { includeInactive: true, ids: [id] });
    return NextResponse.json({ ok: true, crew: row ?? { id } });
  } catch (e: any) {
    return fail(500, "Server error.", String(e?.message || e));
  }
}
