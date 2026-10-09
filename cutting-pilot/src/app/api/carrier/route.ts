// src/app/api/carrier/route.ts  →  /v2/api/carrier
// Carrier-facing outgoing-loads view ("Upcoming" tab): today through the next business day, ET
// (carrier-11: Fri → Mon; any weekend day in between with loads is included).
// Gated on logistics.carrier_view by middleware (GET view). Reads only — except geocode_cache
// warming (carrier-03, bounded; see src/lib/carrier/rows.ts). The SELECT, geocode enrichment and
// carrier charges live in the shared row builder (carrier-04) so /v2/api/carrier/history returns
// the identical row shape.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { fetchCarrierRows } from "@/lib/carrier/rows";
import { etToday, nextBusinessDay } from "@/lib/productionSchedule";

export async function GET() {
  const { DB } = await getEnv();
  // Same today / next-business-day as isWithinCarrierWindow (src/lib/carrier/scope.ts).
  const today = etToday();
  const next_day = nextBusinessDay(today);
  try {
    const rows = await fetchCarrierRows(DB, { kind: "upcoming", today, next_day });
    return NextResponse.json({ ok: true, today, next_day, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
