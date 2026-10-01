// src/lib/qb/mapper.ts
// qb-01: pure QBO Invoice → JobCreateInput mapper (no I/O). Logic port of the deleted legacy
// _worker.js/lib/qb-mapper.js, plus part matching (partMatch.ts) and bdft (bdft.ts).
//   - No BillAddr fallback: a bill-to office is not a delivery address.
//   - Truck Loads / Total Board Foot are NOT read from QBO: load_count = 1, total_bdft is
//     computed from matched line dimensions.
//   - Unmatched lines are kept (part_id null) — the reviewer decides.
import type { JobCreateInput, JobCreateLineItem } from "@/lib/jobCreate";
import { matchLineItemToPart, type Part } from "@/lib/partMatch";
import { computeTotalBdft } from "@/lib/bdft";

export interface MapResult {
  input: JobCreateInput;
  warnings: string[];
  unmatched: string[];
}

const str = (v: unknown) => String(v ?? "").trim();

function findPurchaseOrder(invoice: any): string | null {
  const fields = Array.isArray(invoice?.CustomField) ? invoice.CustomField : [];
  for (const f of fields) {
    if (str(f?.Name).toUpperCase() === "PURCHASE ORDER") {
      const v = str(f?.StringValue);
      return v || null;
    }
  }
  return null;
}

export function mapInvoiceToJobInput(invoice: any, parts: Part[]): MapResult {
  const warnings: string[] = [];
  const unmatched: string[] = [];

  const customer = str(invoice?.CustomerRef?.name);
  const docNumber = str(invoice?.DocNumber);
  if (!customer) warnings.push("Invoice has no CustomerRef name.");

  const addr = invoice?.ShipAddr;
  if (!addr) warnings.push("Invoice has no ShipAddr — ship-to left blank (BillAddr is not used).");
  const a = addr || {};

  const po = findPurchaseOrder(invoice);
  if (po == null) warnings.push("No PURCHASE ORDER custom field value — po_number left blank.");

  const lines: JobCreateLineItem[] = [];
  for (const line of Array.isArray(invoice?.Line) ? invoice.Line : []) {
    if (line?.DetailType !== "SalesItemLineDetail") continue;
    const detail = line.SalesItemLineDetail || {};
    const itemName = str(detail.ItemRef?.name);
    const description = str(line.Description) || itemName;
    const qty = Number(detail.Qty);
    const quantity = Number.isFinite(qty) ? qty : 0;

    const match = matchLineItemToPart({ description: `${itemName} ${line.Description ?? ""}`.trim() }, parts);
    if (match) {
      const p = match.part;
      lines.push({
        part_id: p.id,
        part_number: p.part_number,
        description,
        quantity,
        dimensions: `${p.length_in} x ${p.width_in} x ${p.height_in}`,
        density: p.density_material ? String(p.density_material) : null,
      });
    } else {
      unmatched.push(itemName);
      lines.push({ part_id: null, part_number: itemName, description, quantity, dimensions: "", density: null });
    }
  }

  const input: JobCreateInput = {
    customer,
    po_number: po ?? "",
    invoice_number: docNumber,
    ship_date: "",
    ship_day: "",
    location: "",
    delivery_time: "",
    method: "",
    carrier: "",
    load_count: 1,
    total_bdft: computeTotalBdft(lines),
    scrap_pickup: "",
    sales_lead: "",
    bol_info: "",
    payment_info: "",
    notes: "",
    cutting_instructions: "",
    packing_instructions: "",
    contact_name: "",
    contact_phone: "",
    combo_id: null,
    priority: "",
    confirmed_to_ship: false,
    processes: [],
    packing_slip_pdf: null,
    packing_slip_filename: "",
    packing_slip_invoice: "",
    ship_to_company: customer,
    ship_to_attention: "",
    ship_to_street: str(a.Line1),
    ship_to_street2: str(a.Line2),
    ship_to_city: str(a.City),
    ship_to_state: str(a.CountrySubDivisionCode),
    ship_to_zip: str(a.PostalCode),
    ship_to_verified: "unverified",
    ship_to_standardized: null,
    ship_to_verified_at: null,
    line_items: lines,
  };

  return { input, warnings, unmatched };
}

// SHA-256 hex of the job-relevant fields — stored in qb_invoice_links.last_applied_hash now,
// used for no-op detection on webhook updates in qb-02.
// qb-02: normalized (strings trimmed + empty-coalesced, quantity via Number()) so a job read back
// from D1 hashes identically to the JobCreateInput that created it.
export async function relevantHash(input: JobCreateInput): Promise<string> {
  const t = (v: unknown) => String(v ?? "").trim();
  const q = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const canonical = JSON.stringify([
    t(input.customer),
    t(input.invoice_number),
    t(input.ship_to_street),
    t(input.ship_to_street2),
    t(input.ship_to_city),
    t(input.ship_to_state),
    t(input.ship_to_zip),
    t(input.po_number),
    (input.line_items || []).map((li) => [t(li.part_number), t(li.description), q(li.quantity)]),
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
