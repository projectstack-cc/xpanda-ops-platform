// src/lib/qb/webhook.selfcheck.ts
// Guarded dev self-check for qb/webhook.ts + the relevantHash round-trip (qb-02). Mirrors
// mapper.selfcheck.ts's shape: hand-built fixtures, a check()/results table, one exported
// run*SelfCheck() function. Async (WebCrypto). Not part of the production build path.
import type { JobCreateInput } from "@/lib/jobCreate";
import { verifyIntuitSignature, parseCloudEvents, buildDiff } from "./webhook";
import { rowToJobInput } from "./jobState";
import { relevantHash } from "./mapper";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const REALM = "9341450000000001";

async function sign(body: string, verifier: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(verifier), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  let bin = "";
  for (let i = 0; i < mac.length; i++) bin += String.fromCharCode(mac[i]);
  return btoa(bin);
}

function ev(type: string, entityId: string, account = REALM): Record<string, unknown> {
  return { specversion: "1.0", id: `evt-${type}-${entityId}`, type, time: "2026-10-01T12:00:00Z", intuitentityid: entityId, intuitaccountid: account };
}

function makeInput(overrides: Partial<JobCreateInput> = {}): JobCreateInput {
  return {
    customer: "Acme Roofing", po_number: "PO-1", invoice_number: "1037",
    ship_date: "", ship_day: "", location: "", delivery_time: "", method: "", carrier: "",
    load_count: 1, total_bdft: 960, scrap_pickup: "", sales_lead: "", bol_info: "", payment_info: "", notes: "",
    cutting_instructions: "", packing_instructions: "", contact_name: "", contact_phone: "", combo_id: null,
    priority: "", confirmed_to_ship: false, processes: [], packing_slip_pdf: null,
    packing_slip_filename: "", packing_slip_invoice: "",
    ship_to_company: "Acme Roofing", ship_to_attention: "", ship_to_street: "100 Main St", ship_to_street2: "",
    ship_to_city: "Tampa", ship_to_state: "FL", ship_to_zip: "33601",
    ship_to_verified: "unverified", ship_to_standardized: null, ship_to_verified_at: null,
    line_items: [
      { part_id: "part-1", part_number: "EPS-1234", description: "48x24x12 block", quantity: 10, dimensions: "48 x 24 x 12", density: "1.0 EPS" },
      { part_id: null, part_number: "Freight", description: "Delivery charge", quantity: 1, dimensions: "", density: null },
    ],
    ...overrides,
  };
}

export async function runQbWebhookSelfCheck(): Promise<{ pass: boolean; results: CheckResult[] }> {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  // 1. Signature verification — fail closed.
  {
    const verifier = "test-verifier-token";
    const body = JSON.stringify([ev("qbo.invoice.updated.v1", "145")]);
    const sig = await sign(body, verifier);
    check("signature: valid", await verifyIntuitSignature(body, sig, verifier));
    check("signature: tampered body rejected", !(await verifyIntuitSignature(body + " ", sig, verifier)));
    check("signature: wrong length rejected", !(await verifyIntuitSignature(body, sig.slice(0, -4), verifier)));
    check("signature: missing header rejected", !(await verifyIntuitSignature(body, null, verifier)));
    check("signature: missing verifier rejected", !(await verifyIntuitSignature(body, sig, undefined)));
  }

  // 2. CloudEvents parsing.
  {
    let threw = false;
    try { parseCloudEvents({ eventNotifications: [] }, REALM); } catch { threw = true; }
    check("parse: non-array throws", threw);

    const p = parseCloudEvents([
      ev("qbo.invoice.created.v1", "1"),
      ev("qbo.invoice.Updated.v1", "2"),
      ev("qbo.invoice.deleted.v1", "3"),
      ev("qbo.invoice.voided.v1", "4"),
      ev("qbo.invoice.updated.v1", "5", "999"),
      ev("qbo.customer.updated.v1", "6"),
      ev("qbo.invoice.emailed.v1", "7"),
    ], REALM);
    const ops = p.invoiceEvents.map((e) => `${e.invoiceId}:${e.op}`).join(",");
    check("parse: all 4 invoice ops recognized (case-insensitive)", ops === "1:create,2:update,3:delete,4:void", ops);
    check("parse: other-realm event skipped", p.otherRealm === 1, String(p.otherRealm));
    check("parse: non-invoice + unknown invoice op ignored", p.ignored === 2, String(p.ignored));
    check("parse: unknown invoice op surfaced for logging", p.unknownInvoiceTypes.length === 1 && p.unknownInvoiceTypes[0] === "qbo.invoice.emailed.v1", p.unknownInvoiceTypes.join(","));
  }

  // 3. Diff.
  {
    const cur = makeInput();
    const headerOnly = buildDiff(cur, makeInput({ ship_to_city: "Orlando" }));
    check("diff: header change", headerOnly.header.length === 1 && headerOnly.header[0].field === "ship_to_city" && headerOnly.header[0].to === "Orlando");

    const qty = makeInput();
    qty.line_items = qty.line_items.map((l, i) => (i === 0 ? { ...l, quantity: 12 } : l));
    const dq = buildDiff(cur, qty);
    check("diff: qty change", dq.lines.changed.length === 1 && dq.lines.changed[0].field === "quantity" && dq.lines.changed[0].to === 12 && dq.header.length === 0);

    const added = makeInput();
    added.line_items = [...added.line_items, { part_id: null, part_number: "EPS-9999", description: "Extra", quantity: 3, dimensions: "", density: null }];
    const da = buildDiff(cur, added);
    check("diff: line added", da.lines.added.length === 1 && da.lines.added[0].part_number === "EPS-9999" && da.lines.removed.length === 0);

    const removed = makeInput();
    removed.line_items = removed.line_items.slice(0, 1);
    const dr = buildDiff(cur, removed);
    check("diff: line removed", dr.lines.removed.length === 1 && dr.lines.removed[0].part_number === "Freight" && dr.lines.added.length === 0);
  }

  // 4. Hash round-trip: input → simulated D1 row (as createJob writes it) → rowToJobInput → same hash.
  {
    const input = makeInput({ customer: "Acme Roofing ", po_number: "" });
    const jobRow: Record<string, unknown> = {
      ...input,
      customer: input.customer, // D1 keeps what createJob bound
      processes: JSON.stringify(input.processes),
      confirmed_to_ship: 0,
      ship_to_street2: "",
    };
    const lineRows = input.line_items.map((l, i) => ({ ...l, quantity: Number(l.quantity), sort_order: i }));
    const back = rowToJobInput(jobRow, lineRows);
    const h1 = await relevantHash(input);
    const h2 = await relevantHash(back);
    check("hash round-trip: DB row hashes equal to input", h1 === h2, `${h1.slice(0, 12)} vs ${h2.slice(0, 12)}`);
    const h3 = await relevantHash({ ...input, line_items: input.line_items.map((l) => ({ ...l, quantity: String(l.quantity) as unknown as number })) });
    check("hash: string vs numeric quantity normalize equal", h1 === h3);
  }

  return { pass: results.every((r) => r.pass), results };
}
