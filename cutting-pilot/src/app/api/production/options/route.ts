// src/app/api/production/options/route.ts  →  GET /v2/api/production/options
// Active managed dropdown values for the Production Log UI. Gated production.log (view) by
// the general /v2/api/production middleware prefix — no manage check needed here.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET() {
  const { DB } = await getEnv();
  try {
    const rows = await DB.prepare(
      `SELECT kind, grp, value FROM production_options
       WHERE active = 1
       ORDER BY sort_order ASC, value ASC`
    ).all<{ kind: string; grp: string; value: string }>();

    const results = rows.results ?? [];
    const block_types = results.filter((r) => r.kind === "block_type").map((r) => r.value);
    const block_sizes = results.filter((r) => r.kind === "block_size").map((r) => r.value);
    const suppliers = results.filter((r) => r.kind === "bead_supplier").map((r) => r.value);
    const bead_types: Record<string, string[]> = {};
    for (const r of results) {
      if (r.kind !== "bead_type") continue;
      if (!bead_types[r.grp]) bead_types[r.grp] = [];
      bead_types[r.grp].push(r.value);
    }

    return NextResponse.json({ ok: true, block_types, block_sizes, suppliers, bead_types });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
