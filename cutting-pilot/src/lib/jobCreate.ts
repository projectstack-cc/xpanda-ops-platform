// src/lib/jobCreate.ts
// qb-01: the ONE job-creation path shared by v2 order entry (POST /v2/api/orders) and QuickBooks
// import (POST /v2/api/qb/import). Moved out of orders/route.ts POST — every column, default,
// and side-effect ordering is preserved exactly. Ported from _worker.js/routes/jobs.js POST —
// EXCEPT legacy cutting_steps creation, which is intentionally dropped (v2 cutting_lines
// reconcile lazily on the cutting queue read).
//
// Callers normalize their payload into JobCreateInput (trimmed strings, numbers, nulls) before
// calling; this function binds those values as-is.
import type { D1Database, D1PreparedStatement, R2Bucket } from "@cloudflare/workers-types";
import { computeAndPersistHoleyChunks } from "@/lib/holeyChunks";
import { logActivity } from "@/lib/activityLog";

export interface JobCreateLineItem {
  part_id: string | null;
  part_number: string;
  description: string;
  quantity: number;
  dimensions: string;
  density: string | null;
  // slip-parse-05: offload-zone line data (packing-slip parse). QB paths leave these unset → NULL.
  offload_seq?: number | null;
  zone_label?: string | null;
  zone_bdft?: number | null;
}

export interface JobCreateInput {
  customer: string;
  po_number: string;
  invoice_number: string;
  ship_date: string;
  ship_day: string;
  location: string;
  delivery_time: string;
  method: string;
  carrier: string;
  load_count: number;
  total_bdft: number;
  scrap_pickup: string;
  sales_lead: string;
  bol_info: string;
  payment_info: string;
  notes: string;
  cutting_instructions: string;
  packing_instructions: string;
  contact_name: string;
  contact_phone: string;
  combo_id: string | null;
  priority: string;
  confirmed_to_ship: boolean;
  processes: Array<{ name: string; completed: boolean }>;
  packing_slip_pdf: string | null; // base64; uploaded to R2 when present
  packing_slip_filename: string;
  packing_slip_invoice: string;
  ship_to_company: string;
  ship_to_attention: string;
  ship_to_street: string;
  ship_to_street2: string;
  ship_to_city: string;
  ship_to_state: string;
  ship_to_zip: string;
  ship_to_verified: string;
  ship_to_standardized: string | null; // already JSON-stringified
  ship_to_verified_at: string | null;
  offload_zones_enabled?: boolean; // slip-parse-05: zoned packing slip; QB mapper/jobState don't set it → 0
  line_items: JobCreateLineItem[];
}

export type JobCreateResult =
  | { ok: true; id: string; hb_chunk_breakdown: string | null }
  | { ok: false; code: "duplicate_invoice"; job_id: string }
  | { ok: false; code: "invalid"; error: string };

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

