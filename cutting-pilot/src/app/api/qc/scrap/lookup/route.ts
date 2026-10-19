// src/app/api/qc/scrap/lookup/route.ts  ->  GET /v2/api/qc/scrap/lookup?inv=
// qc-04: INV lookup for the /v2/qc Scrap log popup. Exact invoice_number match; several jobs → the
// newest non-archived one, else the newest. Lines INCLUDE Holey Board (scrap happens there too, even
// though Holey isn't inspected), each with nominalFromLine for the size prefill. Not found is a 200
// with found:false — the popup saves the entry anyway with no order link.
// Gated on `qc` by middleware (GET view). Read-only, so no logActivity.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { nominalFromLine } from "@/lib/qc/board";

interface JobRow {
  id: string;
  invoice_number: string | null;
  customer: string | null;
  ship_date: string | null;
}

interface LineRow {
  id: string;
  description: string | null;
  dimensions: string | null;
  quantity: number | null;
  density: string | null;
  category: string | null;
}

export async function GET(request: NextRequest) {
  const inv = (request.nextUrl.searchParams.get("inv") ?? "").trim();
  if (!inv) return NextResponse.json({ ok: false, error: "INV # is required.", detail: "inv" }, { status: 400 });

  try {
    const { DB } = await getEnv();
    const job = await DB.prepare(
      `SELECT id, invoice_number, customer, ship_date
         FROM jobs
        WHERE invoice_number = ?
        ORDER BY (archived_at IS NULL) DESC, created_at DESC
        LIMIT 1`
    )
      .bind(inv)
      .first<JobRow>();
    if (!job) return NextResponse.json({ ok: true, found: false });

    const res = await DB.prepare(
      `SELECT li.id, li.description, li.dimensions, li.quantity, li.density, p.category
         FROM job_line_items li
         LEFT JOIN parts p ON p.id = li.part_id
        WHERE li.job_id = ?
        ORDER BY li.sort_order, li.id`
    )
      .bind(job.id)
      .all<LineRow>();

    const lines = (res.results ?? []).map((r) => ({
      id: r.id,
      description: r.description ?? "",
      dimensions: r.dimensions ?? "",
      quantity: Number(r.quantity) || 0,
      density: r.density ?? null,
      category: r.category ?? null,
      nominal: nominalFromLine(r.dimensions ?? "", r.description ?? ""),
    }));

    return NextResponse.json({
      ok: true,
      found: true,
      job: {
        id: job.id,
        invoice_number: job.invoice_number ?? "",
        customer: job.customer ?? "",
        ship_date: job.ship_date ?? "",
      },
      lines,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't look up that INV #.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
