// src/app/api/production/today/route.ts  →  GET /v2/api/production/today
// "Made today" summary strip, keyed to the ET calendar date. Per-silo grouping is on the ROW's
// silo now (prod-a-02), not the sheet's — deleted sheets excluded from every total.
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
       WHERE s.log_date = ? AND s.deleted_at IS NULL`
    ).bind(date).first<any>();

    const moldingSilos = await DB.prepare(
      `SELECT b.silo AS silo, COUNT(b.id) AS block_count, COALESCE(SUM(b.block_weight_lbs), 0) AS total_lbs
       FROM production_molding_blocks b
       JOIN production_molding_sessions s ON s.id = b.session_id
       WHERE s.log_date = ? AND s.deleted_at IS NULL
       GROUP BY b.silo
       ORDER BY b.silo ASC`
    ).bind(date).all();

    const expansionTotals = await DB.prepare(
      `SELECT COUNT(bt.id) AS batch_count, COALESCE(SUM(bt.weight_kg), 0) AS total_kg
       FROM production_expansion_batches bt
       JOIN production_expansion_sessions s ON s.id = bt.session_id
       WHERE s.log_date = ? AND s.deleted_at IS NULL`
    ).bind(date).first<any>();

    const expansionSilos = await DB.prepare(
      `SELECT bt.silo AS silo, COUNT(bt.id) AS batch_count, COALESCE(SUM(bt.weight_kg), 0) AS total_kg
       FROM production_expansion_batches bt
       JOIN production_expansion_sessions s ON s.id = bt.session_id
       WHERE s.log_date = ? AND s.deleted_at IS NULL
       GROUP BY bt.silo
       ORDER BY bt.silo ASC`
    ).bind(date).all();

    return NextResponse.json({
      ok: true,
      date,
      molding: {
        block_count: Number(moldingTotals?.block_count) || 0,
        total_lbs: Number(moldingTotals?.total_lbs) || 0,
        silos: (moldingSilos.results ?? []).map((r: any) => ({
          silo: r.silo,
          block_count: Number(r.block_count) || 0,
          total_lbs: Number(r.total_lbs) || 0,
        })),
      },
      expansion: {
        batch_count: Number(expansionTotals?.batch_count) || 0,
        total_kg: Number(expansionTotals?.total_kg) || 0,
        silos: (expansionSilos.results ?? []).map((r: any) => ({
          silo: r.silo,
          batch_count: Number(r.batch_count) || 0,
          total_kg: Number(r.total_kg) || 0,
        })),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