// qb-02: shared job_line_items INSERT — createJob runs these sequentially; QB review apply puts
// them in a db.batch after deleting the old rows. Same column set, sort_order = array index.
export function lineItemInsertStatements(
  DB: D1Database,
  jobId: string,
  lineItems: JobCreateLineItem[],
): D1PreparedStatement[] {
  return lineItems.map((li, i) =>
    DB.prepare(`
      INSERT INTO job_line_items (id, job_id, part_id, part_number, description, quantity, dimensions, density, sort_order, offload_seq, zone_label, zone_bdft)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      crypto.randomUUID(), jobId,
      li.part_id,
      li.part_number, li.description,
      li.quantity,
      li.dimensions, li.density, i,
      li.offload_seq ?? null, li.zone_label ?? null, li.zone_bdft ?? null,
    )
  );
}

export async function createJob(
  env: { DB: D1Database; BOL_PHOTOS: R2Bucket },
  input: JobCreateInput,
  actor: { id: string | null; name: string },
  opts: { source: "manual" | "quickbooks"; via: string },
): Promise<JobCreateResult> {
  const { DB, BOL_PHOTOS } = env;
  const customer = input.customer;
  if (!customer) return { ok: false, code: "invalid", error: "Customer is required." };

  // Duplicate-invoice guard — ports legacy P446 semantics (POST /api/jobs): any row, archived
  // included, with the same trimmed invoice # blocks the create. Nothing is written on a hit.
  const invoiceTrim = String(input.invoice_number ?? "").trim();
  if (invoiceTrim) {
    const dup = await DB.prepare(`SELECT id FROM jobs WHERE trim(invoice_number) = ? LIMIT 1`)
      .bind(invoiceTrim).first<{ id: string }>();
    if (dup?.id) return { ok: false, code: "duplicate_invoice", job_id: dup.id };
  }

  const id = crypto.randomUUID();

  // Packing slip — upload to R2 (BOL_PHOTOS) under `packing-slips/<id>.pdf`; on R2 failure
  // fall back to keeping the base64 in D1 so the slip isn't lost. Mirrors legacy
  // _worker.js/routes/jobs.js POST behavior so the legacy job board can read the
  // attachment via GET /api/jobs/:id/packing-slip (R2 key first, D1 base64 fallback).
  let packing_slip_pdf: string | null = input.packing_slip_pdf ? String(input.packing_slip_pdf) : null;
  let packing_slip_key: string | null = null;
  if (packing_slip_pdf) {
    try {
      const slipBytes = Uint8Array.from(atob(packing_slip_pdf), (c) => c.charCodeAt(0));
      const slipKey = `packing-slips/${id}.pdf`;
      await BOL_PHOTOS.put(slipKey, slipBytes, { httpMetadata: { contentType: "application/pdf" } });
      packing_slip_key = slipKey;
      packing_slip_pdf = null;
    } catch (e: any) {
      console.error("Packing slip R2 upload failed — keeping in D1:", String(e?.message || e));
      // packing_slip_pdf stays set, packing_slip_key stays null
    }
  }

  const ts = now();
  const status = "not_started";
  const method = input.method;
  const carrier = input.carrier;
  const location = input.location;
  const ship_date = input.ship_date;
  const delivery_time = input.delivery_time;
  const scrap_pickup = input.scrap_pickup;
  const load_count = input.load_count;
  const total_bdft = input.total_bdft;
  const source = opts.source;
  const lineItems = input.line_items;

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
      ship_to_verified, ship_to_standardized, ship_to_verified_at, trailer_group_id,
      offload_zones_enabled
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    id, status, customer, input.po_number, input.invoice_number, ship_date, input.ship_day,
    location, delivery_time, method, carrier, load_count, total_bdft,
    scrap_pickup, input.sales_lead, input.bol_info, input.payment_info, input.notes,
    input.cutting_instructions, input.packing_instructions, input.contact_name, input.contact_phone,
    input.combo_id,
    input.priority, input.confirmed_to_ship ? 1 : 0, JSON.stringify(input.processes), ts, ts,
    packing_slip_key, packing_slip_pdf, input.packing_slip_filename, input.packing_slip_invoice, source,
    input.ship_to_company, input.ship_to_attention, input.ship_to_street, input.ship_to_street2,
    input.ship_to_city, input.ship_to_state, input.ship_to_zip,
    input.ship_to_verified, input.ship_to_standardized,
    input.ship_to_verified_at, null,
    input.offload_zones_enabled ? 1 : 0,
  ).run();

  for (const stmt of lineItemInsertStatements(DB, id, lineItems)) await stmt.run();

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
  // hb-onhand-02: read the breakdown back so the response can carry it — OrderEntryForm's
  // "Print cut list" builds its PDF from this POST response, not a follow-up fetch, so without
  // this the CHUNK BREAKDOWN page (net or not) never renders on a just-created order.
  let hbChunkBreakdown: string | null = null;
  try {
    await computeAndPersistHoleyChunks(DB, id);
    const hbRow = await DB.prepare(`SELECT hb_chunk_breakdown FROM jobs WHERE id = ?`).bind(id).first<any>();
    hbChunkBreakdown = hbRow?.hb_chunk_breakdown ?? null;
  } catch (e: any) {
    console.error("computeAndPersistHoleyChunks failed:", String(e?.message || e));
  }

  // Activity log — shared D1 table via the shared helper (swallows its own errors).
  await logActivity(
    DB, "create", "job", id,
    `${actor.name || "Someone"} created job "${customer}" via ${opts.via} — ${lineItems.length} line items`,
    { customer, po_number: input.po_number, line_items_count: lineItems.length, via: opts.via },
    actor.id,
  );

  return { ok: true, id, hb_chunk_breakdown: hbChunkBreakdown };
}
