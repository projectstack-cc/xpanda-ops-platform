// src/app/api/cutting/chunk-session/stop/route.ts  →  POST /v2/api/cutting/chunk-session/stop
// Closes the caller's own open chunk_session and records the reported counts.
// cc (cc-blocks-01): { block_ids: string[] } — the IDs ("MM/DD-XX") of the blocks used this run;
//   missing = [] (0 blocks this run is allowed). The count is derived server-side (= ids.length);
//   qty_done_delta is IGNORED for cc from cc-blocks-01 on. Errors: 400 invalid_block_id { invalid },
//   400 duplicate_in_request { duplicates }, 409 duplicate_block_id { duplicates } (already recorded
//   on this assignment). One DB.batch: close session, qty_done += n, one cc_block_ids row per ID.
// hc: { holed_delta, on_hand } (on_hand is an absolute physical count) — unchanged.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { checkBlockIdsBody } from "@/lib/cutting/blockIds";

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

    let blockIds: string[] = [];
    if (session.board === "cc") {
      const check = checkBlockIdsBody(body?.block_ids);
      if (!check.ok) {
        return NextResponse.json(check, { status: 400 });
      }
      blockIds = check.ids;
      if (blockIds.length) {
        const dupes = await DB.prepare(
          `SELECT block_id FROM cc_block_ids
           WHERE assignment_id = ? AND block_id IN (SELECT value FROM json_each(?))`
        ).bind(session.ref_id, JSON.stringify(blockIds)).all<{ block_id: string }>();
        const duplicates = (dupes.results ?? []).map((r) => r.block_id);
        if (duplicates.length) {
          return NextResponse.json({ ok: false, error: "duplicate_block_id", duplicates }, { status: 409 });
        }
      }
      stmts.push(
        DB.prepare(
          `UPDATE cc_assignments SET qty_done = qty_done + ? WHERE id = ?`
        ).bind(blockIds.length, session.ref_id)
      );
      const operatorName = request.headers.get("X-User-Name") || session.operator_name || null;
      for (const blockId of blockIds) {
        stmts.push(
          DB.prepare(
            `INSERT INTO cc_block_ids
               (id, assignment_id, session_id, block_id, event, operator_id, operator_name, created_at)
             VALUES (?, ?, ?, ?, 'stop', ?, ?, ?)`
          ).bind(crypto.randomUUID(), session.ref_id, session.id, blockId, operatorId, operatorName, now)
        );
      }
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

    try {
      await DB.batch(stmts);
    } catch (e: any) {
      // A concurrent entry of the same ID on this assignment trips the unique index; the batch is
      // atomic, so nothing was written.
      if (session.board === "cc" && /UNIQUE/i.test(String(e?.message || e))) {
        return NextResponse.json({ ok: false, error: "duplicate_block_id", duplicates: blockIds }, { status: 409 });
      }
      throw e;
    }

    await DB.prepare(
      `INSERT INTO activity_log
         (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
       VALUES (?, ?, 'update', 'chunk_session', ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      now,
      session.id,
      session.board === "cc"
        ? `${session.operator_name} stopped Cross Cutter (${session.ref_id}) — ${blockIds.length} blocks this run`
        : `${session.operator_name} stopped Hole Cutter (${session.ref_id})`,
      JSON.stringify(
        session.board === "cc"
          ? { board: session.board, ref_id: session.ref_id, block_ids: blockIds, blocks: blockIds.length }
          : { board: session.board, ref_id: session.ref_id, body }
      ),
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
