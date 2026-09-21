// src/lib/bolShared.selfcheck.ts
// Structural parity self-check for bolShared.ts (P435, unit 1 of the logistics v2 migration).
// Pure, no PDF render — mirrors src/lib/bagLabels.selfcheck.ts's shape. Not wired into the
// production build path.
//
// Asserts the ported coordinate constants and formatting helpers equal the legacy values by
// comparing against the SAME numbers hard-coded straight from logistics/bol-shared.js. This
// catches transcription drift in the coordinate map; it does NOT render a PDF (that's
// scripts/bol-parity.mjs's job — pixel parity against a real pdf-lib render).
import { PDFDocument } from "pdf-lib";
import {
  COORDS,
  PAGE,
  FIELD_MAP,
  COMMODITY_TIERS,
  ZONE_COLUMN_TIERS,
  buildShipToLines,
  wrapText,
  formatBolDate,
  pickCommodityTier,
  pickZoneColumnTier,
  isBaseDensity,
  buildZoneColumnLines,
  buildZoneColumns,
  hashJobZoneData,
  resolveFieldLineStyle,
  measureStyledField,
  generatePdf,
  type WidthMeasurer,
  type BolRecord,
  type ZoneSegment,
  type JobZoneLineItem,
  type BolFieldStyle,
} from "./bolShared";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

// Legacy COORDS, transcribed directly from logistics/bol-shared.js (P435 prompt's own source of
// truth) — NOT derived from bolShared.ts's own COORDS export, so this actually catches drift.
const LEGACY_COORDS = {
  deliveryTime: { x: 390, y: 758, size: 24, lineH: 28, maxW: 200 },
  date: { x: 346, y: 712, size: 10 },
  bolNumber: { x: 408, y: 690, size: 22, bold: true },
  carrierName: { x: 389, y: 648, size: 10 },
  trailerNo: { x: 365, y: 622, size: 12, bold: true },
  shipLine1: { x: 95, y: 615, size: 10 },
  shipLine2: { x: 95, y: 601, size: 10 },
  shipLine3: { x: 95, y: 587, size: 10 },
  shipLine4: { x: 95, y: 573, size: 10 },
  specialInstr: { x: 315, y: 585, size: 9, lineH: 12, maxW: 255 },
  contactInfo: { x: 315, y: 525, size: 12, lineH: 13, maxW: 255 },
  poNumber: { x: 315, y: 468, size: 12, lineH: 13, maxW: 255 },
  scrapYes: { x: 109, y: 512, size: 13 },
  scrapNo: { x: 109, y: 496, size: 13 },
  commodity: { x: 55, y: 380, size: 13, lineH: 28, maxW: 510, center: true },
  qrCode: { x: 40, y: 222, size: 60 },
  shipperSignature: { x: 37, y: 48, size: 22 },
  shipperDate: { x: 157, y: 48, size: 8 },
  // lbz-bol-01/lbz-bol-02: COORDS.zoneColumns, bolted onto COORDS after the initial literal in
  // legacy (`COORDS.zoneColumns = {...}`) — transcribed here the same way as every other entry.
  zoneColumns: { x: 55, y: 380, maxW: 510, cols: 3, colMaxH: [95, 216, 216] },
};

const LEGACY_PAGE = { width: 612, height: 792 };

const LEGACY_COMMODITY_TIERS = [
  { size: 26, lineH: 32, maxLines: 2 },
  { size: 22, lineH: 28, maxLines: 4 },
  { size: 18, lineH: 22, maxLines: 7 },
  { size: 15, lineH: 18, maxLines: 11 },
  { size: 12, lineH: 14, maxLines: 18 },
  { size: 10, lineH: 12, maxLines: Infinity },
];

// lbz-bol-01's ZONE_COLUMN_TIERS is a DELIBERATE duplicate of the commodity tier table (see
// bolShared.ts's comment on the export) — not a shared reference — so it gets its own transcribed
// constant here rather than reusing LEGACY_COMMODITY_TIERS, to actually catch drift if one changes
// without the other.
const LEGACY_ZONE_COLUMN_TIERS = [
  { size: 26, lineH: 32, maxLines: 2 },
  { size: 22, lineH: 28, maxLines: 4 },
  { size: 18, lineH: 22, maxLines: 7 },
  { size: 15, lineH: 18, maxLines: 11 },
  { size: 12, lineH: 14, maxLines: 18 },
  { size: 10, lineH: 12, maxLines: Infinity },
];

