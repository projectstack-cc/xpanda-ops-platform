// src/app/api/tasks/manage/templates/route.ts  →  GET / POST /v2/api/tasks/manage/templates   (tasks-01)
// The repeatable list. GET: active templates (+ inactive with ?include_inactive=1) with default assignees
// [{id,name,shift,assignable}], ordered use_count DESC, title. POST: title, details?, slot_start?, slot_end?,
// assignee_ids?[0..10] (each assignable). Templates never carry job links.
// Middleware: tasks.manage (GET view / POST edit); handlers re-check.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { actorOf } from "@/lib/safety/records";
import { checkSlot, MAX_ASSIGNEES } from "@/lib/tasks/board";
import {
  canEditTasks, canManageTasks, checkAssignees, fail, idList, loadTemplates, nowTs, validDetails, validTitle,
} from "@/lib/tasks/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!actorOf(request.headers)) return fail(401, "Unauthorized");
  if (!canManageTasks(request.headers)) return fail(403, "Access denied.");
  const includeInactive = request.nextUrl.searchParams.get("include_inactive") === "1";
  try {
    const { DB } = await getEnv();
    const templates = await loadTemplates(DB, { includeInactive });
    return NextResponse.json({ ok: true, templates }, { headers: { "Cache-Control": "no-store" } });
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
  const title = validTitle(body.title);
  if (!title.ok) return fail(400, title.error, title.detail);
  const details = validDetails(body.details);
  if (!details.ok) return fail(400, details.error, details.detail);
  const slot = checkSlot(body.slot_start, body.slot_end);
  if (!slot.ok) return fail(400, slot.error, "Time slot needs both start and end as HH:MM (24h), end after start.");
  const ids = body.assignee_ids === undefined || body.assignee_ids === null
    ? { ok: true as const, ids: [] as string[] }
    : idList(body.assignee_ids, 0, MAX_ASSIGNEES, "assignee_ids");
  if (!ids.ok) return fail(400, ids.error, ids.detail);

  try {
    const { DB } = await getEnv();
    const badA = await checkAssignees(DB, ids.ids);
    if (badA) return fail(400, badA.error, "Not assignable users.", { ids: badA.ids });
    const id = crypto.randomUUID();
    const ts = nowTs();
    await DB.batch([
      DB.prepare(
        `INSERT INTO task_templates (id, title, details, slot_start, slot_end, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, title.value, details.value, slot.start, slot.end, actor.id, ts),
      ...ids.ids.map((u) => DB.prepare(`INSERT INTO task_template_assignees (template_id, user_id) VALUES (?, ?)`).bind(id, u)),
    ]);
    await logActivity(DB, "create", "task_template", id, `Repeatable task "${title.value}" created`,
      { title: title.value, slot_start: slot.start, slot_end: slot.end, assignee_ids: ids.ids }, actor.id);
    const [row] = await loadTemplates(DB, { includeInactive: true, ids: [id] });
    return NextResponse.json({ ok: true, template: row ?? { id } });
  } catch (e: any) {
    return fail(500, "Server error.", String(e?.message || e));
  }
}
