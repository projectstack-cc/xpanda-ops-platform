// src/app/api/orders/route.ts  →  /v2/api/orders
// Order-entry API. POST creates a job + line items and mirrors the legacy job-creation
// side-effects (auto outbound shipment, auto loading assignments). Ported from
// _worker.js/routes/jobs.js POST — EXCEPT legacy cutting_steps creation, which is
// intentionally dropped (v2 cutting_lines reconcile lazily on the cutting queue read).
// Gated on `orders` by middleware (GET view, POST edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { nestHoleyChunks } from "@/lib/holeyNester";

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

// P438: compute + persist the Holey Board chunk requirement for a freshly-created job. Reads
// the just-inserted line items, resolves HB thickness from the parts catalog, runs the FFD
// nester, writes jobs.hb_chunks_required + hb_chunk_breakdown. Non-HB jobs (no HB line items)
// get NULL / NULL. Mirrors legacy _worker.js/routes/jobs.js computeAndPersistHoleyChunks —
// so cutList.ts's P386 CHUNK BREAKDOWN page renders for v2-created orders, and the v2
// cutting queue (which already seeds guillotine targets from jobs.hb_chunks_required) gets the
// right value on creation. Best-effort: a failure logs but never blocks the order save.
async function computeAndPersistHoleyChunks(db: any, jobId: string) {
  const rows = await db
    .prepare(
      `SELECT jli.quantity AS qty, p.height_in AS thickness
         FROM job_line_items jli
         JOIN parts p ON p.id = jli.part_id
        WHERE jli.job_id = ? AND p.category = 'Holey Board' AND p.height_in > 0`
    )
    .bind(jobId)
    .all();

  const items = (rows.results || []).map((r: any) => ({
    thickness: Number(r.thickness),
    qty: Number(r.qty),
  }));

  let chunksRequired: number | null = null;
  let breakdownJson: string | null = null;
  if (items.length) {
    const res = nestHoleyChunks(items);
    chunksRequired = res.chunks_required;
    breakdownJson = JSON.stringify(res);
  }

  await db
    .prepare(`UPDATE jobs SET hb_chunks_required = ?, hb_chunk_breakdown = ? WHERE id = ?`)
    .bind(chunksRequired, breakdownJson, jobId)
    .run();
}

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
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let p: any;
  try { p = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const s = (v: any) => String(v ?? "").trim();
  const customer = s(p.customer);
  if (!customer) return NextResponse.json({ ok: false, error: "Customer is required." }, { status: 400 });

  const id = crypto.randomUUID();
  const ts = now();
  const status = "not_started";
  const customer_pickup = p.customer_pickup === true || s(p.customer_pickup) === "true";
  // Method dropdown was removed from /v2/orders (P428). "customer pickup" is the only value
  // that carried behavior (skips loading-assignment creation below), so derive it from the
  // checkbox and leave method blank otherwise. The existing skip check is unchanged.
  const method = customer_pickup ? "customer pickup" : "";
  const carrier = s(p.carrier);
  const location = s(p.location);
  const ship_date = s(p.ship_date);
  const ship_day = s(p.ship_day);
  const delivery_time = s(p.delivery_time);
  const scrap_pickup = s(p.scrap_pickup);
  const load_count = Number.isFinite(Number(p.load_count)) ? Number(p.load_count) : 1;
  const total_bdft = Number.isFinite(Number(p.total_bdft)) ? Number(p.total_bdft) : 0;
  const source = "manual";
  const lineItems = Array.isArray(p.line_items) ? p.line_items : [];
  const ALLOWED_PROCS = ["Cross Cutter", "Hole Cutter", "Main Line", "Blue Line", "Laminate"];
  const procsJson = (Array.isArray(p.processes) ? p.processes : [])
    .filter((x: any) => x && ALLOWED_PROCS.includes(String(x.name)))
    .map((x: any) => ({ name: String(x.name), completed: !!x.completed }));

  try {
    // Port the exact jobs INSERT column list from _worker.js/routes/jobs.js.
    // Fields the entry form doesn't collect are inserted as '' / null / defaults, matching legacy.
    await DB.prepare(`
      INSERT INTO jobs (
        id, status, customer, po_number, invoice_number, ship_date, ship_day,
        location, delivery_time, method, carrier, load_count, total_bdft,
        scrap_pickup, sales_lead, bol_info, payment_info, notes,
        cutting_instructions, packing_instructions, contact_name, contact_phone, combo_id,
        priority, confirmed_to_ship, processes, created_at, updated_at,
        packing_slip_key, packing_slip_pdf, packing_slip_filename, packing_slip_invoice, source,
        ship_to_company, ship_to_attention, ship_to_street, ship_to_street2,
        ship_to_city, ship_to_state, ship_to_zip,
        ship_to_verified, ship_to_standardized, ship_to_verified_at, trailer_group_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id, status, customer, s(p.po_number), s(p.invoice_number), ship_date, ship_day,
      location, delivery_time, method, carrier, load_count, total_bdft,
      scrap_pickup, s(p.sales_lead), s(p.bol_info), s(p.payment_info), s(p.notes),
      s(p.cutting_instructions), s(p.packing_instructions), s(p.contact_name), s(p.contact_phone),
      p.combo_id ? s(p.combo_id) : null,
      s(p.priority), p.confirmed_to_ship ? 1 : 0, JSON.stringify(procsJson), ts, ts,
      null, null, s(p.packing_slip_filename), s(p.packing_slip_invoice), source,
      s(p.ship_to_company), s(p.ship_to_attention), s(p.ship_to_street), s(p.ship_to_street2),
      s(p.ship_to_city), s(p.ship_to_state), s(p.ship_to_zip),
      s(p.ship_to_verified) || "unverified", p.ship_to_standardized ? JSON.stringify(p.ship_to_standardized) : null,
      s(p.ship_to_verified_at) || null, null,
    ).run();

    for (let i = 0; i < lineItems.length; i++) {
      const li = lineItems[i] ?? {};
      await DB.prepare(`
        INSERT INTO job_line_items (id, job_id, part_id, part_number, description, quantity, dimensions, density, sort_order)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).bind(
        crypto.randomUUID(), id,
        li.part_id ? s(li.part_id) : null,
        s(li.part_number), s(li.description),
        Number.isFinite(Number(li.quantity)) ? Number(li.quantity) : 0,
        s(li.dimensions), li.density ? s(li.density) : null, i,
      ).run();
    }

    // Auto outbound shipment (non-blocking) — ported from legacy.
    try {
      await DB.prepare(`
        INSERT INTO shipments
          (id, direction, job_id, customer, carrier, method, bol_number, origin,
           destination, ship_date, status, total_bdft, load_count,
           weight_lbs, bead_type, notes, trailer_number, delivery_time, scrap_pickup)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        crypto.randomUUID(), "outbound", id, customer, carrier, method, "", "XPanda Foam",
        location, ship_date, "not_started", total_bdft, load_count, 0, "", "", "", delivery_time, scrap_pickup,
      ).run();
    } catch (e: any) { console.error("Auto-shipment failed:", String(e?.message || e)); }

    // Auto loading assignments (skip customer pickup) — ported from legacy.
    if (method.toLowerCase() !== "customer pickup") {
      try {
        const n2 = new Date().toISOString();
        for (let n = 1; n <= Math.max(load_count, 1); n++) {
          await DB.prepare(`
            INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
            VALUES (?, ?, NULL, '', 'awaiting', NULL, '', ?, ?, ?)
          `).bind(crypto.randomUUID(), id, n, n2, n2).run();
        }
      } catch (e: any) { console.error("Auto loading assignment failed:", String(e?.message || e)); }
    }

    // NOTE: legacy reconcileCuttingSteps() is intentionally NOT called. v2 cutting_lines
    // reconcile lazily on the cutting queue read — do not create cutting_steps here.

    // P438: compute + persist Holey Board chunk requirement so cutList.ts's P386 CHUNK
    // BREAKDOWN page renders and the v2 cutting queue's guillotine seed is correct on create.
    // Best-effort — log + swallow so a nester bug never blocks an order save.
    try {
      await computeAndPersistHoleyChunks(DB, id);
    } catch (e: any) {
      console.error("computeAndPersistHoleyChunks failed:", String(e?.message || e));
    }

    // Activity log — shared D1 table, same schema as legacy `logActivity()`
    // (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at).
    try {
      await DB.prepare(
        `INSERT INTO activity_log
           (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
         VALUES (?, ?, 'create', 'job', ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), ts, id,
        `${actorName || "Someone"} created job "${customer}" via order entry — ${lineItems.length} line items`,
        JSON.stringify({ customer, po_number: s(p.po_number), line_items_count: lineItems.length, via: "order-entry" }),
        actorId, ts,
      ).run();
    } catch (e: any) { console.error("activity_log failed:", String(e?.message || e)); }

    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