// A measurer whose width ignores fontSize entirely (constant per character) so wrapText's line
// count for a given text is deterministic across every commodity tier's font size — makes
// pickCommodityTier's tier-cascade testable without a real pdf-lib font.
const FIXED_WIDTH_MEASURER: WidthMeasurer = {
  widthOfTextAtSize: (text: string) => text.length,
};

// N words of 300 chars each — each word alone fits under COORDS.commodity.maxW (510), but any two
// combined exceed it, so under FIXED_WIDTH_MEASURER each word forces its own wrapped line.
function nOneLineWords(n: number): string {
  return Array.from({ length: n }, () => "A".repeat(300)).join(" ");
}

export function runBolSharedSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  // --- COORDS / PAGE / COMMODITY_TIERS equal legacy values verbatim ---
  check(
    "COORDS matches legacy bol-shared.js verbatim",
    JSON.stringify(COORDS) === JSON.stringify(LEGACY_COORDS),
    JSON.stringify(COORDS) === JSON.stringify(LEGACY_COORDS) ? undefined : `got=${JSON.stringify(COORDS)}`
  );
  check("PAGE matches legacy (612x792 US Letter)", JSON.stringify(PAGE) === JSON.stringify(LEGACY_PAGE), JSON.stringify(PAGE));
  check(
    "COMMODITY_TIERS matches legacy pickCommodityTier's inline tier table",
    JSON.stringify(COMMODITY_TIERS) === JSON.stringify(LEGACY_COMMODITY_TIERS),
    JSON.stringify(COMMODITY_TIERS)
  );
  check(
    "ZONE_COLUMN_TIERS matches legacy's deliberate duplicate tier table (lbz-bol-01)",
    JSON.stringify(ZONE_COLUMN_TIERS) === JSON.stringify(LEGACY_ZONE_COLUMN_TIERS),
    JSON.stringify(ZONE_COLUMN_TIERS)
  );

  // --- FIELD_MAP: same 12 entries (zoneColumns inserted after commodity, before scrap — lbz-bol-01/
  //     lbz-bol-02), same order, coord refs point at the real COORDS objects ---
  const expectedKeys = [
    "deliveryTime",
    "date",
    "bolNumber",
    "carrierName",
    "trailerNo",
    "shipTo",
    "specialInstr",
    "contactInfo",
    "poNumber",
    "commodity",
    "zoneColumns",
    "scrap",
  ];
  check(
    "FIELD_MAP has the 12 legacy entries in order",
    JSON.stringify(FIELD_MAP.map((f) => f.key)) === JSON.stringify(expectedKeys),
    JSON.stringify(FIELD_MAP.map((f) => f.key))
  );
  check("FIELD_MAP.deliveryTime.coord === COORDS.deliveryTime (same object)", FIELD_MAP[0].coord === COORDS.deliveryTime);
  check(
    "FIELD_MAP.shipTo.coords === [shipLine1..4] (same objects, in order)",
    Array.isArray(FIELD_MAP[5].coords) &&
      (FIELD_MAP[5].coords as unknown[])[0] === COORDS.shipLine1 &&
      (FIELD_MAP[5].coords as unknown[])[3] === COORDS.shipLine4
  );
  check(
    "FIELD_MAP.zoneColumns.coord === COORDS.zoneColumns (same object), type 'zonecolumns'",
    FIELD_MAP[10].key === "zoneColumns" && FIELD_MAP[10].type === "zonecolumns" && FIELD_MAP[10].coord === COORDS.zoneColumns
  );
  check(
    "FIELD_MAP.scrap.coords === {yes:scrapYes,no:scrapNo} (same objects)",
    !Array.isArray(FIELD_MAP[11].coords) &&
      (FIELD_MAP[11].coords as { yes: unknown; no: unknown }).yes === COORDS.scrapYes &&
      (FIELD_MAP[11].coords as { yes: unknown; no: unknown }).no === COORDS.scrapNo
  );

  // --- buildShipToLines ---
  {
    const full = buildShipToLines({
      ship_to_company: "ABC Co",
      ship_to_attention: "John",
      ship_to_street: "123 Main",
      ship_to_street2: "Suite 5",
      ship_to_city: "Town",
      ship_to_state: "FL",
      ship_to_zip: "33000",
    });
    check(
      "buildShipToLines: all 4 lines in order",
      JSON.stringify(full) === JSON.stringify(["ABC Co", "John", "123 Main, Suite 5", "Town, FL, 33000"]),
      JSON.stringify(full)
    );
  }
  {
    const partial = buildShipToLines({ ship_to_company: "ABC Co", ship_to_city: "Town", ship_to_state: "FL", ship_to_zip: "33000" });
    check(
      "buildShipToLines: skips missing attention/street lines, keeps order",
      JSON.stringify(partial) === JSON.stringify(["ABC Co", "Town, FL, 33000"]),
      JSON.stringify(partial)
    );
  }
  check("buildShipToLines: empty source -> []", buildShipToLines({}).length === 0);

  // --- formatBolDate ---
  check("formatBolDate: ISO date -> MM/DD/YYYY", formatBolDate("2026-06-05") === "06/05/2026");
  check("formatBolDate: non-ISO input passes through unchanged", formatBolDate("TBD") === "TBD");
  check("formatBolDate: falsy input -> ''", formatBolDate("") === "" && formatBolDate(undefined) === "" && formatBolDate(null) === "");

  // --- wrapText algorithm (deterministic fake measurer; real font widths verified by the PDF
  //     parity harness, not here) ---
  {
    const measurer: WidthMeasurer = { widthOfTextAtSize: (text) => text.length };
    const wrapped = wrapText("hello world foo", measurer, 1, 10);
    check("wrapText: greedily fills a line then wraps on overflow", JSON.stringify(wrapped) === JSON.stringify(["hello", "world foo"]), JSON.stringify(wrapped));
  }
  {
    const measurer: WidthMeasurer = { widthOfTextAtSize: (text) => text.length };
    const wrapped = wrapText("a\n\nb", measurer, 1, 9999);
    check("wrapText: blank paragraph between two lines is preserved as an empty line", JSON.stringify(wrapped) === JSON.stringify(["a", "", "b"]), JSON.stringify(wrapped));
  }
  {
    const measurer: WidthMeasurer = { widthOfTextAtSize: (text) => text.length };
    const wrapped = wrapText("Line one\nLine two", measurer, 1, 9999);
    check(
      "wrapText: splits on explicit newlines into separate paragraphs/lines",
      JSON.stringify(wrapped) === JSON.stringify(["Line one", "Line two"]),
      JSON.stringify(wrapped)
    );
  }

  // --- pickCommodityTier tier cascade (fixed-width measurer makes line count independent of the
  //     tier's font size, so each boundary below tests COMMODITY_TIERS' cascade directly) ---
  const tierCases: Array<[number, number]> = [
    [2, 26],
    [3, 22],
    [7, 18],
    [8, 15],
    [18, 12],
    [19, 10],
  ];
  for (const [words, expectedSize] of tierCases) {
    const { size } = pickCommodityTier(nOneLineWords(words), FIXED_WIDTH_MEASURER);
    check(`pickCommodityTier: ${words}-line commodity text -> size ${expectedSize}`, size === expectedSize, `got size=${size}`);
  }

  // --- Zoned BOL fixture ("Job 3371, Truck 1", lbz-bol-02) ---
  // Synthetic 4-zone/3-column fixture, run through legacy's ACTUAL logistics/bol-shared.js under
  // plain node (per the lbz-bol-02 prompt: "export a fixture JSON from the legacy render logic via
  // a node harness"). No real job 3371 exists in this repo (no matching row anywhere under
  // DB_Migrations/ or CHANGELOG.md fixture references) — this is a representative synthetic fixture
  // built the same way lbz-bol-01's own CHANGELOG entry describes verifying zone-mode-off
  // regression: "a synthetic 3-zone/3-column trace matching the confirmed manual-BOL format
  // exactly". The values below (LEGACY_ZONE_*) were captured VERBATIM from that node harness run
  // against logistics/bol-shared.js's exported buildZoneColumnLines/pickZoneColumnTier/
  // buildZoneColumns/hashJobZoneData/isBaseDensity, using the same FIXED_WIDTH_MEASURER as above so
  // the packing algorithm is exercised identically in both languages without depending on real
  // pdf-lib font metrics (out of scope here — that's the separate PDF-parity harness's job). This
  // fixture also exercises first-fit column reuse: Zone A (offloadSeq 1) itself overflows column
  // 0's 95pt cap and lands in column 1; Zone D (offloadSeq 4, last) then lands UNDER Zone A in that
  // same column 1 once column 0 fills up — the "later zone lands under an earlier column" mechanic
  // lbz-bol-01 built buildZoneColumns for.
  const zoneFixtureSegments: ZoneSegment[] = [
    {
      offloadSeq: 1,
      label: "Zone A - Dock 3",
      skuBreakdown: {
        s1: { skuId: "s1", name: "HB-10", sku: "HB-10", pieces: 12, height: 10, density: "1.0 RC" },
        s2: { skuId: "s2", name: "HB-4", sku: "HB-4", pieces: 40, height: 4, density: "1.0#" },
      },
    },
    {
      offloadSeq: 2,
      label: "Zone B - Dock 5",
      skuBreakdown: {
        s3: { skuId: "s3", name: "HB-9", sku: "HB-9", pieces: 13, height: 9, density: "1.0#" },
        s4: { skuId: "s4", name: "HB-6", sku: "HB-6", pieces: 27, height: 6, density: "2.0#" },
      },
    },
    {
      offloadSeq: 3,
      label: "Zone C - Dock 2",
      skuBreakdown: {
        s5: { skuId: "s5", name: "HB-8", sku: "HB-8", pieces: 5, height: 8, density: "1.0" },
        s6: { skuId: "s6", name: "HB-5", sku: "HB-5", pieces: 9, height: 5, density: "1.5#" },
        s7: { skuId: "s7", name: "HB-3", sku: "HB-3", pieces: 21, height: 3, density: "" },
      },
    },
    {
      offloadSeq: 4,
      label: "Zone D - Dock 7",
      skuBreakdown: {
        s8: { skuId: "s8", name: "HB-12", sku: "HB-12", pieces: 2, height: 12, density: "1.0" },
      },
    },
  ];

  const zoneFixtureLineItems: JobZoneLineItem[] = [
    { id: 11, part_id: "p1", quantity: 12, offload_seq: 1, zone_label: "Zone A - Dock 3", density: "1.0 RC" },
    { id: 12, part_id: "p2", quantity: 40, offload_seq: 1, zone_label: "Zone A - Dock 3", density: "1.0#" },
    { id: 13, part_id: "p3", quantity: 13, offload_seq: 2, zone_label: "Zone B - Dock 5", density: "1.0#" },
    { id: 14, part_id: "p4", quantity: 27, offload_seq: 2, zone_label: "Zone B - Dock 5", density: "2.0#" },
    { id: 15, part_id: "p5", quantity: 5, offload_seq: 3, zone_label: "Zone C - Dock 2", density: "1.0" },
    { id: 16, part_id: "p6", quantity: 9, offload_seq: 3, zone_label: "Zone C - Dock 2", density: "1.5#" },
    { id: 17, part_id: "p7", quantity: 21, offload_seq: 3, zone_label: "Zone C - Dock 2", density: "" },
    { id: 18, part_id: "p8", quantity: 2, offload_seq: 4, zone_label: "Zone D - Dock 7", density: "1.0" },
  ];

  // Captured verbatim from `node` against logistics/bol-shared.js (see comment above).
  const LEGACY_ZONE_PER_ZONE_LINES = [
    ['--"Zone A - Dock 3"--', "*unload 1st*", '10" - 12 pcs', '4" - 40 pcs'],
    ['--"Zone B - Dock 5"--', '9" - 13 pcs', '6" - 27 pcs (2.0# density)'],
    ['--"Zone C - Dock 2"--', '8" - 5 pcs', '3" - 21 pcs', '5" - 9 pcs (1.5# density)'],
    ['--"Zone D - Dock 7"--', '12" - 2 pcs'],
  ];
  const LEGACY_ZONE_PER_ZONE_TIERS = [
    { size: 22, lineH: 28, lineCount: 4 },
    { size: 22, lineH: 28, lineCount: 3 },
    { size: 22, lineH: 28, lineCount: 4 },
    { size: 26, lineH: 32, lineCount: 2 },
  ];
  const LEGACY_ZONE_BUILD_RESULT = {
    items: [
      { label: "Zone A - Dock 3", text: '--"Zone A - Dock 3"--\n*unload 1st*\n10" - 12 pcs\n4" - 40 pcs', x: 225, y: 380 },
      { label: "Zone B - Dock 5", text: '--"Zone B - Dock 5"--\n9" - 13 pcs\n6" - 27 pcs (2.0# density)', x: 55, y: 380 },
      { label: "Zone C - Dock 2", text: '--"Zone C - Dock 2"--\n8" - 5 pcs\n3" - 21 pcs\n5" - 9 pcs (1.5# density)', x: 395, y: 380 },
      { label: "Zone D - Dock 7", text: '--"Zone D - Dock 7"--\n12" - 2 pcs', x: 225, y: 268 },
    ],
    needsAttention: false,
  };
  const LEGACY_ZONE_HASH = "e4fa6ed1";
  const LEGACY_ZONE_IS_BASE_DENSITY: Array<[string | null | undefined, boolean]> = [
    ["1.0 RC", true],
    ["1.0#", true],
    ["1", true],
    ["", true],
    [null, true],
    [undefined, true],
    ["2.0#", false],
    ["1.04", true],
    ["0.95", false],
    ["RC", true],
    ["1.06", false],
  ];

  const colW = (COORDS.zoneColumns.maxW as number) / (COORDS.zoneColumns.cols as number);
  const tsPerZoneLines = zoneFixtureSegments.map((seg, i) => buildZoneColumnLines(seg, i === 0));
  check(
    "buildZoneColumnLines: 3371 Truck 1 fixture — identical line text to legacy (all 4 zones)",
    JSON.stringify(tsPerZoneLines) === JSON.stringify(LEGACY_ZONE_PER_ZONE_LINES),
    JSON.stringify(tsPerZoneLines)
  );

  const tsPerZoneTiers = tsPerZoneLines.map((lines) => pickZoneColumnTier(lines, FIXED_WIDTH_MEASURER, colW));
  check(
    "pickZoneColumnTier: 3371 Truck 1 fixture — identical tier picks to legacy (all 4 zones)",
    JSON.stringify(tsPerZoneTiers) === JSON.stringify(LEGACY_ZONE_PER_ZONE_TIERS),
    JSON.stringify(tsPerZoneTiers)
  );

  const tsZoneBuildResult = buildZoneColumns(zoneFixtureSegments, FIXED_WIDTH_MEASURER);
  check(
    "buildZoneColumns: 3371 Truck 1 fixture — identical items (line text + x/y column order) and needsAttention to legacy",
    JSON.stringify(tsZoneBuildResult) === JSON.stringify(LEGACY_ZONE_BUILD_RESULT),
    JSON.stringify(tsZoneBuildResult)
  );
  check(
    "buildZoneColumns: 3371 Truck 1 fixture — column order demonstrates first-fit reuse (Zone D lands under Zone A in column 1)",
    tsZoneBuildResult.items[0].x === tsZoneBuildResult.items[3].x && tsZoneBuildResult.items[3].y < tsZoneBuildResult.items[0].y
  );

  const tsZoneHash = hashJobZoneData(zoneFixtureLineItems);
  check("hashJobZoneData: 3371 Truck 1 fixture — identical hash to legacy FNV-1a output", tsZoneHash === LEGACY_ZONE_HASH, `got=${tsZoneHash}`);

  for (const [input, expected] of LEGACY_ZONE_IS_BASE_DENSITY) {
    const got = isBaseDensity(input);
    check(`isBaseDensity(${JSON.stringify(input)}) -> ${expected} (matches legacy)`, got === expected, `got=${got}`);
  }

  // needsAttention overflow path: a single zone with far more piece-lines than even the smallest
  // tier's ceiling can fit (216pt / lineH 12 = 18 lines) — never clips, flags needsAttention true
  // and falls back to the least-full column (captured verbatim from the same node harness run).
  const overflowSkuBreakdown: Record<string, { skuId: string; name: string; sku: string; pieces: number; height: number; density: string }> = {};
  for (let h = 1; h <= 30; h++) {
    overflowSkuBreakdown["o" + h] = { skuId: "o" + h, name: `HB-${h}`, sku: `HB-${h}`, pieces: h, height: h, density: "1.0" };
  }
  const overflowResult = buildZoneColumns([{ offloadSeq: 1, label: "Zone Overflow", skuBreakdown: overflowSkuBreakdown }], FIXED_WIDTH_MEASURER);
  check(
    "buildZoneColumns: overflow zone (30 lines) never clips, flags needsAttention=true (matches legacy)",
    overflowResult.needsAttention === true && overflowResult.items.length === 1 && overflowResult.items[0].x === COORDS.zoneColumns.x,
    JSON.stringify({ needsAttention: overflowResult.needsAttention, x: overflowResult.items[0]?.x })
  );

  // --- resolveFieldLineStyle (bol-style-01) ---
  const SPECIAL_INSTR_COORD = { x: 315, y: 585, size: 9, lineH: 12, maxW: 255 };
  const BOLD_DEFAULT_COORD = { x: 408, y: 690, size: 22, bold: true };

  {
    const r = resolveFieldLineStyle(undefined, 0, SPECIAL_INSTR_COORD);
    check(
      "resolveFieldLineStyle: absent _style is a no-op (exact pre-bol-style-01 defaults)",
      r.size === 9 && r.bold === false && r.italic === false && r.underline === false && r.lineH === 12,
      JSON.stringify(r)
    );
  }
  {
    const r = resolveFieldLineStyle(undefined, 0, BOLD_DEFAULT_COORD);
    check(
      "resolveFieldLineStyle: absent _style still honors the coord's own bold default (bolNumber/trailerNo/deliveryTime)",
      r.bold === true,
      JSON.stringify(r)
    );
  }
  {
    // Box sets bold+underline; line 1 overrides bold=false and sets italic — line wins per-property,
    // box fills the rest (underline), default fills what neither sets (size stays box's 18).
    const fieldStyle: BolFieldStyle = { size: 18, bold: true, underline: true, lines: { "1": { bold: false, italic: true } } };
    const line0 = resolveFieldLineStyle(fieldStyle, 0, SPECIAL_INSTR_COORD);
    const line1 = resolveFieldLineStyle(fieldStyle, 1, SPECIAL_INSTR_COORD);
    check(
      "resolveFieldLineStyle: precedence line -> box -> default — line 0 (no line override) takes the box style",
      line0.size === 18 && line0.bold === true && line0.italic === false && line0.underline === true,
      JSON.stringify(line0)
    );
    check(
      "resolveFieldLineStyle: precedence line -> box -> default — line 1's bold/italic win over the box, its underline still falls through to the box",
      line1.size === 18 && line1.bold === false && line1.italic === true && line1.underline === true,
      JSON.stringify(line1)
    );
  }
  {
    const over = resolveFieldLineStyle({ size: 200 }, 0, SPECIAL_INSTR_COORD);
    const under = resolveFieldLineStyle({ size: 1 }, 0, SPECIAL_INSTR_COORD);
    check("resolveFieldLineStyle: size clamps to the [6,36] ceiling", over.size === 36, `got=${over.size}`);
    check("resolveFieldLineStyle: size clamps to the [6,36] floor", under.size === 6, `got=${under.size}`);
  }
  {
    // A stale line-index key (no source line at that index is ever resolved against it) is simply
    // never looked up — the box style still applies untouched.
    const fieldStyle: BolFieldStyle = { size: 14, lines: { "99": { size: 30 } } };
    const r = resolveFieldLineStyle(fieldStyle, 0, SPECIAL_INSTR_COORD);
    check(
      "resolveFieldLineStyle: a stale/out-of-range line-index entry is ignored silently, box style still applies",
      r.size === 14,
      JSON.stringify(r)
    );
  }
  {
    // lineH scales with size relative to the base coord's own size/lineH ratio.
    const r = resolveFieldLineStyle({ size: 18 }, 0, SPECIAL_INSTR_COORD); // base size 9, lineH 12
    check("resolveFieldLineStyle: lineH scales proportionally with a box size override", r.lineH === 24, `got=${r.lineH}`);
  }

  // --- measureStyledField (bol-style-01) ---
  check(
    "measureStyledField: shipTo overflows past 4 source lines",
    measureStyledField("shipTo", "a\nb\nc\nd\ne", undefined).overflow === true
  );
  check(
    "measureStyledField: shipTo does not overflow at exactly 4 source lines",
    measureStyledField("shipTo", "a\nb\nc\nd", undefined).overflow === false
  );
  check(
    "measureStyledField: absent style on a short commodity string does not overflow",
    measureStyledField("commodity", "Short text", undefined).overflow === false
  );
  check(
    "measureStyledField: an oversized box style on a long commodity string overflows",
    measureStyledField("commodity", nOneLineWords(1).repeat(20), { size: 36 }).overflow === true
  );
  check(
    "measureStyledField: unknown fieldKey returns a zeroed, non-overflowing result",
    JSON.stringify(measureStyledField("notAField", "text", undefined)) === JSON.stringify({ lines: 0, height: 0, overflow: false })
  );
  {
    const zc = measureStyledField("zoneCol0", "line1\nline2", undefined);
    check("measureStyledField: zoneCol0 uses COORDS.zoneColumns.colMaxH[0] (95pt) as its budget", zc.overflow === false, JSON.stringify(zc));
  }

  return { pass: results.every((r) => r.pass), results };
}

