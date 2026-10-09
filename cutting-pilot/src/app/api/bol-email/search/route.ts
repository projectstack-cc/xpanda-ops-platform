// src/app/api/bol-email/search/route.ts  ->  GET /v2/api/bol-email/search?q= (bem-01)
// Port of legacy handleSearch (bolc-03 manual add) — same SQL, same `{ ok, results }` shape.
// Same join shape as candidates so manual rows carry trailer / bay / customer / invoice; LEFT JOIN
// jobs so BOLs without a job link are still findable.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { requireBolEdit } from "@/lib/logistics/bolEmail";

export async function GET(request: NextRequest) {
  const denied = requireBolEdit(request);
  if (denied) return denied;

  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ ok: true, results: [] });

  try {
    const rows = await DB.prepare(`
      SELECT b.*,
             COALESCE(j.customer, b.ship_to_company) AS customer,
             j.invoice_number,
             la.trailer_number, la.load_number AS la_load_number,
             lb.bay_number, lb.label AS bay_label,
             COALESCE(la.ship_date, j.ship_date) AS effective_ship_date
      FROM bols b
      LEFT JOIN jobs j ON b.job_id = j.id
      LEFT JOIN loading_assignments la
             ON la.job_id = b.job_id AND la.load_number = b.load_number
      LEFT JOIN loading_bays lb ON la.bay_id = lb.id
      WHERE b.ship_to_company LIKE ?1 OR CAST(b.bol_number AS TEXT) LIKE ?1
         OR j.customer LIKE ?1 OR j.invoice_number LIKE ?1
      ORDER BY b.bol_number DESC
      LIMIT 20
    `).bind(`%${q}%`).all();

    return NextResponse.json({ ok: true, results: rows.results || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
