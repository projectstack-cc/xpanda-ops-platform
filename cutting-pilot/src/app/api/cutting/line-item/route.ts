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

    // cutting-ids-01: the line item must still exist on this job — never write progress for a
    // dead id — and its part identity is snapshotted onto the progress row for the report.
    const li = await DB.prepare(
      "SELECT part_number, description, dimensions FROM job_line_items WHERE id = ? AND job_id = ?"
    ).bind(String(line_item_id), job_id).first<{ part_number: string | null; description: string | null; dimensions: string | null }>();
    if (!li) {
      return NextResponse.json(
        { ok: false, code: "stale_line_item", error: "This order was edited — refresh the board." },
        { status: 409 }
      );
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    await DB.prepare(
      `INSERT INTO cutting_line_progress
         (id, job_id, line, line_item_id, completed, completed_qty, updated_by, updated_at,
          part_number, description, dimensions)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
       ON CONFLICT (job_id, line, line_item_id)
       DO UPDATE SET completed = excluded.completed,
                     updated_by = excluded.updated_by,
                     updated_at = excluded.updated_at,
                     part_number = excluded.part_number,
                     description = excluded.description,
                     dimensions = excluded.dimensions`
    ).bind(
      crypto.randomUUID(), job_id, line, line_item_id, completed ? 1 : 0, operatorId, now,
      li.part_number, li.description, li.dimensions
    ).run();

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
