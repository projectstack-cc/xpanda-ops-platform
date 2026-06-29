// POST /v2/api/cutting/line-item — set checklist completion for one (job, line, line_item).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const operatorId = request.headers.get("X-User-Id") || "";
    const operatorName = request.headers.get("X-User-Name") || "";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { job_id, line, line_item_id, completed } = body ?? {};
    if (!job_id || !line || !line_item_id || typeof completed !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "job_id, line, line_item_id, completed are required." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    await DB.prepare(
      `INSERT INTO cutting_line_progress
         (id, job_id, line, line_item_id, completed, completed_qty, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT (job_id, line, line_item_id)
       DO UPDATE SET completed = excluded.completed,
                     updated_by = excluded.updated_by,
                     updated_at = excluded.updated_at`
    ).bind(crypto.randomUUID(), job_id, line, line_item_id, completed ? 1 : 0, operatorId, now).run();

    await DB.prepare(
      `INSERT INTO activity_log
         (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
       VALUES (?, ?, 'update', 'cutting_line_progress', ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      now,
      line_item_id,
      `${operatorName} ${completed ? "checked" : "unchecked"} a part on ${line}`,
      JSON.stringify({ job_id, line, line_item_id, completed }),
      operatorId,
      now
    ).run();

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
