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
    // slip-parse-05: doc-level offload-zone output (checked only when listed).
    offload_zones_enabled?: 0 | 1;
    offload_warnings?: Array<
      | { type: "checksum_mismatch"; zone_label: string | null; expected_bdft: number; computed_bdft: number }
      | { type: "missing_ordinal"; zone_label: string }
    >;
    line_items: Array<{
      quantity: number;
      description?: string;
      dimensions?: string;
      thickness?: number | null;
      facer_missing?: boolean;
      offload_seq?: number | null;
      zone_label?: string | null;
      zone_bdft?: number | null;
      density_conflict?: { category_density: number; description_density: number } | null;
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

// ─── Synthetic slips (slip-parse-05) ──────────────────────────────────────
// No real zoned slip is committed yet, so these are BUILT from the two real zone wordings documented
// in Prompts/archived_prompts/lbz-parse-01.md — format A (`OFFLOAD <ordinal> … Label & segregate as:
// <ZONE> -`, ordinal repeated per density group, BDFT-total row then thickness rows) and format B
// (`<ordinal> TO DELIVER > … LABEL as <ZONE>`, ordinal only on a zone's first group, self-contained
// `{N pieces}` row whose QTY is BDFT). All labels are invented. Layout reuses INV 4466's scrubbed
// header block (invoice # swapped) and the INV fixtures' columns: description x 49.5, QTY
// right-aligned at x ≈ 562. Expectations are LEGACY's output (legacy is the spec).
interface SynthRow {
  cat: string; // item header text (category) — the row that carries QTY
  qty: number;
  desc?: string[]; // description lines below the header
}

const QTY_RIGHT = 562.3;

function synthSlip(invoice: string, rows: SynthRow[]): SlipRawItem[] {
  const header = INV_4466_ITEMS
    .filter((it) => it.y >= 390)
    .map((it) => (it.text.includes("4466") ? { ...it, text: it.text.replace("4466", invoice) } : it));
  const out: SlipRawItem[] = [...header];
  let y = 372.03;
  for (const r of rows) {
    const q = r.qty.toLocaleString("en-US");
    const qw = Math.round(q.length * 6.71 * 100) / 100;
    out.push({ text: r.cat, x: 49.5, y, width: Math.round(r.cat.length * 5.2 * 100) / 100 });
    out.push({ text: q, x: Math.round((QTY_RIGHT - qw) * 100) / 100, y, width: qw });
    let ly = y;
    for (const line of r.desc ?? []) {
      ly = Math.round((ly - 12) * 100) / 100;
      out.push({ text: line, x: 49.5, y: ly, width: Math.round(line.length * 5.2 * 100) / 100 });
    }
    y = Math.round((ly - 15.6) * 100) / 100;
  }
  return out;
}

const HB_CAT = (d: string) => `Holey Board:${d}# - RC - Holey Board`;
const HB_DESC = (d: string, tail: string) => `Holey Board ${d}# - RC 2' x 4' (24" x 48")${tail ? " " + tail : ""}`;
const hbRow = (qty: number, thk: string, d = "1.0"): SynthRow => ({ cat: HB_CAT(d), qty, desc: [HB_DESC(d, `${thk}"`)] });

// Format A: unzoned block row first; CANOPY NORTH (OFFLOAD FIRST) 1.0# group 820 BDFT that checksums
// + a 2.0# single-line group (no BDFT row → zone_bdft null); ED VESTIBULE (OFFLOAD SECOND) with a
// deliberately wrong 999 BDFT total (pieces = 910); GIFT SHOP with no ordinal anywhere.
const SYN_ZONED_A = synthSlip("9101", [
  { cat: "Block Foam:1.0# BLOCK FOAM - RC", qty: 10, desc: ["Foam Block 1.0# RC - PLAIN", '4" x 48" x 144"'] },
  { cat: "OFFLOAD FIRST - Label & segregate as: CANOPY NORTH -", qty: 1 },
  { cat: HB_CAT("1.0"), qty: 820, desc: [HB_DESC("1.0", "BDFT")] },
  hbRow(10, "5.25"),
  hbRow(8, "6.25"),
  { cat: "OFFLOAD FIRST - Label & segregate as: CANOPY NORTH -", qty: 1 },
  hbRow(6, "6", "2.0"),
  { cat: "OFFLOAD SECOND - Label & segregate as: ED VESTIBULE -", qty: 1 },
  { cat: HB_CAT("1.0"), qty: 999, desc: [HB_DESC("1.0", "BDFT")] },
  hbRow(10, "7.25"),
  hbRow(5, "8.25"),
  { cat: "Label & segregate as: GIFT SHOP -", qty: 1 },
  { cat: HB_CAT("1.0"), qty: 168, desc: [HB_DESC("1.0", "BDFT")] },
  hbRow(4, "5.25"),
]);

// Format B: AREA B (FIRST TO DELIVER) 1.0# summary row with no thickness / no BDFT suffix (1,580 =
// 20×6.25×8 + 10×7.25×8), then a later AREA B group with no ordinal and a self-contained 2.0# row
// `{27 pieces)` (stray ")" variant) whose QTY 864 is BDFT; AREA C (SECOND TO DELIVER) 336 BDFT;
// AREA D whose ordinal (THIRD) appears only on its SECOND group — the earlier group's rows must
// still resolve to seq 3 (legacy's final zoneInfo pass). AREA D groups have no BDFT row → null.
const SYN_ZONED_B = synthSlip("9102", [
  { cat: "FIRST TO DELIVER > LABEL as AREA B", qty: 1 },
  { cat: HB_CAT("1.0"), qty: 1580, desc: [HB_DESC("1.0", "")] },
  hbRow(20, "6.25"),
  hbRow(10, "7.25"),
  { cat: "LABEL as AREA B", qty: 1 },
  { cat: HB_CAT("2.0"), qty: 864, desc: [HB_DESC("2.0", '4" {27 pieces)')] },
  { cat: "SECOND TO DELIVER >> LABEL as AREA C", qty: 1 },
  { cat: HB_CAT("1.0"), qty: 336, desc: [HB_DESC("1.0", "")] },
  hbRow(8, "5.25"),
  { cat: "LABEL as AREA D", qty: 1 },
  hbRow(3, "5.25"),
  { cat: "THIRD TO DELIVER >>> LABEL as AREA D", qty: 1 },
  hbRow(2, "6.25"),
]);

// Density conflict: category says 2.0#, description says 1.0# (the real 3371 AREA B pattern).
const SYN_DENSITY_CONFLICT = synthSlip("9103", [
  { cat: HB_CAT("2.0"), qty: 12, desc: [HB_DESC("1.0", '6.25"')] },
  hbRow(5, "7.25"),
]);

// INV 4477 — tapered spa-cover lines (taper-dims-01). Dims print as a thickness range
// (`2.5” - 4” x 39” x 80”`) that must parse to `2.5>4” x 39” x 80”`. Two-page slip: page-2 items keep
// the parser's yOffset (y = pdf y − page height), so they carry negative y — exactly what
// parsePackingSlip() hands parseDoc(). Qty-0 rows (SPC26/SPC32) and the CC fee must be filtered;
// SPC27's qty (11) sits on page 1 while its description wraps to page 2.
const INV_4477_ITEMS: SlipRawItem[] = [
  {"text":"1090 Gills Dr, Ste 100","x":44.3,"y":723.73,"width":117.55},
  {"text":"Orlando, FL 32824","x":44.3,"y":707.19,"width":103.67},
  {"text":"www.XPandaFoam.com","x":44.3,"y":690.65,"width":129.16},
  {"text":"Packing Slip","x":46.8,"y":662.3,"width":110.36},
  {"text":"BILL TO","x":46.8,"y":633.85,"width":44.8},
  {"text":"Sample Spa Co","x":46.8,"y":617.31,"width":125.68},
  {"text":"Attn: Pat Example","x":46.8,"y":600.77,"width":112.16},
  {"text":"200 Test Ave, Unit 1,","x":46.8,"y":584.24,"width":134.86},
  {"text":"Sampletown, FL 32700","x":46.8,"y":567.7,"width":98.46},
  {"text":"SHIP TO","x":212.45,"y":633.85,"width":48.1},
  {"text":"Sample Spa Co","x":212.45,"y":617.31,"width":125.68},
  {"text":"Attn: Lee Example","x":212.45,"y":600.77,"width":107.63},
  {"text":"200 Test Ave, Unit 1","x":212.45,"y":584.24,"width":131.54},
  {"text":"Sampletown, FL 32700","x":212.45,"y":567.7,"width":98.46},
  {"text":"INVOICE #","x":403.01,"y":633.85,"width":59.44},
  {"text":"4477","x":467.25,"y":633.85,"width":26.83},
  {"text":"DATE","x":430.34,"y":617.31,"width":32.11},
  {"text":"10/14/2026","x":467.25,"y":617.31,"width":60.29},
  {"text":"SHIP DATE","x":46.8,"y":493.08,"width":63.48},
  {"text":"SHIP VIA","x":179.75,"y":493.08,"width":50.74},
  {"text":"SHIPMENT CONTACT","x":299.3,"y":509.62,"width":123.66},
  {"text":"WITH PHONE #","x":299.3,"y":493.08,"width":86.83},
  {"text":"PURCHASE ORDER","x":432.25,"y":493.08,"width":113.63},
  {"text":"10/14/2026","x":46.8,"y":476.54,"width":60.29},
  {"text":"carrier","x":179.75,"y":476.54,"width":34.02},
  {"text":"Lee Example @555-","x":299.3,"y":476.54,"width":119.24},
  {"text":"555-0100","x":299.3,"y":460.01,"width":50.93},
  {"text":"*email Lee/Pat","x":432.25,"y":476.54,"width":96.84},
  {"text":"10/7/26","x":432.25,"y":460.01,"width":40.16},
  {"text":"DESCRIPTION","x":49.5,"y":423.96,"width":75.34},
  {"text":"QTY","x":539.81,"y":423.96,"width":22.69},
  {"text":"notes","x":49.5,"y":405.1,"width":24.57},
  {"text":"SAMPLE NOTES LINE ONE","x":49.5,"y":393.1,"width":275.89},
  {"text":"~SAMPLE NOTES LINE TWO","x":49.5,"y":369.1,"width":413.18},
  {"text":"and copy sample@example.com","x":49.5,"y":357.1,"width":201.65},
  {"text":"~SAMPLE NOTES LINE THREE","x":49.5,"y":345.1,"width":416.68},
  {"text":"sample notes line four","x":49.5,"y":333.1,"width":371.5},
  {"text":"1","x":555.59,"y":405.1,"width":6.71},
  {"text":"SPA COVER:1.5#V - SPA COVER - TAPERED","x":49.5,"y":317.5,"width":211},
  {"text":"SPA COVER EPS CUT FOAM - 1.5# VIRGIN - TAPERED - BAGGED > LABEL","x":49.5,"y":305.5,"width":423.12},
  {"text":"as ITEM#SPC21","x":49.5,"y":293.5,"width":92.32},
  {"text":"2.5” - 4” x 39” x 80”","x":49.5,"y":281.5,"width":102.1},
  {"text":"17","x":548.88,"y":317.5,"width":13.42},
  {"text":"SPA COVER:1.5#V - SPA COVER - TAPERED","x":49.5,"y":265.9,"width":211},
  {"text":"SPA COVER EPS CUT FOAM - 1.5# VIRGIN - TAPERED - BAGGED > LABEL","x":49.5,"y":253.9,"width":423.12},
  {"text":"as ITEM#SPC22","x":49.5,"y":241.9,"width":92.32},
  {"text":"2.5” - 4” x 42” x 86”","x":49.5,"y":229.9,"width":102.1},
  {"text":"119","x":542.18,"y":265.9,"width":20.12},
  {"text":"SPA COVER:1.5#V - SPA COVER - TAPERED","x":49.5,"y":214.3,"width":211},
  {"text":"SPA COVER EPS CUT FOAM - 1.5# VIRGIN - TAPERED - BAGGED > LABEL","x":49.5,"y":202.3,"width":423.12},
  {"text":"as ITEM#SPC23","x":49.5,"y":190.3,"width":92.32},
  {"text":"2.5” - 4\" x 44.5” x 91”","x":49.5,"y":178.3,"width":112.39},
  {"text":"68","x":548.88,"y":214.3,"width":13.42},
  {"text":"SPA COVER:1.5#V - SPA COVER - TAPERED","x":49.5,"y":162.7,"width":211},
  {"text":"SPA COVER EPS CUT FOAM - 1.5# VIRGIN - TAPERED - BAGGED > LABEL","x":49.5,"y":150.7,"width":423.12},
  {"text":"as ITEM#SPC24","x":49.5,"y":138.7,"width":92.32},
  {"text":"2.5” - 4” x 47” x 96”","x":49.5,"y":126.7,"width":102.1},
  {"text":"68","x":548.88,"y":162.7,"width":13.42},
  {"text":"SPA COVER:1.5#V - SPA COVER - TAPERED","x":49.5,"y":111.1,"width":211},
  {"text":"SPA COVER EPS CUT FOAM - 1.5# VIRGIN - TAPERED - BAGGED > LABEL","x":49.5,"y":99.1,"width":423.12},
  {"text":"as ITEM#SPC26","x":49.5,"y":87.1,"width":92.32},
  {"text":"2.5” - 4” x 48” x 110”","x":49.5,"y":75.1,"width":108.8},
  {"text":"0","x":555.59,"y":111.1,"width":6.71},
  {"text":"SPA COVER:1.5#V - SPA COVER - TAPERED","x":49.5,"y":59.5,"width":211},
  {"text":"11","x":548.88,"y":59.5,"width":13.42},
  {"text":"DESCRIPTION","x":49.5,"y":-47.64,"width":75.34},
  {"text":"QTY","x":539.81,"y":-47.64,"width":22.69},
  {"text":"SPA COVER EPS CUT FOAM - 1.5# VIRGIN - TAPERED - BAGGED > LABEL","x":49.5,"y":-66.5,"width":423.12},
  {"text":"as ITEM#SPC27","x":49.5,"y":-78.5,"width":92.32},
  {"text":"4” - 5.5” x 39” x 80”","x":49.5,"y":-90.5,"width":102.1},
  {"text":"SPA COVER:1.5#V - SPA COVER - TAPERED","x":49.5,"y":-106.1,"width":211},
  {"text":"SPA COVER EPS CUT FOAM - 1.5# VIRGIN - TAPERED - BAGGED > LABEL","x":49.5,"y":-118.1,"width":423.12},
  {"text":"as ITEM#SPC28","x":49.5,"y":-130.1,"width":92.32},
  {"text":"4” - 5.5” x 42” x 86”","x":49.5,"y":-142.1,"width":102.1},
  {"text":"33","x":548.88,"y":-106.1,"width":13.42},
  {"text":"SPA COVER:1.5#V - SPA COVER - TAPERED","x":49.5,"y":-157.7,"width":211},
  {"text":"SPA COVER EPS CUT FOAM - 1.5# VIRGIN - TAPERED - BAGGED > LABEL","x":49.5,"y":-169.7,"width":423.12},
  {"text":"as ITEM#SPC29","x":49.5,"y":-181.7,"width":92.32},
  {"text":"4” - 5.5” x 44.5” x 91”","x":49.5,"y":-193.7,"width":112.12},
  {"text":"22","x":548.88,"y":-157.7,"width":13.42},
  {"text":"SPA COVER:1.5#V - SPA COVER - TAPERED","x":49.5,"y":-209.3,"width":211},
  {"text":"SPA COVER EPS CUT FOAM - 1.5# VIRGIN - TAPERED - BAGGED > LABEL","x":49.5,"y":-221.3,"width":423.12},
  {"text":"as ITEM#SPC30","x":49.5,"y":-233.3,"width":92.32},
  {"text":"4\" - 5.5” x 47” x 96”","x":49.5,"y":-245.3,"width":102.37},
  {"text":"33","x":548.88,"y":-209.3,"width":13.42},
  {"text":"SPA COVER:1.5#V - SPA COVER - TAPERED","x":49.5,"y":-260.9,"width":211},
  {"text":"SPA COVER EPS CUT FOAM - 1.5# VIRGIN - TAPERED - BAGGED > LABEL","x":49.5,"y":-272.9,"width":423.12},
  {"text":"as ITEM#SPC32","x":49.5,"y":-284.9,"width":92.32},
  {"text":"4” - 5.5” x 48” x 110”","x":49.5,"y":-296.9,"width":108.8},
  {"text":"0","x":555.59,"y":-260.9,"width":6.71},
  {"text":"Fee:Credit Card Processing Fee","x":49.5,"y":-312.5,"width":143.78},
  {"text":"Credit Card Processing Fee","x":49.5,"y":-324.5,"width":148.44},
  {"text":"1","x":555.59,"y":-312.5,"width":6.71},
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
  {
    name: "SYN 9101 — zones format A (checksum ok/mismatch, no-ordinal)",
    items: SYN_ZONED_A,
    expect: {
      invoice_number: "9101",
      offload_zones_enabled: 1,
      offload_warnings: [
        { type: "checksum_mismatch", zone_label: "ED VESTIBULE", expected_bdft: 999, computed_bdft: 910 },
        { type: "missing_ordinal", zone_label: "GIFT SHOP" },
      ],
      line_items: [
        { quantity: 10, description: "Foam Block 1.0# RC - PLAIN", offload_seq: null, zone_label: null, zone_bdft: null },
        { quantity: 10, thickness: 5.25, offload_seq: 1, zone_label: "CANOPY NORTH", zone_bdft: 820 },
        { quantity: 8, thickness: 6.25, offload_seq: 1, zone_label: "CANOPY NORTH", zone_bdft: 820 },
        { quantity: 6, thickness: 6, offload_seq: 1, zone_label: "CANOPY NORTH", zone_bdft: null },
        { quantity: 10, thickness: 7.25, offload_seq: 2, zone_label: "ED VESTIBULE", zone_bdft: 999 },
        { quantity: 5, thickness: 8.25, offload_seq: 2, zone_label: "ED VESTIBULE", zone_bdft: 999 },
        { quantity: 4, thickness: 5.25, offload_seq: null, zone_label: "GIFT SHOP", zone_bdft: 168 },
      ],
    },
  },
  {
    name: "SYN 9102 — zones format B ({N pieces} row, late-stated ordinal)",
    items: SYN_ZONED_B,
    expect: {
      invoice_number: "9102",
      offload_zones_enabled: 1,
      offload_warnings: [],
      line_items: [
        { quantity: 20, thickness: 6.25, offload_seq: 1, zone_label: "AREA B", zone_bdft: 1580 },
        { quantity: 10, thickness: 7.25, offload_seq: 1, zone_label: "AREA B", zone_bdft: 1580 },
        { quantity: 27, thickness: 4, offload_seq: 1, zone_label: "AREA B", zone_bdft: 864 },
        { quantity: 8, thickness: 5.25, offload_seq: 2, zone_label: "AREA C", zone_bdft: 336 },
        { quantity: 3, thickness: 5.25, offload_seq: 3, zone_label: "AREA D", zone_bdft: null },
        { quantity: 2, thickness: 6.25, offload_seq: 3, zone_label: "AREA D", zone_bdft: null },
      ],
    },
  },
  {
    name: "SYN 9103 — category vs description density conflict",
    items: SYN_DENSITY_CONFLICT,
    expect: {
      invoice_number: "9103",
      offload_zones_enabled: 0,
      offload_warnings: [],
      line_items: [
        { quantity: 12, thickness: 6.25, density_conflict: { category_density: 2, description_density: 1 } },
        { quantity: 5, thickness: 7.25, density_conflict: null },
      ],
    },
  },
  {
    name: "INV 4477 — tapered thickness range kept (2.5>4)",
    items: INV_4477_ITEMS,
    expect: {
      invoice_number: "4477",
      line_items: [
        { quantity: 17, dimensions: "2.5>4” x 39” x 80”" },
        { quantity: 119, dimensions: "2.5>4” x 42” x 86”" },
        { quantity: 68, dimensions: '2.5>4" x 44.5” x 91”' },
        { quantity: 68, dimensions: "2.5>4” x 47” x 96”" },
        { quantity: 11, dimensions: "4>5.5” x 39” x 80”" },
        { quantity: 33, dimensions: "4>5.5” x 42” x 86”" },
        { quantity: 22, dimensions: "4>5.5” x 44.5” x 91”" },
        { quantity: 33, dimensions: "4>5.5” x 47” x 96”" },
      ],
    },
  },
];
