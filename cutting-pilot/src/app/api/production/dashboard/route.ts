// src/app/api/production/dashboard/route.ts  →  GET /v2/api/production/dashboard
// The single endpoint the production TV polls every 30 s (prod-d-02). Cheap by construction: one
// DB.batch of five fixed statements (open sheets with last row via correlated subquery, silos,
// today's totals) plus loadScheduleWithProgress's own fixed batch, run in parallel — no N+1.
// Open sheets of ANY log_date are returned, so a sheet left open overnight still shows (the TV's
// idle timer exposes it). mold_time is free text and never used for timing.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { etToday, loadScheduleWithProgress, type DashboardData } from "@/lib/productionSchedule";

export async function GET() {
  const { DB } = await getEnv();
  const today = etToday();
  try {
    const [batchRes, schedule] = await Promise.all([
      DB.batch([
        DB.prepare(
          `SELECT s.id AS session_id, s.log_date, s.block_type, s.created_at AS opened_at, s.recipe_version,
                  s.recipe_rc_pct_open, s.recipe_rc_speed, s.recipe_virgin_pct_open, s.recipe_virgin_speed,
                  (SELECT COUNT(*) FROM production_molding_blocks c WHERE c.session_id = s.id) AS block_count,
                  lb.block_no AS lb_block_no, lb.silo AS lb_silo, lb.lot_no AS lb_lot_no, lb.created_at AS lb_created_at
             FROM production_molding_sessions s
             LEFT JOIN production_molding_blocks lb ON lb.id = (
               SELECT b.id FROM production_molding_blocks b WHERE b.session_id = s.id
                ORDER BY b.created_at DESC, b.id DESC LIMIT 1)
            WHERE s.status = 'open' AND s.deleted_at IS NULL
            ORDER BY COALESCE(lb.created_at, s.created_at) DESC`
        ),
        DB.prepare(
          `SELECT s.id AS session_id, s.log_date, s.created_at AS opened_at, s.bead_supplier, s.bead_type, s.density,
                  s.recipe_version, s.recipe_heating_time_s,
                  (SELECT COUNT(*) FROM production_expansion_batches c WHERE c.session_id = s.id) AS batch_count,
                  (SELECT COALESCE(SUM(c.weight_kg), 0) FROM production_expansion_batches c WHERE c.session_id = s.id) AS total_kg,
                  lb.silo AS lb_silo, lb.lot_no AS lb_lot_no, lb.created_at AS lb_created_at
             FROM production_expansion_sessions s
             LEFT JOIN production_expansion_batches lb ON lb.id = (
               SELECT b.id FROM production_expansion_batches b WHERE b.session_id = s.id
                ORDER BY b.created_at DESC, b.id DESC LIMIT 1)
            WHERE s.status = 'open' AND s.deleted_at IS NULL
            ORDER BY COALESCE(lb.created_at, s.created_at) DESC`
        ),
        DB.prepare(
          `SELECT silo_no, label, active, state, lot_no, bead_supplier, bead_type, density, full_at
             FROM production_silos ORDER BY silo_no`
        ),
        DB.prepare(
          `SELECT COUNT(b.id) AS block_count, COALESCE(SUM(b.block_weight_lbs), 0) AS total_lbs
             FROM production_molding_blocks b
             JOIN production_molding_sessions s ON s.id = b.session_id
            WHERE s.log_date = ? AND s.deleted_at IS NULL`
        ).bind(today),
        DB.prepare(
          `SELECT COUNT(bt.id) AS batch_count, COALESCE(SUM(bt.weight_kg), 0) AS total_kg
             FROM production_expansion_batches bt
             JOIN production_expansion_sessions s ON s.id = bt.session_id
            WHERE s.log_date = ? AND s.deleted_at IS NULL`
        ).bind(today),
      ]),
      loadScheduleWithProgress(DB, today, today, today),
    ]);
    const [moldRes, expRes, silosRes, moldTot, expTot] = batchRes;

    const molding: DashboardData["molding"] = ((moldRes.results ?? []) as any[]).map((r) => ({
      session_id: r.session_id,
      log_date: r.log_date,
      block_type: r.block_type,
      opened_at: r.opened_at,
      recipe_version: r.recipe_version,
      recipe_rc_pct_open: r.recipe_rc_pct_open,
      recipe_rc_speed: r.recipe_rc_speed,
      recipe_virgin_pct_open: r.recipe_virgin_pct_open,
      recipe_virgin_speed: r.recipe_virgin_speed,
      block_count: Number(r.block_count) || 0,
      last_block: r.lb_created_at
        ? { block_no: r.lb_block_no, silo: r.lb_silo, lot_no: r.lb_lot_no, created_at: r.lb_created_at }
        : null,
    }));
    const expansion: DashboardData["expansion"] = ((expRes.results ?? []) as any[]).map((r) => ({
      session_id: r.session_id,
      log_date: r.log_date,
      opened_at: r.opened_at,
      bead_supplier: r.bead_supplier,
      bead_type: r.bead_type,
      density: r.density,
      recipe_version: r.recipe_version,
      recipe_heating_time_s: r.recipe_heating_time_s,
      batch_count: Number(r.batch_count) || 0,
      total_kg: Number(r.total_kg) || 0,
      last_batch: r.lb_created_at ? { silo: r.lb_silo, lot_no: r.lb_lot_no, created_at: r.lb_created_at } : null,
    }));
    const mt = ((moldTot.results ?? [])[0] ?? {}) as any;
    const et = ((expTot.results ?? [])[0] ?? {}) as any;

    const body: DashboardData = {
      ok: true,
      server_now: new Date().toISOString(),
      date: today,
      molding,
      expansion,
      silos: (silosRes.results ?? []) as unknown as DashboardData["silos"],
      schedule: {
        molding: schedule.filter((l) => l.kind === "molding"),
        expansion: schedule.filter((l) => l.kind === "expansion"),
      },
      today: {
        block_count: Number(mt.block_count) || 0,
        total_lbs: Number(mt.total_lbs) || 0,
        batch_count: Number(et.batch_count) || 0,
        total_kg: Number(et.total_kg) || 0,
      },
    };
    return NextResponse.json(body);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
