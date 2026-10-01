// src/lib/qb/jobState.ts
// qb-02: D1 reads of an existing job for the QuickBooks review queue — current state as a
// JobCreateInput (for relevantHash / buildDiff), the floor-records guard, and invoice→job lookup.
import type { D1Database } from "@cloudflare/workers-types";
import type { JobCreateInput } from "@/lib/jobCreate";

const s = (v: unknown) => String(v ?? "").trim();

// Pure: a `jobs` row + its `job_line_items` rows (already in sort_order) → JobCreateInput.
// Kept pure so webhook.selfcheck.ts proves the hash round-trip on the real conversion.
export function rowToJobInput(job: Record<string, any>, lines: Array<Record<string, any>>): JobCreateInput {
  let processes: Array<{ name: string; completed: boolean }> = [];
  try { processes = JSON.parse(job.processes || "[]"); } catch { processes = []; }
  return {
    customer: s(job.customer),
    po_number: s(job.po_number),
    invoice_number: s(job.invoice_number),
    ship_date: s(job.ship_date),
    ship_day: s(job.ship_day),
    location: s(job.location),
    delivery_time: s(job.delivery_time),
    method: s(job.method),
    carrier: s(job.carrier),
    load_count: Number(job.load_count) || 1,
    total_bdft: Number(job.total_bdft) || 0,
    scrap_pickup: s(job.scrap_pickup),
    sales_lead: s(job.sales_lead),
    bol_info: s(job.bol_info),
    payment_info: s(job.payment_info),
    notes: s(job.notes),
    cutting_instructions: s(job.cutting_instructions),
    packing_instructions: s(job.packing_instructions),
    contact_name: s(job.contact_name),
    contact_phone: s(job.contact_phone),
    combo_id: job.combo_id ?? null,
    priority: s(job.priority),
    confirmed_to_ship: !!job.confirmed_to_ship,
    processes,
    packing_slip_pdf: null,
    packing_slip_filename: s(job.packing_slip_filename),
    packing_slip_invoice: s(job.packing_slip_invoice),
    ship_to_company: s(job.ship_to_company),
    ship_to_attention: s(job.ship_to_attention),
    ship_to_street: s(job.ship_to_street),
    ship_to_street2: s(job.ship_to_street2),
    ship_to_city: s(job.ship_to_city),
    ship_to_state: s(job.ship_to_state),
    ship_to_zip: s(job.ship_to_zip),
    ship_to_verified: s(job.ship_to_verified) || "unverified",
    ship_to_standardized: job.ship_to_standardized ?? null,
    ship_to_verified_at: job.ship_to_verified_at ?? null,
    line_items: lines.map((li) => ({
      part_id: li.part_id ?? null,
      part_number: s(li.part_number),
      description: s(li.description),
      quantity: Number(li.quantity) || 0,
      dimensions: s(li.dimensions),
      density: li.density ?? null,
    })),
  };
}

export async function loadJobAsInput(db: D1Database, jobId: string): Promise<JobCreateInput | null> {
  const job = await db.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(jobId).first<Record<string, any>>();
  if (!job) return null;
  const lines = await db.prepare(
    `SELECT part_id, part_number, description, quantity, dimensions, density
       FROM job_line_items WHERE job_id = ? ORDER BY sort_order ASC`
  ).bind(jobId).all<Record<string, any>>();
  return rowToJobInput(job, lines.results ?? []);
}

