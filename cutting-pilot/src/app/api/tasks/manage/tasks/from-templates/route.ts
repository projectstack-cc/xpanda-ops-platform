// src/app/api/tasks/manage/tasks/from-templates/route.ts  →  POST /v2/api/tasks/manage/tasks/from-templates   (tasks-01)
// Body { task_date, template_ids[1..20] }. One task per template (title / details / slot) with its default assignees
// filtered to CURRENTLY assignable users. A template left with nobody → skipped
// ({ template_id, reason: "no_assignable_people" }). Inactive / unknown template → 400. Each used template's
// use_count is bumped. One DB.batch. Middleware: tasks.manage edit (POST); canEditTasks re-checks.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { actorOf, isValidYmd } from "@/lib/safety/records";
import {
  canEditTasks, fail, idList, insertTaskStmt, loadTasksByIds, loadTemplates, nowTs, toManageRow,
} from "@/lib/tasks/db";

const MAX_TEMPLATES = 20;

export async function POST(request: NextRequest) {
  const actor = actorOf(request.headers);
  if (!actor) return fail(401, "Unauthorized");
  if (!canEditTasks(request.headers)) return fail(403, "Access denied.");

  let body: any;
  try { body = await request.json(); } catch { return fail(400, "Invalid JSON"); }
  if (!body || typeof body !== "object") return fail(400, "Invalid JSON");
  if (!isValidYmd(body.task_date)) return fail(400, "invalid_date", "task_date must be YYYY-MM-DD.");
  const taskDate: string = body.task_date;
  const list = idList(body.template_ids, 1, MAX_TEMPLATES, "template_ids");
  if (!list.ok) return fail(400, list.error, list.detail);

  try {
    const { DB } = await getEnv();
    const templates = await loadTemplates(DB, { includeInactive: true, ids: list.ids });
    const byId = new Map(templates.map((t) => [t.id, t]));
    const unknown = list.ids.filter((i) => !byId.has(i));
    if (unknown.length) return fail(400, "unknown_template", "Unknown templates.", { ids: unknown });
    const inactive = list.ids.filter((i) => !byId.get(i)!.is_active);
    if (inactive.length) return fail(400, "inactive_template", "Templates are no longer in the repeatable list.", { ids: inactive });

    const ts = nowTs();
    const stmts = [];
    const created: { id: string; template_id: string; title: string; assignee_ids: string[] }[] = [];
    const skipped: { template_id: string; reason: "no_assignable_people" }[] = [];
    for (const tid of list.ids) {
      const t = byId.get(tid)!;
      const people = t.assignees.filter((a) => a.assignable).map((a) => a.id);
      if (!people.length) { skipped.push({ template_id: tid, reason: "no_assignable_people" }); continue; }
      const id = crypto.randomUUID();
      stmts.push(
        insertTaskStmt(DB, {
          id, task_date: taskDate, title: t.title, details: t.details, slot_start: t.slot_start, slot_end: t.slot_end,
          template_id: tid, crew_id: null, created_by: actor.id, created_at: ts,
        }),
        ...people.map((u) => DB.prepare(`INSERT INTO daily_task_assignees (task_id, user_id) VALUES (?, ?)`).bind(id, u)),
        DB.prepare(`UPDATE task_templates SET use_count = use_count + 1 WHERE id = ?`).bind(tid)
      );
      created.push({ id, template_id: tid, title: t.title, assignee_ids: people });
    }
    if (stmts.length) await DB.batch(stmts);

    for (const c of created) {
      await logActivity(
        DB, "create", "daily_task", c.id, `Daily task "${c.title}" on ${taskDate} from the repeatable list`,
        { task_date: taskDate, template_id: c.template_id, assignee_ids: c.assignee_ids }, actor.id
      );
    }
    const rows = await loadTasksByIds(DB, created.map((c) => c.id));
    return NextResponse.json({ ok: true, created: rows.map(toManageRow), skipped });
  } catch (e: any) {
    return fail(500, "Server error.", String(e?.message || e));
  }
}
