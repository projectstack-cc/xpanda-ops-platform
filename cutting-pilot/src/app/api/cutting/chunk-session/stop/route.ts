// src/app/api/cutting/chunk-session/stop/route.ts  →  POST /v2/api/cutting/chunk-session/stop
// Closes the caller's own open chunk_session and records the reported counts.
// cc: { qty_done_delta }. hc: { holed_delta, on_hand } (on_hand is an absolute physical count).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

function nonNegInt(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const body = await request.json();

    const operatorId = request.headers.get("X-User-Id") || "";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const session = await DB.prepare(
      `SELECT id, board, ref_id, operator_name FROM chunk_sessions
       WHERE operator_id = ? AND status = 'open' LIMIT 1`
    ).bind(operatorId).first<{
      id: string;
      board: string;
      ref_id: string;
      operator_name: string;
    }>();

    if (!session) {
      return NextResponse.json({ ok: false, error: "No open session." }, { status: 404 });
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    const stmts: ReturnType<typeof DB.prepare>[] = [
      DB.prepare(
        `UPDATE chunk_sessions SET status = 'closed', ended_at = ? WHERE id = ?`
      ).bind(now, session.id),
    ];

    if (session.board === "cc") {
      const delta = nonNegInt(body?.qty_done_delta);
      stmts.push(
        DB.prepare(
          `UPDATE cc_assignments SET qty_done = qty_done + ? WHERE id = ?`
        ).bind(delta, session.ref_id)
      );
    } else {
      const holedDelta = nonNegInt(body?.holed_delta);
      const onHand = nonNegInt(body?.on_hand);
      stmts.push(
        DB.prepare(
          `UPDATE hc_slots SET total_holed = total_holed + ?, on_hand = ?, updated_at = ?
           WHERE slot_key = ?`
        ).bind(holedDelta, onHand, now, session.ref_id)
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
      session.id,
      `${session.operator_name} stopped ${session.board === "cc" ? "Cross Cutter" : "Hole Cutter"} (${session.ref_id})`,
      JSON.stringify({ board: session.board, ref_id: session.ref_id, body }),
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
