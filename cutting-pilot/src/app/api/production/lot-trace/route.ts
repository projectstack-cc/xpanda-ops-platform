// src/app/api/production/lot-trace/route.ts  →  GET /v2/api/production/lot-trace?lot=
// Lot trace (prod-c-03), read-only: received lot(s) with bag totals, expansion batches, silo
// events and molded blocks for one supplier lot #. Exact (trimmed) match. Soft-deleted sheets are
// excluded. Gated production.log by the /v2/api/production middleware prefix.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

const BLOCK_CAP = 2000;

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const lot = (new URL(request.url).searchParams.get("lot") ?? "").trim();
  if (!lot) return NextResponse.json({ ok: false, error: "lot_required" }, { status: 400 });

  try {
    // Ledger bags are signed (receive +N, open -1, undo_open +1, adjust +/-N), so on-hand is a plain
    // SUM — same convention as LOT_COLUMNS in lib/productionSilos.ts.
    const [lotsRes, batchesRes, eventsRes, blocksRes] = await DB.batch([
      DB.prepare(
        `SELECT l.*,
           COALESCE((SELECT SUM(g.bags) FROM production_bead_ledger g WHERE g.lot_id = l.id), 0) AS bags_on_hand,
           COALESCE((SELECT SUM(CASE WHEN g.kind = 'receive' THEN g.bags ELSE 0 END)
                       FROM production_bead_ledger g WHERE g.lot_id = l.id), 0) AS received,
           -COALESCE((SELECT SUM(CASE WHEN g.kind IN ('open','undo_open') THEN g.bags ELSE 0 END)
                       FROM production_bead_ledger g WHERE g.lot_id = l.id), 0) AS opened,
           COALESCE((SELECT SUM(CASE WHEN g.kind = 'adjust' THEN g.bags ELSE 0 END)
                       FROM production_bead_ledger g WHERE g.lot_id = l.id), 0) AS adjusted
           FROM production_bead_lots l
          WHERE l.lot_no = ?
          ORDER BY l.received_date ASC, l.created_at ASC`
      ).bind(lot),
      DB.prepare(
        `SELECT b.*, s.log_date, s.bead_supplier, s.bead_type, s.density
           FROM production_expansion_batches b
           JOIN production_expansion_sessions s ON s.id = b.session_id AND s.deleted_at IS NULL
          WHERE b.lot_no = ?
          ORDER BY b.created_at ASC`
      ).bind(lot),
      DB.prepare(`SELECT * FROM production_silo_events WHERE lot_no = ? ORDER BY created_at ASC`).bind(lot),
      DB.prepare(
        `SELECT b.*, s.log_date, s.block_type
           FROM production_molding_blocks b
           JOIN production_molding_sessions s ON s.id = b.session_id AND s.deleted_at IS NULL
          WHERE b.lot_no = ?
          ORDER BY b.created_at ASC LIMIT ${BLOCK_CAP + 1}`
      ).bind(lot),
    ]);

    const blocks = blocksRes.results ?? [];
    return NextResponse.json({
      ok: true,
      lot_no: lot,
      lots: lotsRes.results ?? [],
      batches: batchesRes.results ?? [],
      silo_events: eventsRes.results ?? [],
      blocks: blocks.slice(0, BLOCK_CAP),
      truncated: blocks.length > BLOCK_CAP,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
