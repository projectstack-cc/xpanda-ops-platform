// src/app/api/carrier/route.ts  →  /v2/api/carrier
// Carrier-facing 2-day (today + tomorrow, ET) outgoing-loads view ("Upcoming" tab).
// Gated on logistics.carrier_view by middleware (GET view). Reads only — except geocode_cache
// warming (carrier-03, bounded; see src/lib/carrier/rows.ts). The SELECT, geocode enrichment and
// carrier charges live in the shared row builder (carrier-04) so /v2/api/carrier/history returns
// the identical row shape.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { fetchCarrierRows } from "@/lib/carrier/rows";

function etDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export async function GET() {
  const { DB } = await getEnv();
  const today = etDateStr(0);
  const tomorrow = etDateStr(1);
  try {
    const rows = await fetchCarrierRows(DB, { kind: "upcoming", today, tomorrow });
    return NextResponse.json({ ok: true, today, tomorrow, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
