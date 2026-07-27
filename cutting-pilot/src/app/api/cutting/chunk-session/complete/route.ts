// src/app/api/cutting/chunk-session/complete/route.ts  →  POST /v2/api/cutting/chunk-session/complete
// cc: marks the assignment complete and drops it off the queue. hc: no-op on inventory — the
// slots persist forever, only the caller's open session (if any) is closed.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

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

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    // Best-effort: close the caller's own open session for this ref, if present.
    await DB.prepare(
      `UPDATE chunk_sessions SET status = 'closed', ended_at = ?
       WHERE operator_id = ? AND board = ? AND ref_id = ? AND status = 'open'`
    ).bind(now, operatorId, board, ref_id).run();

    if (board === "cc") {
      await DB.prepare(
        `UPDATE cc_assignments SET status = 'complete', completed_at = ? WHERE id = ?`
      ).bind(now, ref_id).run();
    }
    // hc: no inventory mutation — slots persist regardless of completion.

    await DB.prepare(
      `INSERT INTO activity_log
         (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
       VALUES (?, ?, 'update', 'chunk_session', ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      now,
      ref_id,
      `${operatorName} completed ${board === "cc" ? "Cross Cutter" : "Hole Cutter"} (${ref_id})`,
      JSON.stringify({ board, ref_id }),
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