// --- generatePdf's append-PDF merge paths (lb-ui-09) ---
// Neither packingSlipPdfBytes nor its new sibling loadingDiagramPdfBytes had any test coverage
// before this prompt — confirmed by reading this file in full during lb-ui-09's Step 0 (no
// generatePdf call anywhere above). Part C: "if it isn't tested today, add coverage for both while
// you're in there, and say so." This is that coverage, split into its own async export since
// generatePdf itself is async and runBolSharedSelfCheck above is synchronous (changing its
// signature would break the convention every other run*SelfCheck() export in this codebase follows
// — see loadingDiagramPdf.selfcheck.ts etc. — so a second export, not a widened one).
async function makeMinimalPdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc.save();
}

export async function runBolSharedPdfMergeSelfCheck(): Promise<{ pass: boolean; results: CheckResult[] }> {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  const templateBytes = await makeMinimalPdfBytes();
  const bolRecords: BolRecord[] = [{ bol_number: "TEST-1", ship_to_company: "Test Co" }];

  const basePdf = await generatePdf(bolRecords, { templateBytes });
  const baseDoc = await PDFDocument.load(basePdf);
  check("generatePdf with no append option: 1 page (1 bolRecord, no merge)", baseDoc.getPageCount() === 1, `pages=${baseDoc.getPageCount()}`);

  const packingSlipPdfBytes = await makeMinimalPdfBytes();
  const withPackingSlip = await generatePdf(bolRecords, { templateBytes, packingSlipPdfBytes });
  const packingDoc = await PDFDocument.load(withPackingSlip);
  check(
    "generatePdf with packingSlipPdfBytes: 2 pages (base + 1 merged page)",
    packingDoc.getPageCount() === 2,
    `pages=${packingDoc.getPageCount()}`
  );

  const loadingDiagramPdfBytes = await makeMinimalPdfBytes();
  const withDiagram = await generatePdf(bolRecords, { templateBytes, loadingDiagramPdfBytes });
  const diagramDoc = await PDFDocument.load(withDiagram);
  check(
    "generatePdf with loadingDiagramPdfBytes: 2 pages (base + 1 merged page)",
    diagramDoc.getPageCount() === 2,
    `pages=${diagramDoc.getPageCount()}`
  );

  const withBoth = await generatePdf(bolRecords, { templateBytes, packingSlipPdfBytes, loadingDiagramPdfBytes });
  const bothDoc = await PDFDocument.load(withBoth);
  check(
    "generatePdf with BOTH options: 3 pages (base + packing slip + diagram, packing slip first)",
    bothDoc.getPageCount() === 3,
    `pages=${bothDoc.getPageCount()}`
  );

  // Malformed append bytes must not throw generatePdf itself — both merge blocks catch-and-log,
  // matching the existing packingSlipPdfBytes try/catch this mirrors.
  const malformed = new Uint8Array([1, 2, 3]);
  let threw = false;
  try {
    await generatePdf(bolRecords, { templateBytes, loadingDiagramPdfBytes: malformed });
  } catch {
    threw = true;
  }
  check("generatePdf: malformed loadingDiagramPdfBytes is caught internally, does not throw", !threw);

  return { pass: results.every((r) => r.pass), results };
}
