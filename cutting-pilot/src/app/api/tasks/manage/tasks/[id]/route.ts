// src/app/api/tasks/manage/tasks/[id]/route.ts  →  PATCH / DELETE /v2/api/tasks/manage/tasks/:id   (tasks-01)
// PATCH: partial update of any create field except save_as_template / template_id. assignee_ids / job_ids, when
// present, REPLACE the sets (delete + insert in one DB.batch). A slot change merges with the stored slot (send
// both null to clear). Moving task_date is allowed (weekends too). Deleted / unknown task → 404.
// DELETE: soft delete (deleted_at). Already deleted → 404.
// Middleware: tasks.manage edit; canEditTasks re-checks.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { actorOf } from "@/lib/safety/records";
import {
  canEditTasks, checkAssignees, checkJobs, fail, loadTasksByIds, nowTs, toManageRow, validateTaskBody,
} from "@/lib/tasks/db";

type Ctx = { params: { id: string } };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const actor = actorOf(request.headers);
  if (!actor) return fail(401, "Unauthorized");
  if (!canEditTasks(request.headers)) return fail(403, "Access denied.");
  const id = String(params?.id ?? "").trim();
  if (!id) return fail(400, "Missing id");

  let body: any;
  try { body = await request.json(); } catch { return fail(400, "Invalid JSON"); }

  try {
    const { DB } = await getEnv();
    const [cur] = await loadTasksByIds(DB, [id]);
    if (!cur) return fail(404, "Task not found.");

    const v = validateTaskBody(body, { partial: true, current: { slot_start: cur.slot_start, slot_end: cur.slot_end } });
    if (!v.ok) return fail(400, v.error, v.detail);
    const f = v.value;

    if (f.assignee_ids) {
      const badA = await checkAssignees(DB, f.assignee_ids);
      if (badA) return fail(400, badA.error, "Not assignable users.", { ids: badA.ids });
    }
    if (f.job_ids && f.job_ids.length) {
      const badJ = await checkJobs(DB, f.job_ids);
      if (badJ) return fail(400, badJ.error, "Unknown jobs.", { ids: badJ.ids });
    }
    if (f.crew_id) {
      const c = await DB.prepare(`SELECT id FROM task_crews WHERE id = ?`).bind(f.crew_id).first();
      if (!c) return fail(400, "unknown_crew", `No crew "${f.crew_id}".`);
    }

    const sets: string[] = [];
    const binds: unknown[] = [];
    for (const k of ["task_date", "title", "details", "slot_start", "slot_end", "crew_id"] as const) {
      if (k in f) { sets.push(`${k} = ?`); binds.push((f as any)[k] ?? null); }
    }
    const ts = nowTs();
    sets.push("updated_at = ?");
    binds.push(ts);

    const stmts = [
      DB.prepare(`UPDATE daily_tasks SET ${sets.join(", ")} WHERE id = ? AND deleted_at IS NULL`).bind(...binds, id),
    ];
    if (f.assignee_ids) {
      stmts.push(DB.prepare(`DELETE FROM daily_task_assignees WHERE task_id = ?`).bind(id));
      for (const u of f.assignee_ids) stmts.push(DB.prepare(`INSERT INTO daily_task_assignees (task_id, user_id) VALUES (?, ?)`).bind(id, u));
    }
    if (f.job_ids) {
      stmts.push(DB.prepare(`DELETE FROM daily_task_jobs WHERE task_id = ?`).bind(id));
      for (const j of f.job_ids) stmts.push(DB.prepare(`INSERT INTO daily_task_jobs (task_id, job_id) VALUES (?, ?)`).bind(id, j));
    }
    const res = await DB.batch(stmts);
    if (!res[0].meta?.changes) return fail(404, "Task not found.");

    await logActivity(
      DB, "update", "daily_task", id, `Daily task "${f.title ?? cur.title}" updated (${Object.keys(f).join(", ") || "no fields"})`,
      { changed: f, before: { task_date: cur.task_date, title: cur.title, slot_start: cur.slot_start, slot_end: cur.slot_end,
        assignee_ids: cur.assignees.map((a) => a.id), job_ids: cur.jobs.map((j) => j.job_id), crew_id: cur.crew_id } },
      actor.id
    );
    const [row] = await loadTasksByIds(DB, [id]);
    return NextResponse.json({ ok: true, task: row ? toManageRow(row) : { id } });
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
    const cur = await DB.prepare(`SELECT title, task_date FROM daily_tasks WHERE id = ? AND deleted_at IS NULL`)
      .bind(id).first<{ title: string; task_date: string }>();
    if (!cur) return fail(404, "Task not found.");
    const ts = nowTs();
    const res = await DB.prepare(`UPDATE daily_tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
      .bind(ts, ts, id).run();
    if (!res.meta?.changes) return fail(404, "Task not found.");
    await logActivity(DB, "delete", "daily_task", id, `Daily task "${cur.title}" on ${cur.task_date} deleted`,
      { title: cur.title, task_date: cur.task_date }, actor.id);
    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return fail(500, "Server error.", String(e?.message || e));
  }
}
