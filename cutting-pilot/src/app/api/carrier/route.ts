// src/app/api/carrier/route.ts  →  /v2/api/carrier
// Carrier-facing read-only 2-day (today + tomorrow, ET) outgoing-loads view.
// Gated on logistics.carrier_view by middleware (GET view). Reads only — no writes.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";

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
    const rows = await DB.prepare(
      `SELECT
         j.invoice_number,
         j.customer,
         j.ship_to_city,
         j.ship_to_state,
         lb.bay_number,
         la.trailer_number,
         la.loading_status,
         la.load_number,
         substr(COALESCE(la.ship_date, j.ship_date), 1, 10) AS ship_day
       FROM loading_assignments la
       JOIN jobs j ON j.id = la.job_id
       LEFT JOIN loading_bays lb ON lb.id = la.bay_id
       WHERE (j.carrier LIKE 'LISMA%' OR j.carrier LIKE 'SEAL%')
         AND la.bay_id IS NOT NULL AND la.bay_id <> ''
         AND la.trailer_number IS NOT NULL AND la.trailer_number <> ''
         AND la.loading_status <> 'archived'
         AND substr(COALESCE(la.ship_date, j.ship_date), 1, 10) IN (?, ?)
       ORDER BY ship_day ASC, lb.bay_number ASC, la.load_number ASC`
    ).bind(today, tomorrow).all();

    return NextResponse.json({ ok: true, today, tomorrow, rows: rows.results ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
