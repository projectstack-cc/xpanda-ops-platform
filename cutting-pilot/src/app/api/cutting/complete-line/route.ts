// src/app/v2/api/cutting/complete-line/route.ts  →  POST /v2/api/cutting/complete-line
// Marks a cutting line complete and closes any lingering open session.
// When ALL required lines for a job reach 'complete', fires a one-directional
// jobs.status='done' signal to the job board (never downgrades further statuses).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

const PROCESS_ORDER = ["Cross Cutter", "Hole Cutter", "Main Line", "Blue Line", "Laminate"];

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const body = await request.json();
    const { job_id, line, handoff_note = "" } = body ?? {};

    if (!job_id || !line) {
      return NextResponse.json(
        { ok: false, error: "job_id and line are required." },
        { status: 400 }
      );
    }
    if (!PROCESS_ORDER.includes(line)) {
      return NextResponse.json({ ok: false, error: "Invalid line." }, { status: 400 });
    }

    const operatorId = request.headers.get("X-User-Id") || "";
    const operatorName = request.headers.get("X-User-Name") || "";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    // Close any lingering open session on this line before marking complete
    const openSession = await DB.prepare(
      `SELECT id FROM cutting_sessions
       WHERE job_id = ? AND line = ? AND status = 'open' LIMIT 1`
    ).bind(job_id, line).first<{ id: string }>();

    const stmts: ReturnType<typeof DB.prepare>[] = [
      DB.prepare(
        `UPDATE cutting_lines
         SET line_status = 'complete', updated_at = ?
         WHERE job_id = ? AND line = ?`
      ).bind(now, job_id, line),
    ];

    if (openSession) {
      stmts.push(
        DB.prepare(
          `UPDATE cutting_sessions
           SET status = 'closed', ended_at = ?, handoff_note = ?
           WHERE id = ?`
        ).bind(now, handoff_note, openSession.id)
      );
    }

    await DB.batch(stmts);

    // Check if all required cutting_lines for this job are now complete
    const lineRows = await DB.prepare(
      `SELECT line_status FROM cutting_lines WHERE job_id = ?`
    ).bind(job_id).all<{ line_status: string }>();

    const all = lineRows.results || [];
    const allComplete = all.length > 0 && all.every((r) => r.line_status === "complete");

    if (allComplete) {
      // One-directional signal: never downgrade loading/shipped/archived
      await DB.prepare(
        `UPDATE jobs SET status = 'done', updated_at = ?
         WHERE id = ? AND status IN ('not_started','in_production')`
      ).bind(now, job_id).run();

      await DB.prepare(
        `INSERT INTO activity_log
           (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
         VALUES (?, ?, 'update', 'job', ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        now,
        job_id,
        "All cutting lines complete — job marked done",
        JSON.stringify({ job_id, triggered_by_line: line, triggered_by: operatorName }),
        operatorId,
        now
      ).run();
    }

    // Activity log for the line completion
    await DB.prepare(
      `INSERT INTO activity_log
         (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
       VALUES (?, ?, 'update', 'cutting_line', ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      now,
      `${job_id}:${line}`,
      `${operatorName} marked ${line} complete`,
      JSON.stringify({ job_id, line }),
      operatorId,
      now
    ).run();

    return NextResponse.json({ ok: true, all_lines_complete: allComplete });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
