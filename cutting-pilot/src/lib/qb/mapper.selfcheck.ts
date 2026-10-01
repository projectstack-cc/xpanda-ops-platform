// src/lib/qb/mapper.selfcheck.ts
// Guarded dev self-check for qb/mapper.ts (qb-01). Mirrors jobPull.selfcheck.ts's shape:
// hand-built fixtures, a check()/results table, one exported run*SelfCheck() function. Async
// because relevantHash uses WebCrypto. Not part of the production build path.
import type { Part } from "@/lib/partMatch";
import { mapInvoiceToJobInput, relevantHash } from "./mapper";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const PARTS: Part[] = [
  {
    id: "part-1",
    part_number: "EPS-1234",
    name: "Test block",
    category: "Blocks",
    density_material: "1.0 EPS",
    length_in: 48,
    width_in: 24,
    height_in: 12,
  },
];

function makeInvoice(overrides: Record<string, unknown> = {}): any {
  return {
    Id: "145",
    SyncToken: "3",
    DocNumber: "1037",
    CustomerRef: { value: "58", name: "Acme Roofing" },
    ShipAddr: { Line1: "100 Main St", Line2: "Dock 4", City: "Tampa", CountrySubDivisionCode: "FL", PostalCode: "33601" },
    BillAddr: { Line1: "1 Billing Office", City: "Atlanta", CountrySubDivisionCode: "GA", PostalCode: "30301" },
    CustomField: [{ DefinitionId: "1", Name: " Purchase Order ", Type: "StringType", StringValue: "PO-777" }],
    Line: [
      { DetailType: "SalesItemLineDetail", Description: "48x24x12 block", SalesItemLineDetail: { ItemRef: { value: "9", name: "EPS-1234" }, Qty: 10 } },
      { DetailType: "SalesItemLineDetail", Description: "Delivery charge", SalesItemLineDetail: { ItemRef: { value: "11", name: "Freight" }, Qty: 1 } },
      { DetailType: "SubTotalLineDetail", Amount: 500, SubTotalLineDetail: {} },
    ],
    ...overrides,
  };
}

export async function runQbMapperSelfCheck(): Promise<{ pass: boolean; results: CheckResult[] }> {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  // 1. Happy path: header fields, PO custom field (trim + case-insensitive), ship-to from ShipAddr.
  const full = mapInvoiceToJobInput(makeInvoice(), PARTS);
  {
    const i = full.input;
    check("customer/invoice/ship_to_company", i.customer === "Acme Roofing" && i.invoice_number === "1037" && i.ship_to_company === "Acme Roofing");
    check("ship-to from ShipAddr", i.ship_to_street === "100 Main St" && i.ship_to_street2 === "Dock 4" && i.ship_to_city === "Tampa" && i.ship_to_state === "FL" && i.ship_to_zip === "33601");
    check("PURCHASE ORDER custom field → po_number", i.po_number === "PO-777", i.po_number);
    check("defaults: load_count 1, unverified", i.load_count === 1 && i.ship_to_verified === "unverified");
    check("no warnings on complete invoice", full.warnings.length === 0, full.warnings.join(" | "));
  }

  // 2. Lines: non-SalesItemLineDetail skipped; matched + unmatched both kept, in order.
  {
    const li = full.input.line_items;
    check("SubTotal line skipped (2 lines)", li.length === 2, String(li.length));
    const m = li[0];
    check("matched line → part fields", !!m && m.part_id === "part-1" && m.part_number === "EPS-1234" && m.dimensions === "48 x 24 x 12" && m.density === "1.0 EPS" && m.quantity === 10);
    const u = li[1];
    check("unmatched line kept, part_id null", !!u && u.part_id === null && u.part_number === "Freight" && u.dimensions === "" && u.description === "Delivery charge");
    check("unmatched list", full.unmatched.length === 1 && full.unmatched[0] === "Freight", full.unmatched.join(","));
    // 48*24*12/144 = 96 bdft/piece × 10 = 960; unmatched line contributes 0.
    check("total_bdft from matched dims", full.input.total_bdft === 960, String(full.input.total_bdft));
  }

  // 3. Missing ShipAddr → blank ship-to (no BillAddr fallback) + warning.
  {
    const r = mapInvoiceToJobInput(makeInvoice({ ShipAddr: undefined }), PARTS);
    check("no BillAddr fallback", r.input.ship_to_street === "" && r.input.ship_to_city === "" && r.input.ship_to_zip === "");
    check("missing ShipAddr warns", r.warnings.some((w) => w.includes("ShipAddr")));
  }

  // 4. Absent PURCHASE ORDER → "" + warning, never throws.
  {
    let threw = false;
    let r: ReturnType<typeof mapInvoiceToJobInput> | null = null;
    try { r = mapInvoiceToJobInput(makeInvoice({ CustomField: undefined }), PARTS); } catch { threw = true; }
    check("absent PO does not throw", !threw);
    check("absent PO → blank + warning", !!r && r.input.po_number === "" && r.warnings.some((w) => w.includes("PURCHASE ORDER")));
  }

  // 5. relevantHash stability.
  {
    const h1 = await relevantHash(mapInvoiceToJobInput(makeInvoice(), PARTS).input);
    const h2 = await relevantHash(mapInvoiceToJobInput(makeInvoice(), PARTS).input);
    const changed = makeInvoice();
    changed.Line[0].SalesItemLineDetail.Qty = 11;
    const h3 = await relevantHash(mapInvoiceToJobInput(changed, PARTS).input);
    check("hash is 64-char hex", /^[0-9a-f]{64}$/.test(h1), h1);
    check("same input → same hash", h1 === h2);
    check("quantity change → different hash", h1 !== h3);
  }

  return { pass: results.every((r) => r.pass), results };
}
