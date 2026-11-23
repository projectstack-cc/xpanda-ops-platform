// src/app/api/cutting/chunk-session/complete/route.ts  →  POST /v2/api/cutting/chunk-session/complete
// cc (cc-blocks-01): body { board:"cc", ref_id, block_ids: string[] } — the IDs ("MM/DD-XX") of the
// blocks used this run; the count is derived server-side (= ids.length, no upper bound, never clamped
// to target_chunks; over-target yield is recorded as cut). block_ids replaces cc-complete-01's
// qty_done_delta, which is now ignored. An empty list is allowed only when the assignment already has
// qty_done > 0 (blocks logged on earlier Stops); otherwise 400 block_ids_required. Same 400
// invalid_block_id / duplicate_in_request and 409 duplicate_block_id rules as Stop. In one DB.batch:
// closes the caller's own open session for this ref (if any), adds ids.length to qty_done, marks the
// assignment complete (drops off the queue) and inserts one cc_block_ids row per ID (event='complete').
// Returns { ok:true, qty_done, target_chunks, block_ids_added }.
// hc: body { board:"hc", ref_id } — no-op on inventory (slots persist forever); only the caller's
// open session (if any) is closed. Returns { ok:true }.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { checkBlockIdsBody } from "@/lib/cutting/blockIds";

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

    // Close the caller's own open session for this ref, if present (best-effort: may match 0 rows).
    const closeSession = DB.prepare(
      `UPDATE chunk_sessions SET status = 'closed', ended_at = ?
       WHERE operator_id = ? AND board = ? AND ref_id = ? AND status = 'open'`
    ).bind(now, operatorId, board, ref_id);

    if (board === "cc") {
      const check = checkBlockIdsBody(body?.block_ids);
      if (!check.ok) {
        return NextResponse.json(check, { status: 400 });
      }
      const blockIds = check.ids;

      const before = await DB.prepare(
        `SELECT label, qty_done FROM cc_assignments WHERE id = ?`
      ).bind(ref_id).first<{ label: string | null; qty_done: number }>();
      if (!before) {
        return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
      }
      if (blockIds.length === 0 && !(before.qty_done > 0)) {
        return NextResponse.json({ ok: false, error: "block_ids_required" }, { status: 400 });
      }
      if (blockIds.length) {
        const dupes = await DB.prepare(
          `SELECT block_id FROM cc_block_ids
           WHERE assignment_id = ? AND block_id IN (SELECT value FROM json_each(?))`
        ).bind(ref_id, JSON.stringify(blockIds)).all<{ block_id: string }>();
        const duplicates = (dupes.results ?? []).map((r) => r.block_id);
        if (duplicates.length) {
          return NextResponse.json({ ok: false, error: "duplicate_block_id", duplicates }, { status: 409 });
        }
      }

      // Capture the caller's open session (if any) so the ID rows point at the run they closed.
      const openSession = await DB.prepare(
        `SELECT id FROM chunk_sessions
         WHERE operator_id = ? AND board = 'cc' AND ref_id = ? AND status = 'open' LIMIT 1`
      ).bind(operatorId, ref_id).first<{ id: string }>();
      const sessionId = openSession?.id ?? null;

      const stmts: ReturnType<typeof DB.prepare>[] = [
        closeSession,
        DB.prepare(
          `UPDATE cc_assignments SET qty_done = qty_done + ?, status = 'complete', completed_at = ? WHERE id = ?`
        ).bind(blockIds.length, now, ref_id),
      ];
      for (const blockId of blockIds) {
        stmts.push(
          DB.prepare(
            `INSERT INTO cc_block_ids
               (id, assignment_id, session_id, block_id, event, operator_id, operator_name, created_at)
             VALUES (?, ?, ?, ?, 'complete', ?, ?, ?)`
          ).bind(crypto.randomUUID(), ref_id, sessionId, blockId, operatorId, operatorName || null, now)
        );
      }
      try {
        await DB.batch(stmts);
      } catch (e: any) {
        // A concurrent entry of the same ID trips the unique index; the batch is atomic, nothing written.
        if (/UNIQUE/i.test(String(e?.message || e))) {
          return NextResponse.json({ ok: false, error: "duplicate_block_id", duplicates: blockIds }, { status: 409 });
        }
        throw e;
      }

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
        `${operatorName} completed Cross Cutter (${row?.label || ref_id}) — ${blockIds.length} blocks this run, ${qtyDone} total`,
        JSON.stringify({
          board,
          ref_id,
          block_ids: blockIds,
          blocks_this_run: blockIds.length,
          qty_done: qtyDone,
          target_chunks: targetChunks,
          over_target: overTarget,
        }),
        operatorId,
        now
      ).run();

      return NextResponse.json({
        ok: true,
        qty_done: qtyDone,
        target_chunks: targetChunks,
        block_ids_added: blockIds,
      });
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