// A job is "blocked" (QB apply refuses to rewrite or archive it) once the floor has recorded
// anything against it. Beyond the prompt's list, also blocks on: cutting_line_progress (keyed to
// job_line_items ids, which an apply would orphan), cut plans (supervisor-saved), loading_photos,
// carrier_charges, bead_transactions tagged to the job, and offload-zone planning on line items.
export async function floorState(db: D1Database, jobId: string): Promise<{ blocked: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  const job = await db.prepare(`SELECT status, archived_at FROM jobs WHERE id = ?`).bind(jobId).first<{ status: string; archived_at: string | null }>();
  if (!job) return { blocked: true, reasons: ["job_missing"] };
  if ((job.status || "") !== "not_started") reasons.push(`status:${job.status}`);
  if (job.archived_at) reasons.push("archived");

  const checks: Array<[string, string]> = [
    ["cutting_sessions", `SELECT 1 FROM cutting_sessions WHERE job_id = ? LIMIT 1`],
    ["cutting_progress", `SELECT 1 FROM cutting_lines WHERE job_id = ? AND (line_status <> 'not_started' OR COALESCE(qty_done, 0) > 0) LIMIT 1`],
    ["cutting_progress", `SELECT 1 FROM cutting_line_progress WHERE job_id = ? AND (completed <> 0 OR COALESCE(completed_qty, 0) > 0) LIMIT 1`],
    ["cut_plan", `SELECT 1 FROM cut_plans WHERE job_id = ? LIMIT 1`],
    ["bol", `SELECT 1 FROM bols WHERE job_id = ? LIMIT 1`],
    ["carrier_charges", `SELECT 1 FROM carrier_charges WHERE job_id = ? LIMIT 1`],
    ["saved_load", `SELECT 1 FROM saved_loads WHERE job_id = ? LIMIT 1`],
    ["loading", `SELECT 1 FROM loading_assignments WHERE job_id = ? AND (loading_status <> 'awaiting' OR bay_id IS NOT NULL OR COALESCE(trailer_number, '') <> '') LIMIT 1`],
    ["loading", `SELECT 1 FROM loading_photos WHERE job_id = ? LIMIT 1`],
    ["offload_zones", `SELECT 1 FROM job_line_items WHERE job_id = ? AND (offload_seq IS NOT NULL OR zone_label IS NOT NULL) LIMIT 1`],
    ["bead_usage", `SELECT 1 FROM bead_transactions WHERE job_id = ? LIMIT 1`],
  ];
  for (const [reason, sql] of checks) {
    if (reasons.includes(reason)) continue;
    const hit = await db.prepare(sql).bind(jobId).first();
    if (hit) reasons.push(reason);
  }
  return { blocked: reasons.length > 0, reasons };
}

export interface QbLinkRow {
  id: string;
  realm_id: string;
  qbo_invoice_id: string;
  doc_number: string;
  job_id: string;
  sync_token: string | null;
  last_applied_hash: string | null;
  last_synced_at: string;
  created_at: string;
}

export async function getLink(db: D1Database, realmId: string, qboInvoiceId: string): Promise<QbLinkRow | null> {
  return db.prepare(`SELECT * FROM qb_invoice_links WHERE realm_id = ? AND qbo_invoice_id = ? LIMIT 1`)
    .bind(realmId, qboInvoiceId).first<QbLinkRow>();
}

export async function findJobForInvoice(
  db: D1Database,
  realmId: string,
  qboInvoiceId: string,
  docNumber: string,
): Promise<{ jobId: string; link: QbLinkRow | null } | null> {
  const link = await getLink(db, realmId, qboInvoiceId);
  if (link) return { jobId: link.job_id, link };
  const doc = s(docNumber);
  if (!doc) return null;
  const row = await db.prepare(
    `SELECT id FROM jobs WHERE trim(invoice_number) = ? ORDER BY (archived_at IS NULL) DESC, created_at DESC LIMIT 1`
  ).bind(doc).first<{ id: string }>();
  return row ? { jobId: row.id, link: null } : null;
}

// Link upsert keyed on (realm_id, qbo_invoice_id) so the webhook baseline, review apply, and a
// qb-01 import can't race into a unique-constraint failure.
export async function upsertLink(
  db: D1Database,
  v: { realmId: string; qboInvoiceId: string; docNumber: string; jobId: string; syncToken: string | null; hash: string | null },
): Promise<void> {
  const ts = new Date().toISOString();
  await db.prepare(`
    INSERT INTO qb_invoice_links
      (id, realm_id, qbo_invoice_id, doc_number, job_id, sync_token, last_applied_hash, last_synced_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(realm_id, qbo_invoice_id) DO UPDATE SET
      doc_number = excluded.doc_number,
      job_id = excluded.job_id,
      sync_token = excluded.sync_token,
      last_applied_hash = excluded.last_applied_hash,
      last_synced_at = excluded.last_synced_at
  `).bind(crypto.randomUUID(), v.realmId, v.qboInvoiceId, v.docNumber, v.jobId, v.syncToken, v.hash, ts, ts).run();
}
