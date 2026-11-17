// src/app/api/tasks/manage/templates/[id]/route.ts  →  PATCH / DELETE /v2/api/tasks/manage/templates/:id   (tasks-01)
// PATCH partial: title?, details?, slot_start?/slot_end? (merged with the stored slot), assignee_ids? (replaces the
// set), is_active? (reactivate). DELETE = deactivate (is_active = 0). Existing tasks are never touched.
// Middleware: tasks.manage edit; handlers re-check.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { actorOf } from "@/lib/safety/records";
import { checkSlot, MAX_ASSIGNEES } from "@/lib/tasks/board";
import {
  canEditTasks, checkAssignees, fail, idList, loadTemplates, nowTs, validDetails, validTitle,
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
    const [cur] = await loadTemplates(DB, { includeInactive: true, ids: [id] });
    if (!cur) return fail(404, "Template not found.");

    const sets: string[] = [];
    const binds: unknown[] = [];
    const changed: Record<string, unknown> = {};
    if (has(body, "title")) {
      const t = validTitle(body.title);
      if (!t.ok) return fail(400, t.error, t.detail);
      sets.push("title = ?"); binds.push(t.value); changed.title = t.value;
    }
    if (has(body, "details")) {
      const d = validDetails(body.details);
      if (!d.ok) return fail(400, d.error, d.detail);
      sets.push("details = ?"); binds.push(d.value); changed.details = d.value;
    }
    if (has(body, "slot_start") || has(body, "slot_end")) {
      const s = checkSlot(has(body, "slot_start") ? body.slot_start : cur.slot_start, has(body, "slot_end") ? body.slot_end : cur.slot_end);
      if (!s.ok) return fail(400, s.error, "Time slot needs both start and end as HH:MM (24h), end after start.");
      sets.push("slot_start = ?", "slot_end = ?"); binds.push(s.start, s.end); changed.slot_start = s.start; changed.slot_end = s.end;
    }
    if (has(body, "is_active")) {
      if (typeof body.is_active !== "boolean") return fail(400, "invalid_is_active", "is_active must be true or false.");
      sets.push("is_active = ?"); binds.push(body.is_active ? 1 : 0); changed.is_active = body.is_active;
    }
    let assignees: string[] | null = null;
    if (has(body, "assignee_ids")) {
      const l = idList(body.assignee_ids ?? [], 0, MAX_ASSIGNEES, "assignee_ids");
      if (!l.ok) return fail(400, l.error, l.detail);
      const badA = await checkAssignees(DB, l.ids);
      if (badA) return fail(400, badA.error, "Not assignable users.", { ids: badA.ids });
      assignees = l.ids;
      changed.assignee_ids = l.ids;
    }

    const ts = nowTs();
    sets.push("updated_at = ?"); binds.push(ts);
    const stmts = [DB.prepare(`UPDATE task_templates SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id)];
    if (assignees) {
      stmts.push(DB.prepare(`DELETE FROM task_template_assignees WHERE template_id = ?`).bind(id));
      for (const u of assignees) stmts.push(DB.prepare(`INSERT INTO task_template_assignees (template_id, user_id) VALUES (?, ?)`).bind(id, u));
    }
    await DB.batch(stmts);
    await logActivity(DB, "update", "task_template", id, `Repeatable task "${(changed.title as string) ?? cur.title}" updated`,
      { changed, before: { title: cur.title, slot_start: cur.slot_start, slot_end: cur.slot_end, is_active: cur.is_active,
        assignee_ids: cur.assignees.map((a) => a.id) } }, actor.id);
    const [row] = await loadTemplates(DB, { includeInactive: true, ids: [id] });
    return NextResponse.json({ ok: true, template: row ?? { id } });
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
    const cur = await DB.prepare(`SELECT title FROM task_templates WHERE id = ? AND is_active = 1`).bind(id).first<{ title: string }>();
    if (!cur) return fail(404, "Template not found.");
    await DB.prepare(`UPDATE task_templates SET is_active = 0, updated_at = ? WHERE id = ?`).bind(nowTs(), id).run();
    await logActivity(DB, "delete", "task_template", id, `Repeatable task "${cur.title}" removed from the list`, { title: cur.title }, actor.id);
    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return fail(500, "Server error.", String(e?.message || e));
  }
}
