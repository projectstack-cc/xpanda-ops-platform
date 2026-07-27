// src/app/api/cutting/chunk-session/start/route.ts  →  POST /v2/api/cutting/chunk-session/start
// Starts a chunk-board session (Cross Cutter assignment or Hole Cutter slot). Operator identity
// comes from middleware-injected X-User-* headers — never from the request body.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

const HC_SLOTS = new Set(["8_hole", "10_hole"]);

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const body = await request.json();
    const { board, ref_id } = body ?? {};

    if (board !== "cc" && board !== "hc") {
      return NextResponse.json({ ok: false, error: "Invalid board." }, { status: 400 });
    }
    if (!ref_id) {
      return NextResponse.json({ ok: false, error: "ref_id is required." }, { status: 400 });
    }

    const operatorId = request.headers.get("X-User-Id") || "";
    const operatorName = request.headers.get("X-User-Name") || "";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (board === "cc") {
      const assignment = await DB.prepare(
        `SELECT id FROM cc_assignments WHERE id = ? AND status != 'complete' LIMIT 1`
      ).bind(ref_id).first<{ id: string }>();
      if (!assignment) {
        return NextResponse.json({ ok: false, error: "Invalid ref_id." }, { status: 400 });
      }
    } else if (!HC_SLOTS.has(ref_id)) {
      return NextResponse.json({ ok: false, error: "Invalid ref_id." }, { status: 400 });
    }

    // Guard: one open chunk_session per operator across both boards.
    const mineOpen = await DB.prepare(
      `SELECT board, ref_id FROM chunk_sessions
       WHERE operator_id = ? AND status = 'open' LIMIT 1`
    ).bind(operatorId).first<{ board: string; ref_id: string }>();
    if (mineOpen) {
      return NextResponse.json(
        { ok: false, error: "already_running", board: mineOpen.board, ref_id: mineOpen.ref_id },
        { status: 409 }
      );
    }

    // Guard: one open session per (board, ref_id).
    const existing = await DB.prepare(
      `SELECT operator_name FROM chunk_sessions
       WHERE board = ? AND ref_id = ? AND status = 'open' LIMIT 1`
    ).bind(board, ref_id).first<{ operator_name: string }>();
    if (existing) {
      return NextResponse.json(
        { ok: false, error: "line_busy", operator: existing.operator_name },
        { status: 409 }
      );
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const sessionId = crypto.randomUUID();

    const stmts: ReturnType<typeof DB.prepare>[] = [
      DB.prepare(
        `INSERT INTO chunk_sessions
           (id, board, ref_id, operator_id, operator_name, started_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 'open')`
      ).bind(sessionId, board, ref_id, operatorId, operatorName, now),
    ];
    if (board === "cc") {
      stmts.push(
        DB.prepare(
          `UPDATE cc_assignments SET status = 'in_progress' WHERE id = ? AND status = 'open'`
        ).bind(ref_id)
      );
    }
    await DB.batch(stmts);

    await DB.prepare(
      `INSERT INTO activity_log
         (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
       VALUES (?, ?, 'update', 'chunk_session', ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      now,
      sessionId,
      `${operatorName} started ${board === "cc" ? "Cross Cutter" : "Hole Cutter"} (${ref_id})`,
      JSON.stringify({ board, ref_id, session_id: sessionId }),
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
