// src/app/api/production/today/route.ts  →  GET /v2/api/production/today
// "Made today" summary strip, keyed to the ET calendar date.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export async function GET() {
  const { DB } = await getEnv();
  const date = etToday();
  try {
    const moldingTotals = await DB.prepare(
      `SELECT COUNT(b.id) AS block_count, COALESCE(SUM(b.block_weight_lbs), 0) AS total_lbs
       FROM production_molding_blocks b
       JOIN production_molding_sessions s ON s.id = b.session_id
       WHERE s.log_date = ?`
    ).bind(date).first<any>();

    const silos = await DB.prepare(
      `SELECT s.silo AS silo, COUNT(b.id) AS block_count, COALESCE(SUM(b.block_weight_lbs), 0) AS total_lbs
       FROM production_molding_blocks b
       JOIN production_molding_sessions s ON s.id = b.session_id
       WHERE s.log_date = ?
       GROUP BY s.silo
       ORDER BY s.silo ASC`
    ).bind(date).all();

    const expansionTotals = await DB.prepare(
      `SELECT COUNT(bt.id) AS batch_count
       FROM production_expansion_batches bt
       JOIN production_expansion_sessions s ON s.id = bt.session_id
       WHERE s.log_date = ?`
    ).bind(date).first<any>();

    return NextResponse.json({
      ok: true,
      date,
      molding: {
        block_count: Number(moldingTotals?.block_count) || 0,
        total_lbs: Number(moldingTotals?.total_lbs) || 0,
        silos: (silos.results ?? []).map((r: any) => ({
          silo: r.silo,
          block_count: Number(r.block_count) || 0,
          total_lbs: Number(r.total_lbs) || 0,
        })),
      },
      expansion: {
        batch_count: Number(expansionTotals?.batch_count) || 0,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
