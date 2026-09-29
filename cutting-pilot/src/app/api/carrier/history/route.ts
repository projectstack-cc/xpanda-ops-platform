// src/app/api/carrier/history/route.ts  →  GET /v2/api/carrier/history
// Carrier "History (7 days)" tab: delivered loads whose loading_assignments.delivered_at falls in
// the last 7 ET calendar days, newest delivered first. Same row shape as /v2/api/carrier (shared
// builder, src/lib/carrier/rows.ts), same carrier filter; distance data is cache-only here (no ORS
// warm). Gated on logistics.carrier_view (GET = view) by the /v2/api/carrier middleware prefix.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { fetchCarrierRows } from "@/lib/carrier/rows";
import { historyCutoffUtc } from "@/lib/carrier/scope";

export async function GET() {
  try {
    const { DB } = await getEnv();
    const rows = await fetchCarrierRows(DB, { kind: "history", sinceUtc: historyCutoffUtc() });
    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
