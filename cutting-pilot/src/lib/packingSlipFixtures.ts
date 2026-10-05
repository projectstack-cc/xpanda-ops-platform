// src/lib/packingSlipFixtures.ts
// slip-parse-04: real packing slips as raw pdf.js text items (page 1, y in PDF space — exactly what
// packingSlip.ts / jobs/packing-slip-parser.js parseDoc() consume), with per-fixture expectations.
// Consumed by scripts/packing-slip-parity.mjs, which runs BOTH parsers (legacy + v2 port) on every
// fixture and checks expectations AND legacy↔v2 parity. Not used at runtime.
//
// FIXTURES ARE SCRUBBED. Bill-to / ship-to / contact / PO / notes text is replaced with invented
// placeholders; x / y / width are preserved so the layout heuristics (y-grouping, x-gap header
// detection, column splits) behave identically to the real slip. NEVER commit an unscrubbed slip —
// scrub every customer-identifying string before adding a fixture here.
//
// Keep item text byte-exact as extracted (inch marks included) — the parsers' regexes accept both
// straight and curly (U+201D) inch marks, and a fixture must reflect what pdf.js really emitted.

export interface SlipRawItem {
  text: string;
  x: number;
  y: number;
  width: number;
}

export interface SlipFixture {
  name: string; // e.g. "INV 4417 — wrapped laminate facer"
  items: SlipRawItem[]; // raw pdf.js text items, page 1, y in PDF space (exactly what parseDoc consumes)
  expect: {
    invoice_number: string;
    line_items: Array<{
      quantity: number;
      description?: string;
      dimensions?: string;
      thickness?: number | null;
      facer_missing?: boolean;
    }>;
  };
}

