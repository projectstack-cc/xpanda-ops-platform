// src/app/api/cutting/hc-slots/route.ts  →  GET /v2/api/cutting/hc-slots
// The two fixed Hole Cutter slots (8-hole, 10-hole) for the standalone
// /v2/cutting/crosscutter board. Fully decoupled from jobs.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const operatorId = request.headers.get("X-User-Id") || "";
    const canManage = request.headers.get("X-User-Can-Manage-Cutting") === "1";

    const rows = await DB.prepare(
      `SELECT s.slot_key, s.label, s.on_hand, s.total_holed, s.updated_at,
              cs.operator_name AS busy_by
       FROM hc_slots s
       LEFT JOIN chunk_sessions cs
         ON cs.board = 'hc' AND cs.ref_id = s.slot_key AND cs.status = 'open'
       ORDER BY s.slot_key`
    ).all<{
      slot_key: string;
      label: string;
      on_hand: number;
      total_holed: number;
      updated_at: string | null;
      busy_by: string | null;
    }>();

    let myOpen: { board: string; ref_id: string } | null = null;
    if (operatorId) {
      const mine = await DB.prepare(
        `SELECT board, ref_id FROM chunk_sessions
         WHERE operator_id = ? AND status = 'open' LIMIT 1`
      ).bind(operatorId).first<{ board: string; ref_id: string }>();
      if (mine) myOpen = mine;
    }

    return NextResponse.json({
      ok: true,
      can_manage: canManage,
      my_open: myOpen,
      slots: rows.results || [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
