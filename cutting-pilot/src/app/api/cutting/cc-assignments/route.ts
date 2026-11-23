// src/app/api/cutting/cc-assignments/route.ts  →  GET /v2/api/cutting/cc-assignments
// Active Cross Cutter assignment queue for the standalone /v2/cutting/crosscutter board.
// Fully decoupled from jobs — no job_id, no jobs.status writes.
// cc-blocks-01: also returns size_text and block_ids (the IDs already recorded on each open
// assignment, so the Stop/Complete modals can warn about a duplicate before submitting).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const canManage = request.headers.get("X-User-Can-Manage-Cutting") === "1";

    const rows = await DB.prepare(
      `SELECT a.id, a.label, a.size_text, a.target_chunks, a.qty_done, a.status, a.sort_order,
              cs.operator_name AS busy_by,
              (SELECT GROUP_CONCAT(b.block_id, ',') FROM cc_block_ids b WHERE b.assignment_id = a.id) AS block_ids_csv
       FROM cc_assignments a
       LEFT JOIN chunk_sessions cs
         ON cs.board = 'cc' AND cs.ref_id = a.id AND cs.status = 'open'
       WHERE a.status != 'complete'
       ORDER BY a.sort_order ASC, a.created_at ASC`
    ).all<{
      id: string;
      label: string;
      size_text: string | null;
      target_chunks: number;
      qty_done: number;
      status: string;
      sort_order: number;
      busy_by: string | null;
      block_ids_csv: string | null;
    }>();

    return NextResponse.json({
      ok: true,
      can_manage: canManage,
      assignments: (rows.results || []).map(({ block_ids_csv, ...a }) => ({
        ...a,
        block_ids: block_ids_csv ? block_ids_csv.split(",") : [],
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
