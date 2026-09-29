// src/app/api/production/history/route.ts  →  GET /v2/api/production/history
// Production history (prod-c-03), read-only. Filters: from / to (sheet log_date, ET; default the
// last 30 days), supplier, bead_type, density, block_type (blocks only), lot. Blocks filter on
// their own bead snapshot (stamped from the silo since prod-c-01); batches on their expansion
// sheet header. Soft-deleted sheets are excluded everywhere. Every value is bound, never
// interpolated. Gated production.log by the /v2/api/production middleware prefix.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { normDensity } from "@/lib/productionRecipes";
import type { HistoryBatch, HistoryBlock, HistoryData } from "@/lib/productionHistory";

const ROW_CAP = 5000;
const MAX_RANGE_DAYS = 366;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function etDaysAgo(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date(Date.now() - days * 86400000)
  );
}

const dayNo = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86400000;

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const q = new URL(request.url).searchParams;
  const param = (k: string) => (q.get(k) ?? "").trim();

  let from = param("from") || etDaysAgo(29);
  let to = param("to") || etDaysAgo(0);
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ ok: false, error: "invalid_param", detail: "from/to" }, { status: 400 });
  }
  if (from > to) [from, to] = [to, from];
  if (dayNo(to) - dayNo(from) + 1 > MAX_RANGE_DAYS) {
    return NextResponse.json({ ok: false, error: "range_too_large" }, { status: 400 });
  }

  const supplier = param("supplier");
  const beadType = param("bead_type");
  const blockType = param("block_type");
  const lot = param("lot");
  const densityRaw = param("density");
  const density = densityRaw ? normDensity(densityRaw) : null;
  if (densityRaw && density === null) {
    return NextResponse.json({ ok: false, error: "invalid_param", detail: "density" }, { status: 400 });
  }

  try {
    // Blocks — own bead snapshot columns; block type from the sheet.
    const bClauses = ["s.log_date BETWEEN ? AND ?"];
    const bBinds: unknown[] = [from, to];
    if (supplier) { bClauses.push("b.bead_supplier = ?"); bBinds.push(supplier); }
    if (beadType) { bClauses.push("b.bead_type = ?"); bBinds.push(beadType); }
    if (density !== null) { bClauses.push("b.density = ?"); bBinds.push(density); }
    if (blockType) { bClauses.push("s.block_type = ?"); bBinds.push(blockType); }
    if (lot) { bClauses.push("b.lot_no = ?"); bBinds.push(lot); }

    // Batches — the expansion sheet header's bead fields. block_type does not apply.
    const eClauses = ["s.log_date BETWEEN ? AND ?"];
    const eBinds: unknown[] = [from, to];
    if (supplier) { eClauses.push("s.bead_supplier = ?"); eBinds.push(supplier); }
    if (beadType) { eClauses.push("s.bead_type = ?"); eBinds.push(beadType); }
    if (density !== null) { eClauses.push("s.density = ?"); eBinds.push(density); }
    if (lot) { eClauses.push("b.lot_no = ?"); eBinds.push(lot); }

    const [blocksRes, batchesRes, densRes, typesRes] = await DB.batch([
      DB.prepare(
        `SELECT b.*, s.log_date, s.block_type, s.recipe_id, s.recipe_version, s.recipe_rc_pct_open,
                s.recipe_rc_speed, s.recipe_virgin_pct_open, s.recipe_virgin_speed
           FROM production_molding_blocks b
           JOIN production_molding_sessions s ON s.id = b.session_id AND s.deleted_at IS NULL
          WHERE ${bClauses.join(" AND ")}
          ORDER BY b.created_at ASC LIMIT ${ROW_CAP + 1}`
      ).bind(...bBinds),
      DB.prepare(
        `SELECT b.*, s.log_date, s.bead_supplier, s.bead_type, s.density, s.target_weight_g, s.recipe_id,
                s.recipe_version, s.recipe_density, s.recipe_heating_time_s, s.bucket_volume_l
           FROM production_expansion_batches b
           JOIN production_expansion_sessions s ON s.id = b.session_id AND s.deleted_at IS NULL
          WHERE ${eClauses.join(" AND ")}
          ORDER BY b.created_at ASC LIMIT ${ROW_CAP + 1}`
      ).bind(...eBinds),
      // Facets: date range only, so the dropdowns don't collapse as filters narrow.
      DB.prepare(
        `SELECT DISTINCT d FROM (
           SELECT b.density AS d FROM production_molding_blocks b
             JOIN production_molding_sessions s ON s.id = b.session_id AND s.deleted_at IS NULL
            WHERE s.log_date BETWEEN ? AND ? AND b.density IS NOT NULL
           UNION
           SELECT s.density AS d FROM production_expansion_batches b
             JOIN production_expansion_sessions s ON s.id = b.session_id AND s.deleted_at IS NULL
            WHERE s.log_date BETWEEN ? AND ? AND s.density IS NOT NULL
         ) ORDER BY d ASC`
      ).bind(from, to, from, to),
      DB.prepare(
        `SELECT DISTINCT block_type FROM production_molding_sessions
          WHERE deleted_at IS NULL AND log_date BETWEEN ? AND ? AND block_type IS NOT NULL
          ORDER BY block_type ASC`
      ).bind(from, to),
    ]);

    const blocks = (blocksRes.results ?? []) as unknown as HistoryBlock[];
    const batches = (batchesRes.results ?? []) as unknown as HistoryBatch[];
    const data: HistoryData = {
      range: { from, to },
      blocks: blocks.slice(0, ROW_CAP),
      batches: batches.slice(0, ROW_CAP),
      facets: {
        densities: ((densRes.results ?? []) as { d: number }[]).map((r) => r.d),
        block_types: ((typesRes.results ?? []) as { block_type: string }[]).map((r) => r.block_type),
      },
      truncated: { blocks: blocks.length > ROW_CAP, batches: batches.length > ROW_CAP },
    };
    return NextResponse.json({ ok: true, ...data });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
