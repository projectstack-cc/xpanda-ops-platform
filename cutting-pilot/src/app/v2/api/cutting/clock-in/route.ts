// src/app/v2/api/cutting/clock-in/route.ts  →  POST /v2/api/cutting/clock-in
// Clocks an operator into a cutting line. Operator identity comes from middleware-injected
// X-User-* headers — never from the request body.
// Returns 409 if an open session already exists for this (job_id, line).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

const PROCESS_ORDER = ["Cross Cutter", "Hole Cutter", "Main Line", "Blue Line", "Laminate"];

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const body = await request.json();
    const { job_id, line } = body ?? {};

    if (!job_id || !line) {
      return NextResponse.json(
        { ok: false, error: "job_id and line are required." },
        { status: 400 }
      );
    }
    if (!PROCESS_ORDER.includes(line)) {
      return NextResponse.json({ ok: false, error: "Invalid line." }, { status: 400 });
    }

    // Operator identity is authoritative from session headers, not the client body.
    const operatorId = request.headers.get("X-User-Id") || "";
    const operatorName = request.headers.get("X-User-Name") || "";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // Guard: one operator per line at a time.
    const existing = await DB.prepare(
      `SELECT id, operator_name FROM cutting_sessions
       WHERE job_id = ? AND line = ? AND status = 'open' LIMIT 1`
    ).bind(job_id, line).first<{ id: string; operator_name: string }>();

    if (existing) {
      return NextResponse.json(
        { ok: false, error: "line_busy", operator: existing.operator_name },
        { status: 409 }
      );
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const sessionId = crypto.randomUUID();
    const sortOrder = PROCESS_ORDER.indexOf(line);

    await DB.batch([
      // Open the session
      DB.prepare(
        `INSERT INTO cutting_sessions
           (id, job_id, line, operator_id, operator_name, status, started_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`
      ).bind(sessionId, job_id, line, operatorId, operatorName, now, now),

      // Lazy reconcile the line row (in case clock-in fires before the first queue fetch)
      DB.prepare(
        `INSERT OR IGNORE INTO cutting_lines
           (id, job_id, line, line_status, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, 'not_started', ?, ?, ?)`
      ).bind(crypto.randomUUID(), job_id, line, sortOrder, now, now),

      // Flip not_started → in_progress (never downgrade from complete)
      DB.prepare(
        `UPDATE cutting_lines
         SET line_status = 'in_progress', updated_at = ?
         WHERE job_id = ? AND line = ? AND line_status = 'not_started'`
      ).bind(now, job_id, line),

      // Bump job from not_started → in_production (one-directional)
      DB.prepare(
        `UPDATE jobs SET status = 'in_production', updated_at = ?
         WHERE id = ? AND status = 'not_started'`
      ).bind(now, job_id),
    ]);

    // Activity log (shared D1 table, same schema as legacy)
    await DB.prepare(
      `INSERT INTO activity_log
         (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
       VALUES (?, ?, 'update', 'cutting_session', ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      now,
      sessionId,
      `${operatorName} clocked in to ${line}`,
      JSON.stringify({ job_id, line, session_id: sessionId }),
      operatorId,
      now
    ).run();

    return NextResponse.json({ ok: true, session_id: sessionId });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
