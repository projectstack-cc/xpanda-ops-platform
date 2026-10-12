// src/app/api/board/route.ts  →  GET /v2/api/board
// Read-only board payload: active (non-archived) jobs + assignees + cutting/loading flags,
// and Open/Cutting/Loading counts. Gated on `jobs` (view). No writes here — see [id]/route.ts
// (P343) for the PUT endpoint.
// P343 additive extension: a few more read-only columns (invoice_number, notes, cutting/packing
// instructions, full ship-to) for the board's row-expand "Order spec" read-only block — the
// board table itself (P342) still only renders the original field set.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { loadBoardRows } from "@/lib/boardRows";

export async function GET() {
  const { DB } = await getEnv();
  // jb-01: 14-day auto-archive sweep, ported verbatim from legacy GET /api/jobs (routes/jobs.js).
  // Legacy keeps its copy until the legacy board retires (jb-09); running both is harmless —
  // the UPDATE is idempotent via archived_at IS NULL. Sets archived_at only, never status.
  // Archives FINISHED jobs only: ship_date > 14 days ago AND (status done/shipped OR a delivered
  // outbound shipment). Best-effort — a sweep failure must never break the board.
  try {
    await DB.prepare(
      `UPDATE jobs SET archived_at = ?
       WHERE archived_at IS NULL
         AND ship_date IS NOT NULL AND ship_date <> ''
         AND ship_date < date('now','-14 days')
         AND (
           status IN ('done', 'shipped')
           OR EXISTS (
             SELECT 1 FROM shipments s
             WHERE s.job_id = jobs.id AND s.direction = 'outbound' AND s.status = 'delivered'
           )
         )`
    ).bind(new Date().toISOString()).run();
  } catch (e) {
    console.error("stale-job auto-archive sweep failed:", e);
  }
  try {
    const enriched = await loadBoardRows(
      DB,
      `j.archived_at IS NULL
         AND j.status IN ('not_started','in_production','done','loading')`,
      [],
      "COALESCE(j.priority_level, 0) DESC, j.ship_date ASC"
    );

    const counts = {
      open: enriched.filter((j) => j.status === "not_started" || j.status === "in_production").length,
      cutting: enriched.filter((j) => j.in_cutting).length,
      loading: enriched.filter((j) => j.is_loading).length,
    };

    return NextResponse.json({ ok: true, jobs: enriched, counts });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
