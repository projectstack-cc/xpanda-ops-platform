// src/app/api/tasks/manage/crews/[id]/route.ts  →  PATCH / DELETE /v2/api/tasks/manage/crews/:id   (tasks-01)
// PATCH name?, member_ids? (replaces the set; 2..10, each assignable), is_active?. DELETE = deactivate (frees the
// name). Never rewrites existing tasks. Middleware: tasks.manage edit; handlers re-check.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { actorOf } from "@/lib/safety/records";
import { MAX_ASSIGNEES } from "@/lib/tasks/board";
import {
  CREW_NAME_MAX, canEditTasks, checkAssignees, crewNameTaken, fail, idList, isUniqueViolation, loadCrews, nowTs,
} from "@/lib/tasks/db";

type Ctx = { params: { id: string } };
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const actor = actorOf(request.headers);
  if (!actor) return fail(401, "Unauthorized");
  if (!canEditTasks(request.headers)) return fail(403, "Access denied.");
  const id = String(params?.id ?? "").trim();
  if (!id) return fail(400, "Missing id");

  let body: any;
  try { body = await request.json(); } catch { return fail(400, "Invalid JSON"); }
  if (!body || typeof body !== "object") return fail(400, "Invalid JSON");

  try {
    const { DB } = await getEnv();
    const [cur] = await loadCrews(DB, { includeInactive: true, ids: [id] });
    if (!cur) return fail(404, "Crew not found.");

    const sets: string[] = [];
    const binds: unknown[] = [];
    const changed: Record<string, unknown> = {};
    let name = cur.name;
    if (has(body, "name")) {
      name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return fail(400, "name_required", "Crew name is required.");
      if (name.length > CREW_NAME_MAX) return fail(400, "name_too_long", `Max ${CREW_NAME_MAX} characters.`);
      sets.push("name = ?"); binds.push(name); changed.name = name;
    }
    let active = cur.is_active;
    if (has(body, "is_active")) {
      if (typeof body.is_active !== "boolean") return fail(400, "invalid_is_active", "is_active must be true or false.");
      active = body.is_active;
      sets.push("is_active = ?"); binds.push(active ? 1 : 0); changed.is_active = active;
    }
    if (active && (has(body, "name") || (has(body, "is_active") && !cur.is_active)) && (await crewNameTaken(DB, name, id))) {
      return fail(409, "crew_name_taken", `A crew named "${name}" already exists.`);
    }
    let members: string[] | null = null;
    if (has(body, "member_ids")) {
      const l = idList(body.member_ids, 2, MAX_ASSIGNEES, "member_ids");
      if (!l.ok) return fail(400, l.error, l.detail);
      const badA = await checkAssignees(DB, l.ids);
      if (badA) return fail(400, badA.error, "Not assignable users.", { ids: badA.ids });
      members = l.ids;
      changed.member_ids = l.ids;
    }

    sets.push("updated_at = ?"); binds.push(nowTs());
    const stmts = [DB.prepare(`UPDATE task_crews SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id)];
    if (members) {
      stmts.push(DB.prepare(`DELETE FROM task_crew_members WHERE crew_id = ?`).bind(id));
      for (const u of members) stmts.push(DB.prepare(`INSERT INTO task_crew_members (crew_id, user_id) VALUES (?, ?)`).bind(id, u));
    }
    try {
      await DB.batch(stmts);
    } catch (e) {
      if (isUniqueViolation(e)) return fail(409, "crew_name_taken", `A crew named "${name}" already exists.`);
      throw e;
    }
    await logActivity(DB, "update", "task_crew", id, `Crew "${name}" updated`,
      { changed, before: { name: cur.name, is_active: cur.is_active, member_ids: cur.members.map((m) => m.id) } }, actor.id);
    const [row] = await loadCrews(DB, { includeInactive: true, ids: [id] });
    return NextResponse.json({ ok: true, crew: row ?? { id } });
  } catch (e: any) {
    return fail(500, "Server error.", String(e?.message || e));
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const actor = actorOf(request.headers);
  if (!actor) return fail(401, "Unauthorized");
  if (!canEditTasks(request.headers)) return fail(403, "Access denied.");
  const id = String(params?.id ?? "").trim();
  if (!id) return fail(400, "Missing id");
  try {
    const { DB } = await getEnv();
    const cur = await DB.prepare(`SELECT name FROM task_crews WHERE id = ? AND is_active = 1`).bind(id).first<{ name: string }>();
    if (!cur) return fail(404, "Crew not found.");
    await DB.prepare(`UPDATE task_crews SET is_active = 0, updated_at = ? WHERE id = ?`).bind(nowTs(), id).run();
    await logActivity(DB, "delete", "task_crew", id, `Crew "${cur.name}" deactivated`, { name: cur.name }, actor.id);
    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return fail(500, "Server error.", String(e?.message || e));
  }
}
