// src/app/v2/api/cutting/clock-out/route.ts  →  POST /v2/api/cutting/clock-out
// Closes the operator's open session and records the handoff note.
// Only the session owner may close it; admin override via X-User-Is-Admin header.
// Line stays in_progress — use complete-line to mark it done.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const body = await request.json();
    const { session_id, handoff_note = "", qty_done_delta } = body ?? {};

    if (!session_id) {
      return NextResponse.json(
        { ok: false, error: "session_id is required." },
        { status: 400 }
      );
    }

    const operatorId = request.headers.get("X-User-Id") || "";
    const operatorName = request.headers.get("X-User-Name") || "";
    const isAdmin = request.headers.get("X-User-Is-Admin") === "1";

    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const session = await DB.prepare(
      `SELECT id, job_id, line, operator_id, operator_name, status
       FROM cutting_sessions WHERE id = ? LIMIT 1`
    ).bind(session_id).first<{
      id: string;
      job_id: string;
      line: string;
      operator_id: string;
      operator_name: string;
      status: string;
    }>();

    if (!session) {
      return NextResponse.json({ ok: false, error: "Session not found." }, { status: 404 });
    }
    if (session.status !== "open") {
      return NextResponse.json({ ok: false, error: "Session is not open." }, { status: 400 });
    }
    if (session.operator_id !== operatorId && !isAdmin) {
      return NextResponse.json({ ok: false, error: "Access denied." }, { status: 403 });
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const hasQty = qty_done_delta != null && !isNaN(Number(qty_done_delta));
    const qtyVal = hasQty ? Number(qty_done_delta) : null;

    const stmts: ReturnType<typeof DB.prepare>[] = [
      hasQty
        ? DB.prepare(
            `UPDATE cutting_sessions
             SET status = 'closed', ended_at = ?, handoff_note = ?, qty_done_delta = ?
             WHERE id = ?`
          ).bind(now, handoff_note, qtyVal, session_id)
        : DB.prepare(
            `UPDATE cutting_sessions
             SET status = 'closed', ended_at = ?, handoff_note = ?
             WHERE id = ?`
          ).bind(now, handoff_note, session_id),
    ];

    if (hasQty && qtyVal) {
      stmts.push(
        DB.prepare(
          `UPDATE cutting_lines
           SET qty_done = COALESCE(qty_done, 0) + ?, updated_at = ?
           WHERE job_id = ? AND line = ?`
        ).bind(qtyVal, now, session.job_id, session.line)
      );
    }

    await DB.batch(stmts);

    await DB.prepare(
      `INSERT INTO activity_log
         (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
       VALUES (?, ?, 'update', 'cutting_session', ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      now,
      session_id,
      `${session.operator_name} clocked out of ${session.line}`,
      JSON.stringify({ job_id: session.job_id, line: session.line, handoff_note }),
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