// INV 4417 — laminate whose facer spec wraps onto a second description line (slip-parse-01),
// plus zero-qty rows that must be filtered.
const INV_4417_ITEMS: SlipRawItem[] = [
  {"text": "1090 Gills Dr, Ste 100", "x": 44.3, "y": 723.73, "width": 117.55},
  {"text": "Orlando, FL 32824", "x": 44.3, "y": 707.19, "width": 103.67},
  {"text": "www.XPandaFoam.com", "x": 44.3, "y": 690.65, "width": 129.16},
  {"text": "Packing Slip", "x": 46.8, "y": 662.3, "width": 110.36},
  {"text": "BILL TO", "x": 46.8, "y": 633.85, "width": 44.8},
  {"text": "Acme Supply #100", "x": 46.8, "y": 617.31, "width": 116.41},
  {"text": "Testville", "x": 46.8, "y": 600.77, "width": 64.99},
  {"text": "100 Main PKWY, Ste 900", "x": 46.8, "y": 584.24, "width": 137.68},
  {"text": "Sampletown, WI 53500", "x": 46.8, "y": 567.7, "width": 91.48},
  {"text": "SHIP TO", "x": 212.45, "y": 633.85, "width": 48.1},
  {"text": "Acme Supply #100", "x": 212.45, "y": 617.31, "width": 116.41},
  {"text": "Testville WHS", "x": 212.45, "y": 600.77, "width": 96.36},
  {"text": "1000 Industrial Way", "x": 212.45, "y": 584.24, "width": 131.72},
  {"text": "#100", "x": 212.45, "y": 567.7, "width": 26.83},
  {"text": "Testville, FL 32200", "x": 212.45, "y": 551.17, "width": 125.86},
  {"text": "INVOICE #", "x": 403.01, "y": 633.85, "width": 59.44},
  {"text": "4417", "x": 467.25, "y": 633.85, "width": 26.83},
  {"text": "DATE", "x": 430.34, "y": 617.31, "width": 32.11},
  {"text": "09/30/2026", "x": 467.25, "y": 617.31, "width": 60.29},
  {"text": "SHIP DATE", "x": 46.8, "y": 493.08, "width": 63.48},
  {"text": "SHIP VIA", "x": 179.75, "y": 493.08, "width": 50.74},
  {"text": "SHIPMENT CONTACT", "x": 299.3, "y": 509.62, "width": 123.66},
  {"text": "WITH PHONE #", "x": 299.3, "y": 493.08, "width": 86.83},
  {"text": "PURCHASE ORDER", "x": 432.25, "y": 493.08, "width": 113.63},
  {"text": "09/30/2026", "x": 46.8, "y": 476.54, "width": 60.29},
  {"text": "xct", "x": 179.75, "y": 476.54, "width": 15.41},
  {"text": "Pat Tester 555-010-", "x": 299.3, "y": 476.54, "width": 111.67},
  {"text": "0100", "x": 299.3, "y": 460.01, "width": 26.83},
  {"text": "PO-TEST-4417", "x": 432.25, "y": 476.54, "width": 53.66},
  {"text": "DESCRIPTION", "x": 49.5, "y": 423.96, "width": 75.34},
  {"text": "QTY", "x": 539.81, "y": 423.96, "width": 22.69},
  {"text": "Block Foam:1.0# BLOCK FOAM - RC", "x": 49.5, "y": 405.1, "width": 167.1},
  {"text": "Foam Block 1.0# RC - FOAM INSERTS", "x": 49.5, "y": 393.1, "width": 211.85},
  {"text": "2\" x 3\" x 12\" (BUNDLED IN 100s)", "x": 49.5, "y": 381.1, "width": 178.49},
  {"text": "0", "x": 555.59, "y": 405.1, "width": 6.71},
  {"text": "Laminate:XLam PRO Laminate/Laminate 1.0# (both sides - specify laminate type)", "x": 49.5, "y": 365.5, "width": 362.65},
  {"text": "Laminate/laminate 1.0# density -", "x": 49.5, "y": 353.5, "width": 173.78},
  {"text": "Kraft Back >> Foil one-side", "x": 49.5, "y": 341.5, "width": 144.96},
  {"text": "2\" x 48\" x 144\"", "x": 49.5, "y": 329.5, "width": 78.34},
  {"text": "31", "x": 548.88, "y": 365.5, "width": 13.42},
  {"text": "Block Foam:1.0# BLOCK FOAM - RC", "x": 49.5, "y": 313.9, "width": 167.1},
  {"text": "Foam Block 1.0# RC - PLAIN", "x": 49.5, "y": 301.9, "width": 156.38},
  {"text": "4\" x 48\" x 144\"", "x": 49.5, "y": 289.9, "width": 78.34},
  {"text": "10", "x": 548.88, "y": 313.9, "width": 13.42},
  {"text": "Block Foam:1.0# BLOCK FOAM - RC", "x": 49.5, "y": 274.3, "width": 167.1},
  {"text": "Foam Block 1.0# RC - NOTCHED", "x": 49.5, "y": 262.3, "width": 181.13},
  {"text": "11.875\" x 2.5\" x 144\"", "x": 49.5, "y": 250.3, "width": 111.79},
  {"text": "*package in 10-count*", "x": 49.5, "y": 238.3, "width": 117.74},
  {"text": "0", "x": 555.59, "y": 274.3, "width": 6.71},
  {"text": "Block Foam:1.0# BLOCK FOAM - RC", "x": 49.5, "y": 222.7, "width": 167.1},
  {"text": "Foam Block 1.0# RC - SQUARE CUT", "x": 49.5, "y": 210.7, "width": 200.5},
  {"text": "11.875\" x 2\" x 144\"", "x": 49.5, "y": 198.7, "width": 101.77},
  {"text": "0", "x": 555.59, "y": 222.7, "width": 6.71},
];

