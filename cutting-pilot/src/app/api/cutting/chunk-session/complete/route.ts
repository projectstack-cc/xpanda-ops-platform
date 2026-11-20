// src/app/api/cutting/chunk-session/complete/route.ts  →  POST /v2/api/cutting/chunk-session/complete
// cc: body { board:"cc", ref_id, qty_done_delta } — qty_done_delta is REQUIRED (whole number ≥ 0,
// no upper bound, never clamped to target_chunks; over-target yield is recorded as cut). In one
// DB.batch: closes the caller's own open session for this ref (if any), adds qty_done_delta to
// qty_done and marks the assignment complete (drops off the queue). Returns
// { ok:true, qty_done, target_chunks }.
// hc: body { board:"hc", ref_id } — no-op on inventory (slots persist forever); only the caller's
// open session (if any) is closed. qty_done_delta is ignored. Returns { ok:true }.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const body = await request.json();
    const { board, ref_id } = body ?? {};
    const rawDelta = body?.qty_done_delta;

    if (board !== "cc" && board !== "hc") {
      return NextResponse.json({ ok: false, error: "Invalid board." }, { status: 400 });
    }
    if (!ref_id) {
      return NextResponse.json({ ok: false, error: "ref_id is required." }, { status: 400 });
    }
    // cc: qty_done_delta required — finite whole number ≥ 0, no max (yield can beat the target).
    if (
      board === "cc" &&
      !(typeof rawDelta === "number" && Number.isFinite(rawDelta) && Number.isInteger(rawDelta) && rawDelta >= 0)
    ) {
      return NextResponse.json(
        { ok: false, error: "qty_done_delta is required (whole number ≥ 0)." },
        { status: 400 }
      );
    }

    const operatorId = request.headers.get("X-User-Id") || "";
    const operatorName = request.headers.get("X-User-Name") || "";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    // Close the caller's own open session for this ref, if present (best-effort: may match 0 rows).
    const closeSession = DB.prepare(
      `UPDATE chunk_sessions SET status = 'closed', ended_at = ?
       WHERE operator_id = ? AND board = ? AND ref_id = ? AND status = 'open'`
    ).bind(now, operatorId, board, ref_id);

    if (board === "cc") {
      const delta = rawDelta as number;
      await DB.batch([
        closeSession,
        DB.prepare(
          `UPDATE cc_assignments SET qty_done = qty_done + ?, status = 'complete', completed_at = ? WHERE id = ?`
        ).bind(delta, now, ref_id),
      ]);

      const row = await DB.prepare(
        `SELECT label, qty_done, target_chunks FROM cc_assignments WHERE id = ?`
      ).bind(ref_id).first<{ label: string | null; qty_done: number; target_chunks: number }>();
      const qtyDone = row?.qty_done ?? 0;
      const targetChunks = row?.target_chunks ?? 0;
      const overTarget = targetChunks > 0 && qtyDone > targetChunks;

      await DB.prepare(
        `INSERT INTO activity_log
           (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
         VALUES (?, ?, 'update', 'chunk_session', ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        now,
        ref_id,
        `${operatorName} completed Cross Cutter (${row?.label || ref_id}) — ${delta} this run, ${qtyDone} total`,
        JSON.stringify({
          board,
          ref_id,
          qty_done_delta: delta,
          qty_done: qtyDone,
          target_chunks: targetChunks,
          over_target: overTarget,
        }),
        operatorId,
        now
      ).run();

      return NextResponse.json({ ok: true, qty_done: qtyDone, target_chunks: targetChunks });
    }

    // hc: no inventory mutation — slots persist regardless of completion.
    await closeSession.run();

    await DB.prepare(
      `INSERT INTO activity_log
         (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
       VALUES (?, ?, 'update', 'chunk_session', ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      now,
      ref_id,
      `${operatorName} completed Hole Cutter (${ref_id})`,
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
