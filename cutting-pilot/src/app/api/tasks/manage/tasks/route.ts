// src/app/api/tasks/manage/tasks/route.ts  →  POST /v2/api/tasks/manage/tasks   (tasks-01)
// Create one daily task. Body: task_date, title, details?, slot_start?, slot_end?, assignee_ids[1..10], job_ids?[0..5],
// crew_id? (label only — must exist, inactive OK), template_id? (must exist; use_count bumped), save_as_template?.
// save_as_template also writes a task_templates row (title, details, slot) + its default assignees — NEVER jobs —
// and the new task is linked to it. Task + assignees + jobs (+ template) go in ONE DB.batch.
// Middleware: tasks.manage edit (POST); canEditTasks re-checks.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { actorOf } from "@/lib/safety/records";
import {
  canEditTasks, checkAssignees, checkJobs, fail, insertTaskStmt, loadTasksByIds, nowTs, toManageRow, validateTaskBody,
} from "@/lib/tasks/db";

export async function POST(request: NextRequest) {
  const actor = actorOf(request.headers);
  if (!actor) return fail(401, "Unauthorized");
  if (!canEditTasks(request.headers)) return fail(403, "Access denied.");

  let body: any;
  try { body = await request.json(); } catch { return fail(400, "Invalid JSON"); }
  const v = validateTaskBody(body, { partial: false });
  if (!v.ok) return fail(400, v.error, v.detail);
  const f = v.value;

  if (body.save_as_template !== undefined && typeof body.save_as_template !== "boolean") {
    return fail(400, "invalid_save_as_template", "save_as_template must be true or false.");
  }
  const saveAsTemplate = body.save_as_template === true;
  let templateId: string | null = null;
  if (body.template_id !== undefined && body.template_id !== null && body.template_id !== "") {
    if (typeof body.template_id !== "string") return fail(400, "invalid_template_id");
    templateId = body.template_id.trim();
  }
  if (saveAsTemplate && templateId) {
    return fail(400, "template_conflict", "A task from the repeatable list can't also be saved as a new template.");
  }

  try {
    const { DB } = await getEnv();
    const badA = await checkAssignees(DB, f.assignee_ids!);
    if (badA) return fail(400, badA.error, "Not assignable users.", { ids: badA.ids });
    const badJ = await checkJobs(DB, f.job_ids!);
    if (badJ) return fail(400, badJ.error, "Unknown jobs.", { ids: badJ.ids });
    if (f.crew_id) {
      const c = await DB.prepare(`SELECT id FROM task_crews WHERE id = ?`).bind(f.crew_id).first();
      if (!c) return fail(400, "unknown_crew", `No crew "${f.crew_id}".`);
    }
    if (templateId) {
      const t = await DB.prepare(`SELECT id FROM task_templates WHERE id = ?`).bind(templateId).first();
      if (!t) return fail(400, "unknown_template", `No template "${templateId}".`);
    }

    const ts = nowTs();
    const id = crypto.randomUUID();
    const newTemplateId = saveAsTemplate ? crypto.randomUUID() : null;
    const stmts = [];
    if (newTemplateId) {
      stmts.push(
        DB.prepare(
          `INSERT INTO task_templates (id, title, details, slot_start, slot_end, use_count, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
        ).bind(newTemplateId, f.title!, f.details ?? null, f.slot_start ?? null, f.slot_end ?? null, actor.id, ts),
        ...f.assignee_ids!.map((u) =>
          DB.prepare(`INSERT INTO task_template_assignees (template_id, user_id) VALUES (?, ?)`).bind(newTemplateId, u)
        )
      );
    }
    stmts.push(
      insertTaskStmt(DB, {
        id, task_date: f.task_date!, title: f.title!, details: f.details ?? null, slot_start: f.slot_start ?? null,
        slot_end: f.slot_end ?? null, template_id: templateId ?? newTemplateId, crew_id: f.crew_id ?? null,
        created_by: actor.id, created_at: ts,
      }),
      ...f.assignee_ids!.map((u) => DB.prepare(`INSERT INTO daily_task_assignees (task_id, user_id) VALUES (?, ?)`).bind(id, u)),
      ...f.job_ids!.map((j) => DB.prepare(`INSERT INTO daily_task_jobs (task_id, job_id) VALUES (?, ?)`).bind(id, j))
    );
    if (templateId) {
      stmts.push(DB.prepare(`UPDATE task_templates SET use_count = use_count + 1 WHERE id = ?`).bind(templateId));
    }
    await DB.batch(stmts);

    await logActivity(
      DB, "create", "daily_task", id,
      `Daily task "${f.title}" on ${f.task_date} for ${f.assignee_ids!.length} ${f.assignee_ids!.length === 1 ? "person" : "people"}`,
      { task_date: f.task_date, title: f.title, slot_start: f.slot_start, slot_end: f.slot_end, assignee_ids: f.assignee_ids,
        job_ids: f.job_ids, crew_id: f.crew_id, template_id: templateId ?? newTemplateId },
      actor.id
    );
    if (newTemplateId) {
      await logActivity(
        DB, "create", "task_template", newTemplateId, `Repeatable task "${f.title}" saved`,
        { title: f.title, slot_start: f.slot_start, slot_end: f.slot_end, assignee_ids: f.assignee_ids, from_task_id: id },
        actor.id
      );
    }

    const [row] = await loadTasksByIds(DB, [id]);
    return NextResponse.json({ ok: true, task: row ? toManageRow(row) : { id } });
  } catch (e: any) {
    return fail(500, "Server error.", String(e?.message || e));
  }
}