// INV 4466 — zoneless Holey Board slip: a 5,612 BDFT-total row (dropped on exact checksum,
// slip-parse-02), four thickness rows, a card-fee row and a notes block (both filtered).
const INV_4466_ITEMS: SlipRawItem[] = [
  {"text": "1090 Gills Dr, Ste 100", "x": 44.3, "y": 723.73, "width": 117.55},
  {"text": "Orlando, FL 32824", "x": 44.3, "y": 707.19, "width": 103.67},
  {"text": "www.XPandaFoam.com", "x": 44.3, "y": 690.65, "width": 129.16},
  {"text": "Packing Slip", "x": 46.8, "y": 662.3, "width": 110.36},
  {"text": "BILL TO", "x": 46.8, "y": 633.85, "width": 44.8},
  {"text": "Sample Builders Inc", "x": 46.8, "y": 617.31, "width": 83.52},
  {"text": "Attn: Jordan Tester", "x": 46.8, "y": 600.77, "width": 107.64},
  {"text": "200 Test Ave", "x": 46.8, "y": 584.24, "width": 107.72},
  {"text": "Sampletown, FL 33000", "x": 46.8, "y": 567.7, "width": 101.66},
  {"text": "SHIP TO", "x": 212.45, "y": 633.85, "width": 48.1},
  {"text": "NORTHSIDE TEST", "x": 212.45, "y": 617.31, "width": 102.29},
  {"text": "MIDDLE SCHOOL", "x": 212.45, "y": 600.77, "width": 84.19},
  {"text": "SOFTBALL", "x": 212.45, "y": 584.24, "width": 61.58},
  {"text": "PAVILION", "x": 212.45, "y": 567.7, "width": 80.87},
  {"text": "c/o Sample Builders", "x": 212.45, "y": 551.17, "width": 73.51},
  {"text": "300 Fixture Rd", "x": 215.76, "y": 534.63, "width": 122.36},
  {"text": "Testville, FL 32800", "x": 212.45, "y": 518.09, "width": 100.36},
  {"text": "INVOICE #", "x": 403.01, "y": 633.85, "width": 59.44},
  {"text": "4466", "x": 467.25, "y": 633.85, "width": 26.83},
  {"text": "DATE", "x": 430.34, "y": 617.31, "width": 32.11},
  {"text": "10/08/2026", "x": 467.25, "y": 617.31, "width": 60.29},
  {"text": "SHIP DATE", "x": 46.8, "y": 460.01, "width": 63.48},
  {"text": "SHIP VIA", "x": 179.75, "y": 460.01, "width": 50.74},
  {"text": "SHIPMENT CONTACT", "x": 299.3, "y": 476.54, "width": 123.66},
  {"text": "WITH PHONE #", "x": 299.3, "y": 460.01, "width": 86.83},
  {"text": "PURCHASE ORDER", "x": 432.25, "y": 460.01, "width": 113.63},
  {"text": "10/08/2026", "x": 46.8, "y": 443.47, "width": 60.29},
  {"text": "XCT", "x": 179.75, "y": 443.47, "width": 24.08},
  {"text": "JT Tester (c) 555-010-", "x": 299.3, "y": 443.47, "width": 117.66},
  {"text": "0199", "x": 299.3, "y": 426.94, "width": 26.83},
  {"text": "PO-TEST-4466", "x": 432.25, "y": 443.47, "width": 57.64},
  {"text": "DESCRIPTION", "x": 49.5, "y": 390.89, "width": 75.34},
  {"text": "QTY", "x": 539.81, "y": 390.89, "width": 22.69},
  {"text": "Holey Board:1.0# - RC - Holey Board", "x": 49.5, "y": 372.03, "width": 164.81},
  {"text": "Holey Board 1.0# - RC 2' x 4' (24\" x 48\")", "x": 49.5, "y": 360.03, "width": 214.88},
  {"text": "5,612", "x": 532.16, "y": 372.03, "width": 30.14},
  {"text": "Holey Board:1.0# - RC - Holey Board", "x": 49.5, "y": 344.43, "width": 164.81},
  {"text": "Holey Board 1.0# - RC 2' x 4' (24\" x 48\") 5.25\"", "x": 49.5, "y": 332.43, "width": 245.88},
  {"text": "15", "x": 548.88, "y": 344.43, "width": 13.42},
  {"text": "Holey Board:1.0# - RC - Holey Board", "x": 49.5, "y": 316.83, "width": 164.81},
  {"text": "Holey Board 1.0# - RC 2' x 4' (24\" x 48\") 6.25\"", "x": 49.5, "y": 304.83, "width": 245.88},
  {"text": "31", "x": 548.88, "y": 316.83, "width": 13.42},
  {"text": "Holey Board:1.0# - RC - Holey Board", "x": 49.5, "y": 289.23, "width": 164.81},
  {"text": "Holey Board 1.0# - RC 2' x 4' (24\" x 48\") 7.25\"", "x": 49.5, "y": 277.23, "width": 245.88},
  {"text": "33", "x": 548.88, "y": 289.23, "width": 13.42},
  {"text": "Holey Board:1.0# - RC - Holey Board", "x": 49.5, "y": 261.63, "width": 164.81},
  {"text": "Holey Board 1.0# - RC 2' x 4' (24\" x 48\") 8.25\"", "x": 49.5, "y": 249.63, "width": 245.88},
  {"text": "23", "x": 548.88, "y": 261.63, "width": 13.42},
  {"text": "Fee:Credit Card Processing Fee", "x": 49.5, "y": 234.03, "width": 143.78},
  {"text": "Credit Card Processing Fee 1.5% (half of standard 3% fee QuickBooks charges", "x": 49.5, "y": 222.03, "width": 423.94},
  {"text": "for all card transactions)", "x": 49.5, "y": 210.03, "width": 128.24},
  {"text": "1", "x": 555.59, "y": 234.03, "width": 6.71},
  {"text": "notes", "x": 49.5, "y": 194.43, "width": 24.57},
  {"text": "notes on an invoice for billing", "x": 49.5, "y": 182.43, "width": 155.05},
  {"text": "TEST NOTE LINE ONE - DELIVERY TIMING WAS COORDINATED LATE WITH THE", "x": 49.5, "y": 158.43, "width": 386.17},
  {"text": "CUSTOMER CONTACT SO THE DRIVER WAITED ON SITE (A SECOND LOAD WAS ALSO", "x": 49.5, "y": 146.43, "width": 427.15},
  {"text": "DELAYED AS A RESULT AT NO CHARGE TO EITHER CUSTOMER)", "x": 49.5, "y": 134.43, "width": 352.96},
  {"text": "1", "x": 555.59, "y": 194.43, "width": 6.71},
];

