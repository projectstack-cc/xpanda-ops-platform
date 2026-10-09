// src/app/api/bol-email/candidates/route.ts  ->  GET /v2/api/bol-email/candidates (bem-01)
// Port of legacy handleCandidates (_worker.js/routes/bol-email.js) — same SQL, same response shape.
// Edit-only (requireBolEdit), unlike legacy's view-level GET.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { nextShippingDateStr, requireBolEdit } from "@/lib/logistics/bolEmail";

export async function GET(request: NextRequest) {
  const denied = requireBolEdit(request);
  if (denied) return denied;

  const { DB } = await getEnv();
  if (!DB) return NextResponse.json({ ok: false, error: "Missing D1 binding" }, { status: 500 });

  const shipDate = await nextShippingDateStr(DB);

  try {
    const rows = await DB.prepare(`
      SELECT b.*,
             j.customer, j.invoice_number, j.po_number,
             la.trailer_number, la.load_number AS la_load_number,
             lb.bay_number, lb.label AS bay_label,
             COALESCE(la.ship_date, j.ship_date) AS effective_ship_date
      FROM bols b
      JOIN jobs j ON b.job_id = j.id
      LEFT JOIN loading_assignments la
             ON la.job_id = b.job_id AND la.load_number = b.load_number
      LEFT JOIN loading_bays lb ON la.bay_id = lb.id
      WHERE (b.carrier_name LIKE 'LISMA%' OR b.carrier_name LIKE 'SEAL%')
        AND date(COALESCE(la.ship_date, j.ship_date)) = date(?)
      ORDER BY j.customer ASC, b.load_number ASC
    `).bind(shipDate).all();

    return NextResponse.json({ ok: true, ship_date: shipDate, candidates: rows.results || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
