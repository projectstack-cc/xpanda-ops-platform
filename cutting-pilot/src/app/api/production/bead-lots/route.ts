// src/app/api/production/bead-lots/route.ts  →  GET /v2/api/production/bead-lots
// Received bead lots with bag counts (prod-b-02). Query: supplier?, bead_type?,
// include_inactive=1?, session_id? (adds opened_in_session for that expansion sheet).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { LOT_SELECT_SQL, LOT_SELECT_WITH_SESSION_SQL, type BeadLotRow } from "@/lib/productionSilos";

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const q = new URL(request.url).searchParams;
  const sessionId = q.get("session_id") || "";
  const where: string[] = [];
  const binds: unknown[] = sessionId ? [sessionId] : [];
  if (q.get("include_inactive") !== "1") where.push("l.active = 1");
  if (q.get("supplier")) { where.push(`l.bead_supplier = ?${binds.length + 1}`); binds.push(q.get("supplier")); }
  if (q.get("bead_type")) { where.push(`l.bead_type = ?${binds.length + 1}`); binds.push(q.get("bead_type")); }

  try {
    const rows = await DB.prepare(
      `${sessionId ? LOT_SELECT_WITH_SESSION_SQL : LOT_SELECT_SQL}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY l.received_date DESC, l.lot_no`
    ).bind(...binds).all<BeadLotRow>();
    return NextResponse.json({ ok: true, lots: rows.results ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
