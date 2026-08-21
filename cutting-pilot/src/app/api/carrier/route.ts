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
         b.access_token,
         b.load_count,
         (b.signed_bol_photo_key IS NOT NULL) AS has_signed,
         b.signed_bol_additional_info AS additional_info,
         substr(COALESCE(la.ship_date, j.ship_date), 1, 10) AS ship_day
       FROM loading_assignments la
       JOIN jobs j ON j.id = la.job_id
       LEFT JOIN loading_bays lb ON lb.id = la.bay_id
       LEFT JOIN bols b
         ON b.job_id = la.job_id
        AND (
              b.load_number = la.load_number
           OR (b.load_number IS NULL AND (SELECT COUNT(*) FROM bols b2 WHERE b2.job_id = la.job_id) = 1)
            )
        AND b.created_at = (
              SELECT MAX(b3.created_at) FROM bols b3
              WHERE b3.job_id = la.job_id
                AND (
                      b3.load_number = la.load_number
                   OR (b3.load_number IS NULL AND (SELECT COUNT(*) FROM bols b2 WHERE b2.job_id = la.job_id) = 1)
                    )
            )
       WHERE (j.carrier LIKE 'LISMA%' OR j.carrier LIKE 'SEAL%')
         AND la.bay_id IS NOT NULL AND la.bay_id <> ''
         AND la.trailer_number IS NOT NULL AND la.trailer_number <> ''
         AND la.loading_status <> 'archived'
         AND substr(COALESCE(la.ship_date, j.ship_date), 1, 10) IN (?, ?)
       ORDER BY ship_day ASC, lb.bay_number ASC, la.load_number ASC`
    ).bind(today, tomorrow).all();

    const raw = (rows.results ?? []) as any[];
    const shaped = raw.map((r) => {
      const count = Number(r.load_count) || 0;
      const n = Number(r.load_number) || 0;
      const suffix = count > 1 && n > 0 ? `-${String(n).padStart(2, "0")}` : "";
      return {
        invoice_number: r.invoice_number,
        customer: r.customer,
        ship_to_city: r.ship_to_city,
        ship_to_state: r.ship_to_state,
        bay_number: r.bay_number,
        trailer_number: r.trailer_number,
        loading_status: r.loading_status,
        load_number: r.load_number,
        load_count: r.load_count ?? null,
        suffix,
        access_token: r.access_token ?? null,
        has_signed: !!r.has_signed,
        additional_info: r.additional_info ?? null,
        ship_day: r.ship_day,
      };
    });

    return NextResponse.json({ ok: true, today, tomorrow, rows: shaped });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
