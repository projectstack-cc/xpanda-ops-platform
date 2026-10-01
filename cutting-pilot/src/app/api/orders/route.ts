// src/app/api/orders/route.ts  →  /v2/api/orders
// Order-entry API. POST normalizes the payload and calls the shared createJob()
// (src/lib/jobCreate.ts, qb-01) — the same path QuickBooks import uses. createJob mirrors the
// legacy job-creation side-effects (auto outbound shipment, auto loading assignments).
// qb-01: a duplicate invoice # now returns 409 (legacy P446 parity).
// Gated on `orders` by middleware (GET view, POST edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { createJob, type JobCreateInput } from "@/lib/jobCreate";

export async function GET() {
  const { DB } = await getEnv();
  try {
    const rows = await DB.prepare(
      `SELECT id, customer, po_number, invoice_number, status, ship_date, source, created_at
         FROM jobs
        WHERE archived_at IS NULL
        ORDER BY created_at DESC
        LIMIT 100`
    ).all();
    return NextResponse.json({ ok: true, orders: rows.results ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { DB, BOL_PHOTOS } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let p: any;
  try { p = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const s = (v: any) => String(v ?? "").trim();
  const customer = s(p.customer);
  if (!customer) return NextResponse.json({ ok: false, error: "Customer is required." }, { status: 400 });

  const customer_pickup = p.customer_pickup === true || s(p.customer_pickup) === "true";
  // Method dropdown was removed from /v2/orders (P428). "customer pickup" is the only value
  // that carried behavior (skips loading-assignment creation in createJob), so derive it from the
  // checkbox and leave method blank otherwise.
  const method = customer_pickup ? "customer pickup" : "";
  const lineItems = Array.isArray(p.line_items) ? p.line_items : [];
  const ALLOWED_PROCS = ["Cross Cutter", "Hole Cutter", "Main Line", "Blue Line", "Laminate"];
  const procsJson = (Array.isArray(p.processes) ? p.processes : [])
    .filter((x: any) => x && ALLOWED_PROCS.includes(String(x.name)))
    .map((x: any) => ({ name: String(x.name), completed: !!x.completed }));

  // qb-01: normalize into JobCreateInput (same expressions the inline INSERT used to bind).
  const input: JobCreateInput = {
    customer,
    po_number: s(p.po_number),
    invoice_number: s(p.invoice_number),
    ship_date: s(p.ship_date),
    ship_day: s(p.ship_day),
    location: s(p.location),
    delivery_time: s(p.delivery_time),
    method,
    carrier: s(p.carrier),
    load_count: Number.isFinite(Number(p.load_count)) ? Number(p.load_count) : 1,
    total_bdft: Number.isFinite(Number(p.total_bdft)) ? Number(p.total_bdft) : 0,
    scrap_pickup: s(p.scrap_pickup),
    sales_lead: s(p.sales_lead),
    bol_info: s(p.bol_info),
    payment_info: s(p.payment_info),
    notes: s(p.notes),
    cutting_instructions: s(p.cutting_instructions),
    packing_instructions: s(p.packing_instructions),
    contact_name: s(p.contact_name),
    contact_phone: s(p.contact_phone),
    combo_id: p.combo_id ? s(p.combo_id) : null,
    priority: s(p.priority),
    confirmed_to_ship: !!p.confirmed_to_ship,
    processes: procsJson,
    packing_slip_pdf: p.packing_slip_pdf ? String(p.packing_slip_pdf) : null,
    packing_slip_filename: s(p.packing_slip_filename),
    packing_slip_invoice: s(p.packing_slip_invoice),
    ship_to_company: s(p.ship_to_company),
    ship_to_attention: s(p.ship_to_attention),
    ship_to_street: s(p.ship_to_street),
    ship_to_street2: s(p.ship_to_street2),
    ship_to_city: s(p.ship_to_city),
    ship_to_state: s(p.ship_to_state),
    ship_to_zip: s(p.ship_to_zip),
    ship_to_verified: s(p.ship_to_verified) || "unverified",
    ship_to_standardized: p.ship_to_standardized ? JSON.stringify(p.ship_to_standardized) : null,
    ship_to_verified_at: s(p.ship_to_verified_at) || null,
    line_items: lineItems.map((raw: any) => {
      const li = raw ?? {};
      return {
        part_id: li.part_id ? s(li.part_id) : null,
        part_number: s(li.part_number),
        description: s(li.description),
        quantity: Number.isFinite(Number(li.quantity)) ? Number(li.quantity) : 0,
        dimensions: s(li.dimensions),
        density: li.density ? s(li.density) : null,
      };
    }),
  };

  try {
    const result = await createJob(
      { DB, BOL_PHOTOS }, input, { id: actorId, name: actorName },
      { source: "manual", via: "order-entry" },
    );
    if (result.ok) {
      return NextResponse.json({ ok: true, id: result.id, hb_chunk_breakdown: result.hb_chunk_breakdown }, { status: 201 });
    }
    if (result.code === "duplicate_invoice") {
      return NextResponse.json(
        { ok: false, code: "duplicate_invoice", error: `A job with invoice # ${input.invoice_number} already exists.`, job_id: result.job_id },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
