// src/app/api/cutting/cc-assignments/route.ts  →  GET /v2/api/cutting/cc-assignments
// Active Cross Cutter assignment queue for the standalone /v2/cutting/crosscutter board.
// Fully decoupled from jobs — no job_id, no jobs.status writes.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const canManage = request.headers.get("X-User-Can-Manage-Cutting") === "1";

    const rows = await DB.prepare(
      `SELECT a.id, a.label, a.target_chunks, a.qty_done, a.status, a.sort_order,
              cs.operator_name AS busy_by
       FROM cc_assignments a
       LEFT JOIN chunk_sessions cs
         ON cs.board = 'cc' AND cs.ref_id = a.id AND cs.status = 'open'
       WHERE a.status != 'complete'
       ORDER BY a.sort_order ASC, a.created_at ASC`
    ).all<{
      id: string;
      label: string;
      target_chunks: number;
      qty_done: number;
      status: string;
      sort_order: number;
      busy_by: string | null;
    }>();

    return NextResponse.json({
      ok: true,
      can_manage: canManage,
      assignments: rows.results || [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