export const SLIP_FIXTURES: SlipFixture[] = [
  {
    name: "INV 4417 — wrapped laminate facer",
    items: INV_4417_ITEMS,
    expect: {
      invoice_number: "4417",
      line_items: [
        { quantity: 31, description: "Laminate/laminate 1.0# density - Kraft Back >> Foil one-side", dimensions: '2" x 48" x 144"', facer_missing: false },
        { quantity: 10, description: "Foam Block 1.0# RC - PLAIN", dimensions: '4" x 48" x 144"' },
      ],
    },
  },
  {
    name: "INV 4417-nofacer — facer line removed",
    items: INV_4417_ITEMS.filter((it) => it.text !== "Kraft Back >> Foil one-side"),
    expect: {
      invoice_number: "4417",
      line_items: [
        { quantity: 31, description: "Laminate/laminate 1.0# density -", dimensions: '2" x 48" x 144"', facer_missing: true },
        { quantity: 10, description: "Foam Block 1.0# RC - PLAIN", dimensions: '4" x 48" x 144"' },
      ],
    },
  },
  {
    name: "INV 4466 — HB BDFT-total row dropped, fee + notes filtered",
    items: INV_4466_ITEMS,
    expect: {
      invoice_number: "4466",
      line_items: [
        { quantity: 15, thickness: 5.25 },
        { quantity: 31, thickness: 6.25 },
        { quantity: 33, thickness: 7.25 },
        { quantity: 23, thickness: 8.25 },
      ],
    },
  },
  {
    name: "INV 4466-badchecksum — 5,611 total kept for review",
    items: INV_4466_ITEMS.map((it) => (it.text === "5,612" ? { ...it, text: "5,611" } : it)),
    expect: {
      invoice_number: "4466",
      line_items: [
        { quantity: 5611, thickness: null },
        { quantity: 15, thickness: 5.25 },
        { quantity: 31, thickness: 6.25 },
        { quantity: 33, thickness: 7.25 },
        { quantity: 23, thickness: 8.25 },
      ],
    },
  },
];
