// src/app/api/production/silos/route.ts  →  GET /v2/api/production/silos
// All 12 silos (inactive included — the UI greys them) with derived kg_added. prod-b-02.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { SILO_SELECT_SQL, type SiloRow } from "@/lib/productionSilos";

export async function GET() {
  const { DB } = await getEnv();
  try {
    const rows = await DB.prepare(`${SILO_SELECT_SQL} ORDER BY production_silos.silo_no`).all<SiloRow>();
    return NextResponse.json({ ok: true, silos: rows.results ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
