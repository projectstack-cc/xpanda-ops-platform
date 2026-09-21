// src/lib/bolShared.ts
// Port of logistics/bol-shared.js (P435, unit 1 of the logistics v2 migration) — the headless BOL
// PDF coordinate + render engine. `bol-shared.js` is the single source of truth for BOL PDF
// coordinates/rendering, consumed by legacy's bol-compose.js (shared BOL engine) and bol-editor.js.
// This port carries ONLY that render engine — bol-compose.js/bol-editor.js (the compose/editor UI)
// are rebuilt as React in a later unit and are NOT ported here.
//
// PARITY RULE: every coordinate, drawText call, page dimension, font size, and the qrcode +
// fontkit usage below is transcribed EXACTLY from bol-shared.js. The rendered PDF must stay
// pixel-identical to legacy — do not "improve" layout, spacing, or values here. Verify any future
// edit against cutting-pilot/scripts/bol-parity.mjs (byte/visual comparison harness) and against
// logistics/bol-shared.js directly. While legacy and v2 coexist, any change to BOL rendering must
// be mirrored across BOTH files.
//
// lbz-bol-02: ported lbz-bol-01's zoned-BOL commodity columns (COORDS.zoneColumns, the
// "zonecolumns" FIELD_MAP entry, pickZoneColumnTier/isBaseDensity/buildZoneColumnLines/
// buildZoneColumns/hashJobZoneData, and the render_overrides.zoneColumns branch in generatePdf)
// 1:1 into this file. No v2 editor UI in that prompt — rendering parity only; see BACKLOG.md for
// the v2 zone-column editing follow-up (folded into the v2 load builder port note).
//
// Structural changes made during this port (none alter a drawn pixel):
//   - DOM/download glue lifted OUT of the lib (pure module, no window/document): `generatePdf`
//     always returns the rendered PDF bytes (Uint8Array) instead of opening a blob URL in a new
//     tab; the window-open + blob-revoke helper (`openPdf`) and the DOM confirm-dialog helper
//     (`confirmNoBolNumber`) are NOT ported — both are consumer-UI glue for the later
//     bol-compose.js/bol-editor.js React rebuild (unit 2) to reimplement.
//   - Legacy fetches the BOL template PDF and the cursive signature font itself (by URL, via
//     `fetch`, keyed on `opts.copyType`). A pure lib can't assume a DOM/fetch environment (the
//     parity harness runs in Node), so the caller now supplies `templateBytes` /
//     `scriptFontBytes` directly. `TEMPLATE_ASSET_PATH_BY_COPY_TYPE` / `SCRIPT_FONT_ASSET_PATH`
//     below preserve the exact legacy asset paths so a future browser caller (or this file's own
//     parity script) doesn't have to rediscover them.
//   - Legacy builds the QR tracking URL from `window.location.origin`, which doesn't exist in a
//     pure module. `opts.trackingBaseUrl` replaces it (defaults to `""`, producing the same
//     `/track/<token>` suffix legacy encodes relative to its origin). This is NOT a cosmetic
//     change: `qrcode(0, 'M')` auto-selects the smallest QR version that fits the encoded string,
//     so the string length directly determines module count, `cellSize`, and every drawn
//     rectangle. Callers MUST pass the real production origin (`https://www.xpandaops.com`) for
//     the QR's drawn geometry to match legacy's `window.location.origin` output; the `""` default
//     also produces a relative `/track/<token>` URL that won't resolve if scanned. Unit 2 should
//     wire this from a fixed constant or `window.location.origin` in the browser, not leave it
//     optional/omitted.
//   - `window.fontkit` is a runtime-truthy CDN-global check in legacy (always true once the CDN
//     script has loaded); it's replaced by a real `@pdf-lib/fontkit` import, so the check
//     collapses to "was scriptFontBytes provided" (see Step 2 of the porting prompt).
//   - Legacy's inline FRSCRIPT.TTF magic-byte sniff (guards against a 200 OK that's actually the
//     app-shell HTML, e.g. a case-sensitivity path miss on Cloudflare Pages) is extracted to the
//     named export `isLikelyFontBytes` so a future browser caller can reuse the exact check before
//     passing `scriptFontBytes` in.
//   - The commodity-tier lookup table (`pickCommodityTier`'s inline array) is extracted to the
//     named export `COMMODITY_TIERS` and the inline date formatter to `formatBolDate`, so the
//     structural self-check (`bolShared.selfcheck.ts`) can assert on them directly without
//     spinning up a real pdf-lib font (self-check is pure, no PDF render).
//   - `wrapText`'s font parameter is typed as the minimal `WidthMeasurer` shape (only
//     `widthOfTextAtSize` is ever called) instead of the full pdf-lib `PDFFont`, so the
//     self-check can exercise the wrapping algorithm with a deterministic fake measurer.
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import qrcode from "qrcode-generator";

// ═══════════════════════════════════════════════════════════════════
// COORDS — Single source of truth for PDF text placement.
// Transcribed exactly from logistics/bol-shared.js. If coords need updating, update BOTH files
// until legacy is archived (see file header).
// ═══════════════════════════════════════════════════════════════════

export interface BolCoord {
  x: number;
  y: number;
  size?: number;
  bold?: boolean;
  lineH?: number;
  maxW?: number;
  center?: boolean;
  // Zone columns only (lbz-bol-01/lbz-bol-02): legacy bolts `cols`/`colMaxH` onto COORDS.zoneColumns
  // after the initial COORDS literal, so BolCoord grows these two optional fields to keep COORDS a
  // single `Record<string, BolCoord>` — mirrors legacy's shape exactly rather than splitting a new
  // parallel coord type.
  cols?: number;
  colMaxH?: number[];
}

export const COORDS: Record<string, BolCoord> = {
  // Delivery time — top-right, bold red (multiline-capable via editor override; P122)
  deliveryTime: { x: 390, y: 758, size: 24, lineH: 28, maxW: 200 },

  // Top-right block
  date: { x: 346, y: 712, size: 10 },
  bolNumber: { x: 408, y: 690, size: 22, bold: true },
  carrierName: { x: 389, y: 648, size: 10 },
  trailerNo: { x: 365, y: 622, size: 12, bold: true },

  // Ship-to address (4 lines, indented under label)
  shipLine1: { x: 95, y: 615, size: 10 },
  shipLine2: { x: 95, y: 601, size: 10 },
  shipLine3: { x: 95, y: 587, size: 10 },
  shipLine4: { x: 95, y: 573, size: 10 },

  // Special Instructions
  specialInstr: { x: 315, y: 585, size: 9, lineH: 12, maxW: 255 },

  // Contact Info
  contactInfo: { x: 315, y: 525, size: 12, lineH: 13, maxW: 255 },

  // PO / Invoice Number
  poNumber: { x: 315, y: 468, size: 12, lineH: 13, maxW: 255 },

  // Scrap Pick Up checkboxes
  scrapYes: { x: 109, y: 512, size: 13 },
  scrapNo: { x: 109, y: 496, size: 13 },

  // Commodity description (size/lineH set dynamically — see commodity render block)
  commodity: { x: 55, y: 380, size: 13, lineH: 28, maxW: 510, center: true },

  // QR code — driver tracking link (P82). Drawn only when bol.access_token exists.
  qrCode: { x: 40, y: 222, size: 60 },
  // Shipper signature — cursive (FRSCRIPT), auto-signed with the generating user's display name.
  // PLACEHOLDER coords; tune in bol-test (#3).
  shipperSignature: { x: 37, y: 48, size: 22 },
  shipperDate: { x: 157, y: 48, size: 8 },
};

// Zone columns (lbz-bol-01, ported lbz-bol-02): rendered INSIDE the existing commodity region,
// replacing it entirely on a zoned truck. Up to 3 columns left→right in ASCENDING delivery order.
// Column 0's height budget is capped short of the QR code (x 40–100, y 222–282), which sits partly
// under column 0's x-range (55–225) — column 0 stops at y=285 (95pt) to never overlap it; columns 1
// and 2 are clear of the QR entirely and reuse pickCommodityTier's own largest-tier ceiling
// (216pt = 18 lines @ size 10/lineH 12), already proven safe for this region. Mirrored exactly from
// logistics/bol-shared.js's `COORDS.zoneColumns = {...}` assignment.
COORDS.zoneColumns = {
  x: COORDS.commodity.x,
  y: COORDS.commodity.y,
  maxW: COORDS.commodity.maxW,
  cols: 3,
  colMaxH: [95, 216, 216],
};

export const PAGE = { width: 612, height: 792 }; // template is fixed US Letter

// Field map — single source of truth for what is editable and how it renders.
export type BolFieldType = "single" | "multiline" | "shipto" | "scrap" | "zonecolumns";

export interface BolFieldMapEntry {
  key: string;
  type: BolFieldType;
  coord?: BolCoord;
  coords?: BolCoord[] | { yes: BolCoord; no: BolCoord };
  overrideKey: string;
}

export const FIELD_MAP: BolFieldMapEntry[] = [
  { key: "deliveryTime", type: "multiline", coord: COORDS.deliveryTime, overrideKey: "deliveryTime" },
  { key: "date", type: "single", coord: COORDS.date, overrideKey: "date" },
  { key: "bolNumber", type: "single", coord: COORDS.bolNumber, overrideKey: "bolNumber" },
  { key: "carrierName", type: "single", coord: COORDS.carrierName, overrideKey: "carrierName" },
  { key: "trailerNo", type: "single", coord: COORDS.trailerNo, overrideKey: "trailerNo" },
  {
    key: "shipTo",
    type: "shipto",
    coords: [COORDS.shipLine1, COORDS.shipLine2, COORDS.shipLine3, COORDS.shipLine4],
    overrideKey: "shipTo",
  },
  { key: "specialInstr", type: "multiline", coord: COORDS.specialInstr, overrideKey: "specialInstr" },
  { key: "contactInfo", type: "multiline", coord: COORDS.contactInfo, overrideKey: "contactInfo" },
  { key: "poNumber", type: "multiline", coord: COORDS.poNumber, overrideKey: "poNumber" },
  { key: "commodity", type: "multiline", coord: COORDS.commodity, overrideKey: "commodity" },
  { key: "zoneColumns", type: "zonecolumns", coord: COORDS.zoneColumns, overrideKey: "zoneColumns" },
  { key: "scrap", type: "scrap", coords: { yes: COORDS.scrapYes, no: COORDS.scrapNo }, overrideKey: "scrap" },
];

// Commodity size tiers — extracted from pickCommodityTier's inline array (structural change only;
// see file header). Picks the tier from text + pdf-lib font, shared by both the un-overridden
// (Prompt 66) and override render paths so they stay in sync.
export interface CommodityTier {
  size: number;
  lineH: number;
  maxLines: number;
}

export const COMMODITY_TIERS: CommodityTier[] = [
  { size: 26, lineH: 32, maxLines: 2 },
  { size: 22, lineH: 28, maxLines: 4 },
  { size: 18, lineH: 22, maxLines: 7 },
  { size: 15, lineH: 18, maxLines: 11 },
  { size: 12, lineH: 14, maxLines: 18 },
  { size: 10, lineH: 12, maxLines: Infinity },
];

// NOTE: spec suggests pickCommodityTier(lineCount) but lineCount depends on font size per tier, so
// (text, pdfFont) is the correct signature (same as legacy).
export function pickCommodityTier(text: string, pdfFont: WidthMeasurer): { size: number; lineH: number } {
  for (const t of COMMODITY_TIERS) {
    if (wrapText(String(text), pdfFont, t.size, COORDS.commodity.maxW as number).length <= t.maxLines) {
      return { size: t.size, lineH: t.lineH };
    }
  }
  return { size: 10, lineH: 12 };
}

// ═══════════════════════════════════════════════════════════════════
// ZONE COLUMNS (lbz-bol-01, ported 1:1 lbz-bol-02)
// PARITY RULE: this section mirrors logistics/bol-shared.js's "ZONE COLUMNS (lbz-bol-01)" block
// line-for-line. Any legacy render defect found while porting is reported separately, NOT silently
// fixed here — a paired fix must land in both files together (bilateral parity).
// ═══════════════════════════════════════════════════════════════════

// Duplicated from COMMODITY_TIERS on purpose: pickCommodityTier's existing body/signature is a hard
// regression boundary (non-zone commodity rendering must stay byte-for-byte identical), so zone
// columns get their own copy tuned against COLUMN width instead of full commodity width. Keep the
// two lists in sync by eye if tiers ever change (mirrors legacy's ZONE_COLUMN_TIERS — a deliberate
// duplicate, not a shared reference).
export const ZONE_COLUMN_TIERS: CommodityTier[] = [
  { size: 26, lineH: 32, maxLines: 2 },
  { size: 22, lineH: 28, maxLines: 4 },
  { size: 18, lineH: 22, maxLines: 7 },
  { size: 15, lineH: 18, maxLines: 11 },
  { size: 12, lineH: 14, maxLines: 18 },
  { size: 10, lineH: 12, maxLines: Infinity },
];

// One entry of a zone's `skuBreakdown` map, as produced by legacy's `enrichZoneSkuBreakdown`
// (lbz-bol-01, load-builder.html — not ported here, out of scope for this rendering-parity prompt).
export interface ZoneColumnSkuBreakdownEntry {
  skuId?: string;
  name?: string;
  sku?: string;
  color?: string;
  pieces: number;
  height?: number | string | null;
  density?: string | null;
}

// One zone segment, as produced by lbz-pack-01's zone/truck sequencing wrapper (not ported here).
export interface ZoneSegment {
  offloadSeq?: number | null;
  label: string;
  color?: string;
  pieces?: number;
  skuBreakdown?: Record<string, ZoneColumnSkuBreakdownEntry>;
}

// Picks the largest tier whose wrapped line count fits, against an arbitrary column width. `lines`
// is an array of PRE-WRAP raw lines (e.g. one buildZoneColumnLines() output); each gets
// independently wrapped and the counts summed. The last tier's maxLines is Infinity, so this always
// returns.
export function pickZoneColumnTier(
  lines: string[] | null | undefined,
  pdfFont: WidthMeasurer,
  colW: number
): { size: number; lineH: number; lineCount: number } {
  for (const t of ZONE_COLUMN_TIERS) {
    const wrapped = (lines || []).reduce((n, l) => n + wrapText(String(l), pdfFont, t.size, colW).length, 0);
    if (wrapped <= t.maxLines) return { size: t.size, lineH: t.lineH, lineCount: wrapped };
  }
  /* istanbul ignore next -- unreachable: last tier's maxLines is Infinity */
  return { size: 10, lineH: 12, lineCount: (lines || []).length };
}

// Treats a density string as "base/standard" (no suffix shown) when its leading numeric value is
// ~1.0 (matches free-text job_line_items.density values like "1.0 RC", "1.0#", "1"). Blank or
// unparsable values are ALSO treated as base — never show a density suffix we can't back with a
// clearly non-base reading (never guess).
export function isBaseDensity(density: string | null | undefined): boolean {
  if (!density) return true;
  const m = String(density).match(/-?\d+(\.\d+)?/);
  if (!m) return true;
  return Math.abs(parseFloat(m[0]) - 1.0) < 0.05;
}

// Builds the raw (pre-wrap) text lines for one zone column, per the confirmed manual-BOL format:
//   --"LABEL"--
//   *unload 1st*                 (only the truck's earliest-delivery zone — isFirst)
//   10" - 1 pcs                  (base-density lines, thickness DESCENDING)
//   9" - 13 pcs
//   6" - 27 pcs (2.0# density)   (non-base-density lines, thickness descending, at the BOTTOM)
// No base-product footer line — do not add one. Each `entry` is one buildZoneColumns() skuBreakdown
// item. Entries whose height couldn't be resolved fall back to their name/sku so nothing silently
// disappears.
export function buildZoneColumnLines(seg: ZoneSegment, isFirst: boolean): string[] {
  const lines = [`--"${seg.label}"--`];
  if (isFirst) lines.push("*unload 1st*");
  const entries = Object.values(seg.skuBreakdown || {});
  const byHeightDesc = (a: ZoneColumnSkuBreakdownEntry, b: ZoneColumnSkuBreakdownEntry) =>
    (Number(b.height) || 0) - (Number(a.height) || 0);
  const base = entries.filter((e) => isBaseDensity(e.density)).sort(byHeightDesc);
  const nonBase = entries.filter((e) => !isBaseDensity(e.density)).sort(byHeightDesc);
  const lineFor = (e: ZoneColumnSkuBreakdownEntry) => {
    const h = e.height != null && e.height !== "" ? `${e.height}"` : e.name || e.sku || "";
    let l = `${h} - ${e.pieces} pcs`;
    if (!isBaseDensity(e.density)) l += ` (${e.density} density)`;
    return l;
  };
  base.forEach((e) => lines.push(lineFor(e)));
  nonBase.forEach((e) => lines.push(lineFor(e)));
  return lines;
}

export interface ZoneColumn {
  label: string;
  text: string;
  x: number;
  y: number;
}

export interface ZoneColumnsResult {
  items: ZoneColumn[];
  needsAttention: boolean;
}

/**
 * Default zone-column layout. Places each zone's text into one of COORDS.zoneColumns.cols columns
 * inside the commodity region, left→right in ASCENDING delivery order (offloadSeq) — independent of
 * the trailer diagram's nose→door physical placement, which lbz-pack-01 deliberately reverses.
 * First-fit bin-packing: each zone goes into the first (leftmost) column with enough remaining
 * vertical room, so a zone can land under an EARLIER column if a later one is already full — this
 * produces the "4th zone sits under the 2nd" layout confirmed against the manual BOL. Reuses
 * pickCommodityTier's approach (same tier list, per-column width) via pickZoneColumnTier; when even
 * the smallest tier doesn't fit, renders at min size anyway and flags needsAttention — never clips.
 */
export function buildZoneColumns(zoneSegments: ZoneSegment[] | null | undefined, pdfFont: WidthMeasurer): ZoneColumnsResult {
  const C = COORDS.zoneColumns;
  const cols = C.cols as number;
  const colMaxH = C.colMaxH as number[];
  const colW = (C.maxW as number) / cols;
  const sorted = [...(zoneSegments || [])].sort((a, b) => (a.offloadSeq ?? Infinity) - (b.offloadSeq ?? Infinity));
  const colUsed = new Array(cols).fill(0);
  const items: ZoneColumn[] = [];
  let needsAttention = false;

  sorted.forEach((seg, i) => {
    const lines = buildZoneColumnLines(seg, i === 0);
    const tier = pickZoneColumnTier(lines, pdfFont, colW);
    const renderH = tier.lineCount * tier.lineH;

    let target = -1;
    for (let c = 0; c < cols; c++) {
      const maxH = colMaxH[c] != null ? colMaxH[c] : 216;
      if (maxH - colUsed[c] >= renderH) {
        target = c;
        break;
      }
    }
    if (target === -1) {
      // Never clip: nothing has room at this tier — fall back to the least-full column anyway.
      target = colUsed.indexOf(Math.min(...colUsed));
    }
    const targetMaxH = colMaxH[target] != null ? colMaxH[target] : 216;
    const segNeedsAttention = renderH > targetMaxH - colUsed[target];

    items.push({
      label: seg.label,
      text: lines.join("\n"),
      x: (C.x as number) + target * colW,
      y: (C.y as number) - colUsed[target],
    });
    colUsed[target] += renderH;
    if (segNeedsAttention) needsAttention = true;
  });

  return { items, needsAttention };
}

// Small deterministic, non-cryptographic hash (FNV-1a) for change-detection only — never used for
// security. Returns an 8-char hex string. Kept module-private, matching legacy's `_fnv1aHex` (not
// part of the public API surface).
function fnv1aHex(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// The editable zone-assignment fields on a job's line items that hashJobZoneData hashes — exactly
// what the manual zone editor (lbz-parse-02) can change after a BOL was generated.
export interface JobZoneLineItem {
  id?: string | number | null;
  part_id?: string | number | null;
  quantity?: number | null;
  offload_seq?: number | null;
  zone_label?: string | null;
  density?: string | null;
}

// Stale-guard input (lbz-bol-01 §4): hashes the EDITABLE zone-assignment fields on a job's line
// items — offload_seq / zone_label / density / quantity / part — which is exactly what the manual
// zone editor (lbz-parse-02) can change after a BOL was generated. Hashing these (rather than the
// packed per-truck piece counts, which aren't independently reconstructable without re-running the
// untouched auto-pack algorithm) lets a later BolEditor.open() detect "this job's zones changed
// since this BOL was made" with a single fresh GET /api/jobs/:id.
export function hashJobZoneData(lineItems: JobZoneLineItem[] | null | undefined): string {
  const norm = (lineItems || [])
    .map((li) => ({
      id: String(li.id || ""),
      part_id: li.part_id || null,
      quantity: li.quantity || 0,
      offload_seq: li.offload_seq ?? null,
      zone_label: (li.zone_label || "").trim(),
      density: (li.density || "").trim(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return fnv1aHex(JSON.stringify(norm));
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS (pure — no DOM, no pdf-lib font object required beyond widthOfTextAtSize)
// ═══════════════════════════════════════════════════════════════════

export interface BolShipToSource {
  ship_to_company?: string;
  ship_to_attention?: string;
  ship_to_street?: string;
  ship_to_street2?: string;
  ship_to_city?: string;
  ship_to_state?: string;
  ship_to_zip?: string;
}

export function buildShipToLines(bol: BolShipToSource): string[] {
  const lines: string[] = [];
  if (bol.ship_to_company) lines.push(bol.ship_to_company);
  if (bol.ship_to_attention) lines.push(bol.ship_to_attention);
  const streetLine = [bol.ship_to_street, bol.ship_to_street2].filter(Boolean).join(", ");
  if (streetLine) lines.push(streetLine);
  const cityStateZip = [bol.ship_to_city, bol.ship_to_state, bol.ship_to_zip].filter(Boolean).join(", ");
  if (cityStateZip) lines.push(cityStateZip);
  return lines.slice(0, 4);
}

// Only the one method wrapText actually calls — lets the self-check exercise the wrapping
// algorithm with a deterministic fake measurer instead of a real pdf-lib font (see file header).
export interface WidthMeasurer {
  widthOfTextAtSize(text: string, size: number): number;
}

export function wrapText(text: string, font: WidthMeasurer, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split("\n");
  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }
    const words = para.split(/\s+/);
    let currentLine = "";
    for (const word of words) {
      const testLine = currentLine ? currentLine + " " + word : word;
      try {
        const width = font.widthOfTextAtSize(testLine, fontSize);
        if (width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      } catch {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  return lines;
}

// Formats an ISO 'YYYY-MM-DD' date as 'MM/DD/YYYY'; passes through anything else unchanged.
// Extracted from generatePdf's inline arrow function (structural change only; see file header).
export function formatBolDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(iso);
}

// Guards against embedding a 200-OK app-shell HTML response as if it were the FRSCRIPT.TTF
// cursive signature font (a wrong, case-sensitive asset path on Cloudflare Pages still returns
// HTML at HTTP 200). Extracted from generatePdf's inline fetch-response sniff (structural change
// only; see file header) so a future browser caller can run the same check before passing
// `scriptFontBytes` into `generatePdf`.
export function isLikelyFontBytes(bytes: ArrayBuffer | Uint8Array): boolean {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.slice(0, 4));
  if (b.length < 4) return false;
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  return (
    (b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) || // TrueType
    tag === "OTTO" ||
    tag === "true" ||
    tag === "ttcf" ||
    tag === "wOFF" ||
    tag === "wOF2"
  );
}

// Legacy asset paths, preserved as data (no fetch here — see file header). A browser caller
// resolves `templateBytes`/`scriptFontBytes` from these; the Node parity harness reads the same
// files straight off disk.
export const TEMPLATE_ASSET_PATH_BY_COPY_TYPE: { default: string; driver: string; customer: string } = {
  default: "/logistics/assets/BLANK_BOL_Xpanda.pdf",
  driver: "/logistics/assets/BLANK_BOL_Xpanda_driver.pdf",
  customer: "/logistics/assets/BLANK_BOL_Xpanda_customer.pdf",
};
export const SCRIPT_FONT_ASSET_PATH = "/logistics/assets/FRSCRIPT.TTF";

// ═══════════════════════════════════════════════════════════════════
// PDF GENERATION
// ═══════════════════════════════════════════════════════════════════

export interface BolPositionOverride {
  dx?: number;
  dy?: number;
}

// ═══════════════════════════════════════════════════════════════════
// TEXT STYLING (bol-style-01, ported 1:1) — render_overrides._style contract.
// PARITY RULE: mirrors logistics/bol-shared.js's "TEXT STYLING (bol-style-01)" block
// byte-identical (same formulas/constants). Precedence per property: line → box → existing
// COORD/tier default. Absent `_style` (every BOL before this) resolves to exactly the
// pre-bol-style-01 defaults — see resolveFieldLineStyle.
// ═══════════════════════════════════════════════════════════════════

export interface BolTextStyle {
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface BolFieldStyle extends BolTextStyle {
  lines?: Record<string, BolTextStyle>;
}

// fieldKey -> approximate available box height in PDF points, for overflow warnings only (never
// affects rendering). See logistics/bol-shared.js's FIELD_HEIGHT_BUDGET comment for derivation.
const FIELD_HEIGHT_BUDGET: Record<string, number> = {
  deliveryTime: 46, date: 20, bolNumber: 20, carrierName: 20, trailerNo: 20,
  specialInstr: 60, contactInfo: 57, poNumber: 88, commodity: 216,
};
const SHIP_TO_LINE_GAP = 14;
const SHIP_TO_MAX_LINES = 4;
const AVG_CHAR_WIDTH_RATIO = { regular: 0.5, bold: 0.56 };
function approxMeasurer(bold: boolean): WidthMeasurer {
  const ratio = bold ? AVG_CHAR_WIDTH_RATIO.bold : AVG_CHAR_WIDTH_RATIO.regular;
  return { widthOfTextAtSize: (t: string, s: number) => String(t).length * s * ratio };
}

export interface ResolvedFieldLineStyle {
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  lineH: number;
}

/**
 * Resolves the effective style for one SOURCE line of one styleable field, given that field's
 * `_style` entry (or undefined for "no style set"). Pure — no font/page dependency. `baseCoord`
 * supplies the pre-style default (its `size`/`lineH`/`bold`).
 */
export function resolveFieldLineStyle(
  fieldStyle: BolFieldStyle | undefined,
  srcLineIdx: number | null | undefined,
  baseCoord: BolCoord
): ResolvedFieldLineStyle {
  const baseSize = baseCoord.size || 10;
  const lineStyle = fieldStyle?.lines && srcLineIdx != null ? fieldStyle.lines[String(srcLineIdx)] : undefined;
  const pick = <K extends keyof BolTextStyle>(prop: K, fallback: BolTextStyle[K]): BolTextStyle[K] => {
    if (lineStyle && lineStyle[prop] !== undefined) return lineStyle[prop];
    if (fieldStyle && fieldStyle[prop] !== undefined) return fieldStyle[prop];
    return fallback;
  };
  let size = (pick("size", baseSize) as number) ?? baseSize;
  size = Math.max(6, Math.min(36, size));
  const bold = !!pick("bold", !!baseCoord.bold);
  const italic = !!pick("italic", false);
  const underline = !!pick("underline", false);
  const lineH = baseCoord.lineH ? Math.round(baseCoord.lineH * (size / baseSize)) : Math.round(size * 1.2);
  return { size, bold, italic, underline, lineH };
}

export interface MeasuredStyledField {
  lines: number;
  height: number;
  overflow: boolean;
}

/**
 * Pure helper for the v2 editor (bol-style-03): measures a field's text under a candidate `_style`
 * entry and reports whether it would overflow the field's available box. Never used by the render
 * path itself (which never clips). `fieldKey` also accepts the dynamic `zoneCol0`, `zoneCol1`, …
 * keys (item index in a zoned BOL's zoneColumns.items).
 */
export function measureStyledField(fieldKey: string, text: string, style: BolFieldStyle | undefined): MeasuredStyledField {
  const sourceLines = String(text || "").split("\n");

  if (fieldKey === "shipTo") {
    return {
      lines: sourceLines.length,
      height: sourceLines.length * SHIP_TO_LINE_GAP,
      overflow: sourceLines.length > SHIP_TO_MAX_LINES,
    };
  }

  const zoneMatch = /^zoneCol(\d+)$/.exec(fieldKey || "");
  let baseCoord: BolCoord;
  let maxW: number | null;
  let heightBudget: number;
  if (zoneMatch) {
    const idx = parseInt(zoneMatch[1], 10);
    const colMaxH = (COORDS.zoneColumns.colMaxH as number[]) || [];
    baseCoord = { x: 0, y: 0, size: 10, lineH: 12 };
    maxW = (COORDS.zoneColumns.maxW as number) / (COORDS.zoneColumns.cols as number);
    heightBudget = colMaxH[idx] != null ? colMaxH[idx] : 216;
  } else if (COORDS[fieldKey]) {
    baseCoord = COORDS[fieldKey];
    maxW = baseCoord.maxW || null;
    heightBudget = FIELD_HEIGHT_BUDGET[fieldKey] != null ? FIELD_HEIGHT_BUDGET[fieldKey] : 40;
  } else {
    return { lines: 0, height: 0, overflow: false };
  }

  let lineCount = 0;
  let totalHeight = 0;
  sourceLines.forEach((srcLine, srcIdx) => {
    const r = resolveFieldLineStyle(style, srcIdx, baseCoord);
    if (maxW) {
      const wrapped = wrapText(srcLine, approxMeasurer(r.bold), r.size, maxW);
      const n = wrapped.length || 1;
      lineCount += n;
      totalHeight += n * r.lineH;
    } else {
      lineCount += 1;
      totalHeight += r.lineH;
    }
  });

  let overflow = totalHeight > heightBudget;
  if (!overflow && maxW) {
    const minMeasurer = approxMeasurer(false);
    outer: for (const srcLine of sourceLines) {
      for (const w of srcLine.split(/\s+/).filter(Boolean)) {
        if (minMeasurer.widthOfTextAtSize(w, 6) > maxW) {
          overflow = true;
          break outer;
        }
      }
    }
  }

  return { lines: lineCount, height: totalHeight, overflow };
}

// render_overrides.zoneColumns shape (lbz-bol-01's judgment call, carried forward 1:1 in
// lbz-bol-02 — do NOT simplify back to a bare `[{label,text,x,y}]+sourceHash` shorthand). Beyond
// `items` (the clean per-box editable shape) and `sourceHash` (hashJobZoneData's output),
// `zoneData` is a frozen snapshot of the truck's zoneSegments at BOL-create time: without a DB
// migration in scope, "Reset columns" and the stale guard have no other way to regenerate/compare
// outside a live load-builder session.
export interface ZoneColumnsOverride {
  items?: ZoneColumn[];
  zoneData?: ZoneSegment[];
  sourceHash?: string;
}

export interface BolOverrides {
  _pos?: Record<string, BolPositionOverride | undefined>;
  _style?: Record<string, BolFieldStyle | undefined>;
  deliveryTime?: string | string[];
  date?: string;
  bolNumber?: string;
  carrierName?: string;
  trailerNo?: string;
  shipTo?: string[];
  specialInstr?: string | string[];
  contactInfo?: string | string[];
  poNumber?: string | string[];
  commodity?: string | string[];
  zoneColumns?: ZoneColumnsOverride;
  scrap?: boolean;
}

export interface BolRecord {
  delivery_time?: string;
  date?: string;
  bol_number?: string | number;
  carrier_name?: string;
  trailer_no?: string;
  ship_to_company?: string;
  ship_to_attention?: string;
  ship_to_street?: string;
  ship_to_street2?: string;
  ship_to_city?: string;
  ship_to_state?: string;
  ship_to_zip?: string;
  contact_name?: string;
  contact_phone?: string;
  contact_info?: string;
  po_number?: string;
  poNumber?: string;
  commodity_description?: string;
  special_instructions?: string;
  is_scrap_pickup?: number | boolean | string;
  siplast?: boolean | number;
  shipper_name?: string;
  access_token?: string;
  render_overrides?: BolOverrides | string | null;
  _overrides?: BolOverrides;
  [extra: string]: unknown;
}

export interface GeneratePdfOptions {
  copyType?: "driver" | "customer";
  /** Fixed US Letter BLANK_BOL_Xpanda*.pdf template bytes for this call's copyType. */
  templateBytes: Uint8Array | ArrayBuffer;
  /** FRSCRIPT.TTF cursive signature font bytes, or null/omitted to skip the signature line. */
  scriptFontBytes?: Uint8Array | ArrayBuffer | null;
  packingSlipPdfBytes?: Uint8Array | ArrayBuffer;
  /** lb-ui-09: restores legacy's "Include Loading Diagram" BOL option (load-builder.html:2606-2627
   * — buildBolAppendBytes). Merged the exact same way packingSlipPdfBytes above is: appended once,
   * after every bolRecords page in this call, not per-record — generatePdf is called once for the
   * whole batch, so at most one diagram can be attached per call, the same structural constraint
   * legacy's own comment names ("generatePdf is called once for all BOLs (not per-trailer)").
   * No live v2 caller threads this through today — bolDomGlue.ts's buildCombinedBolPdf does its
   * OWN separate packingSlipPdfBytes merge and never passes either option into generatePdf itself,
   * so this sits at the same "proven, not yet wired" status as packingSlipPdfBytes already has on
   * this interface. Proven correct by bolShared.selfcheck.ts's runBolSharedPdfMergeSelfCheck. */
  loadingDiagramPdfBytes?: Uint8Array | ArrayBuffer;
  hideQr?: boolean;
  /** Replaces `window.location.origin` for the QR tracking URL (`${trackingBaseUrl}/track/<token>`). */
  trackingBaseUrl?: string;
}

/**
 * Generate a BOL PDF for one or more BOL records. Returns the combined PDF bytes — opening/
 * downloading the result is the caller's job (see file header: DOM glue lifted out).
 */
export async function generatePdf(bolRecords: BolRecord[], opts: GeneratePdfOptions): Promise<Uint8Array> {
  const templateBytes = opts.templateBytes;

  const combinedPdf = await PDFDocument.create();

  for (const _bolRaw of bolRecords) {
    // Hydrate persisted overrides. The approve path passes `_overrides` already as an object; the
    // stored-view path passes a DB row whose `render_overrides` is a JSON STRING and has no
    // `_overrides`. Every render funnels through here, so this one step fixes all view callers
    // without touching any of them. Fail safe to base fields on malformed JSON; never clobber an
    // already-present object; bind a per-iteration local so repeated passes stay idempotent.
    let bol: BolRecord = _bolRaw;
    if (!bol._overrides && bol.render_overrides) {
      let _parsed: BolOverrides | null = null;
      if (typeof bol.render_overrides === "object") {
        _parsed = bol.render_overrides;
      } else if (typeof bol.render_overrides === "string" && bol.render_overrides.trim()) {
        try {
          _parsed = JSON.parse(bol.render_overrides);
        } catch {
          _parsed = null;
        }
      }
      if (_parsed && typeof _parsed === "object") {
        bol = Object.assign({}, bol, { _overrides: _parsed });
      }
    }

    const templateDoc = await PDFDocument.load(templateBytes);
    const page = templateDoc.getPages()[0];
    const font = await templateDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await templateDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await templateDoc.embedFont(StandardFonts.HelveticaOblique);
    const fontBoldItalic = await templateDoc.embedFont(StandardFonts.HelveticaBoldOblique);
    const pickFont = ({ bold, italic }: { bold: boolean; italic: boolean }): PDFFont => {
      if (bold && italic) return fontBoldItalic;
      if (bold) return fontBold;
      if (italic) return fontItalic;
      return font;
    };
    let cursive: PDFFont | null = null;
    if (opts.scriptFontBytes) {
      try {
        templateDoc.registerFontkit(fontkit);
        cursive = await templateDoc.embedFont(opts.scriptFontBytes);
      } catch {
        cursive = null;
      }
    }
    const black = rgb(0, 0, 0);

    // `overrides.fieldKey` (+ `overrides.lineIdx` for shipTo) routes a field through the style
    // resolver (bol-style-01); omitted for the two non-styleable drawText callers (scrap 'X',
    // shipperDate) which fall back to exactly their pre-bol-style-01 behavior.
    const drawText = (text: unknown, coord: BolCoord, overrides: { fieldKey?: string; lineIdx?: number } = {}) => {
      if (!text && text !== 0) return;
      const style = resolveStyle(overrides.fieldKey, overrides.lineIdx, coord);
      const o: {
        x: number;
        y: number;
        size: number;
        font: PDFFont;
        color: ReturnType<typeof rgb>;
        maxWidth?: number;
      } = {
        x: coord.x,
        y: coord.y,
        size: style.size,
        font: style.font,
        color: black,
      };
      if (coord.maxW) o.maxWidth = coord.maxW;
      page.drawText(String(text), o);
      if (style.underline) drawUnderline(String(text), o.x, o.y, style.size, style.font, black);
    };

    // Wraps per SOURCE line (text split on \n, BEFORE wrapping) so each source line can carry its
    // own resolved style; a wrapped continuation inherits its source line's style. y advances by
    // each output line's own resolved lineH (constant when no `_style` — same result as before).
    const drawMultiline = (text: unknown, coord: BolCoord, fieldKey?: string) => {
      if (!text) return;
      const maxW = coord.maxW || 250;
      const sourceLines = String(text).split("\n");
      let y = coord.y;
      sourceLines.forEach((srcLine, srcIdx) => {
        const style = resolveStyle(fieldKey, srcIdx, coord);
        const wrapped = wrapText(srcLine, style.font, style.size, maxW);
        wrapped.forEach((line) => {
          const lineOpts: { x: number; y: number; size: number; font: PDFFont; color: ReturnType<typeof rgb>; maxWidth?: number } = {
            x: coord.x,
            y,
            size: style.size,
            font: style.font,
            color: black,
          };
          if (coord.center && line) {
            const lineWidth = style.font.widthOfTextAtSize(line, style.size);
            lineOpts.x = coord.x + (maxW - lineWidth) / 2;
          } else {
            lineOpts.maxWidth = maxW;
          }
          page.drawText(line, lineOpts);
          if (style.underline && line) drawUnderline(line, lineOpts.x, y, style.size, style.font, black);
          y -= style.lineH;
        });
      });
    };

    const _ov: BolOverrides = bol._overrides || {};

    // ── Position overrides (P122 free-drag): per-field {dx,dy} deltas in PDF points ──
    const _pos = _ov._pos || {};
    const off = (key: string, coord: BolCoord): BolCoord => {
      const p = _pos[key];
      if (!p) return coord;
      return { ...coord, x: coord.x + (p.dx || 0), y: coord.y + (p.dy || 0) };
    };

    // ── Text style overrides (bol-style-01, ported 1:1): render_overrides._style, resolved against
    // real embedded fonts. `fieldKey` undefined (or absent from `_style`) resolves to exactly the
    // pre-bol-style-01 default — see resolveFieldLineStyle. ──
    const _style: Record<string, BolFieldStyle | undefined> = _ov._style || {};
    const resolveStyle = (fieldKey: string | undefined, srcLineIdx: number | null | undefined, baseCoord: BolCoord) => {
      const fieldStyle = fieldKey ? _style[fieldKey] : undefined;
      const r = resolveFieldLineStyle(fieldStyle, srcLineIdx, baseCoord);
      return { size: r.size, font: pickFont({ bold: r.bold, italic: r.italic }), underline: r.underline, lineH: r.lineH };
    };
    const drawUnderline = (text: string, x: number, y: number, size: number, drawFont: PDFFont, color: ReturnType<typeof rgb>) => {
      const w = drawFont.widthOfTextAtSize(String(text), size);
      const uy = y - Math.max(1, size * 0.12);
      const thickness = Math.max(0.5, size * 0.06);
      page.drawLine({ start: { x, y: uy }, end: { x: x + w, y: uy }, thickness, color });
    };

    // ── Delivery time (bold red, top right; multiline-capable via override — P122) ──
    // COORDS.deliveryTime has no literal `bold: true`, but this field always rendered bold before
    // bol-style-01 — synthesize it as the resolver's base default so `bold: false` can now opt out.
    const _deliveryTimeVal =
      "deliveryTime" in _ov ? (Array.isArray(_ov.deliveryTime) ? _ov.deliveryTime.join("\n") : _ov.deliveryTime) : bol.delivery_time;
    if (_deliveryTimeVal) {
      const _dc = off("deliveryTime", { ...COORDS.deliveryTime, bold: true });
      const _dSourceLines = String(_deliveryTimeVal).split("\n");
      let _dy = _dc.y;
      _dSourceLines.forEach((srcLine, srcIdx) => {
        const _dStyle = resolveStyle("deliveryTime", srcIdx, _dc);
        const _dWrapped = wrapText(srcLine, _dStyle.font, _dStyle.size, _dc.maxW || 200);
        _dWrapped.forEach((line) => {
          page.drawText(line, { x: _dc.x, y: _dy, size: _dStyle.size, font: _dStyle.font, color: rgb(1, 0, 0) });
          if (_dStyle.underline && line) drawUnderline(line, _dc.x, _dy, _dStyle.size, _dStyle.font, rgb(1, 0, 0));
          _dy -= _dStyle.lineH;
        });
      });
    }

    // ── Standard fields ──
    const _rawDate = "date" in _ov ? _ov.date : bol.date;
    const _displayDate = "date" in _ov ? String(_rawDate) : formatBolDate(_rawDate);
    drawText(_displayDate, off("date", COORDS.date), { fieldKey: "date" });
    drawText("bolNumber" in _ov ? _ov.bolNumber : String(bol.bol_number || ""), off("bolNumber", COORDS.bolNumber), { fieldKey: "bolNumber" });
    drawText("carrierName" in _ov ? _ov.carrierName : bol.carrier_name, off("carrierName", COORDS.carrierName), { fieldKey: "carrierName" });
    drawText("trailerNo" in _ov ? _ov.trailerNo : bol.trailer_no, off("trailerNo", COORDS.trailerNo), { fieldKey: "trailerNo" });

    // ── Ship-to address (up to 4 lines) ──
    const shipLines = Array.isArray(_ov.shipTo) ? _ov.shipTo : buildShipToLines(bol);
    const shipCoords = [COORDS.shipLine1, COORDS.shipLine2, COORDS.shipLine3, COORDS.shipLine4];
    shipLines.forEach((line, i) => {
      if (shipCoords[i]) drawText(line, off("shipTo", shipCoords[i]), { fieldKey: "shipTo", lineIdx: i });
    });

    // ── Special Instructions ──
    drawMultiline(
      Array.isArray(_ov.specialInstr) ? _ov.specialInstr.join("\n") : bol.special_instructions,
      off("specialInstr", COORDS.specialInstr),
      "specialInstr"
    );

    // ── Contact Info ──
    // Accept either contact_info (BOL generator) or contact_name/contact_phone (load builder).
    // Override arrives as literal lines — draw verbatim (no 'POC: ' prefix added).
    const _contactVal = Array.isArray(_ov.contactInfo)
      ? _ov.contactInfo.join("\n")
      : bol.contact_info ||
        [bol.contact_name ? "POC: " + bol.contact_name : "", bol.contact_phone || ""].filter(Boolean).join(" ");
    if (_contactVal) drawMultiline(_contactVal, off("contactInfo", COORDS.contactInfo), "contactInfo");

    // ── PO / Invoice Number ──
    // Override arrives as literal lines — draw verbatim (no 'PO: ' prefix added).
    // Default path: bold "PO:" label, regular PO number offset by the label width. The `_style`
    // box applies to the NUMBER portion only; the label stays bold but follows the box size.
    if (Array.isArray(_ov.poNumber)) {
      const _poVal = _ov.poNumber.join("\n");
      if (_poVal) drawMultiline(_poVal, off("poNumber", COORDS.poNumber), "poNumber");
    } else {
      const _poNum = bol.po_number || bol.poNumber || "";
      if (_poNum) {
        const _pc = off("poNumber", COORDS.poNumber);
        const _poStyle = resolveStyle("poNumber", 0, _pc);
        const _poLabel = "PO:";
        page.drawText(_poLabel, { x: _pc.x, y: _pc.y, size: _poStyle.size, font: fontBold, color: black });
        const _poLabelW = fontBold.widthOfTextAtSize(_poLabel + " ", _poStyle.size);
        page.drawText(String(_poNum), { x: _pc.x + _poLabelW, y: _pc.y, size: _poStyle.size, font: _poStyle.font, color: black });
        if (_poStyle.underline) drawUnderline(String(_poNum), _pc.x + _poLabelW, _pc.y, _poStyle.size, _poStyle.font, black);
      }
    }

    // ── Scrap Pick Up ──
    const _isScrap =
      typeof _ov.scrap === "boolean" ? _ov.scrap : bol.is_scrap_pickup === 1 || bol.is_scrap_pickup === true || bol.is_scrap_pickup === "1";
    drawText("X", off("scrap", _isScrap ? COORDS.scrapYes : COORDS.scrapNo));

    // ── Commodity description (centered, auto-sized by wrapped line count) ──
    // lbz-bol-01/lbz-bol-02: a zoned truck's render_overrides.zoneColumns REPLACES this block
    // entirely (rendered inside the same region, never alongside it). Absence of _ov.zoneColumns —
    // every bol before this feature, and every non-zoned bol going forward — takes the untouched
    // `else` branch below with zero behavior change.
    const _zc = _ov.zoneColumns;
    const _zcHasData = !!_zc && (((_zc.items?.length ?? 0) > 0) || ((_zc.zoneData?.length ?? 0) > 0));
    if (_zc && _zcHasData) {
      const _zcColW = (COORDS.zoneColumns.maxW as number) / (COORDS.zoneColumns.cols as number);
      const _zcItems = _zc.items && _zc.items.length ? _zc.items : buildZoneColumns(_zc.zoneData, font).items;
      _zcItems.forEach((item, itemIdx) => {
        // Styleable as `zoneCol<itemIdx>` (item index in zoneColumns.items). A box `size` REPLACES
        // pickZoneColumnTier for this column, same rule as commodity vs pickCommodityTier below.
        const _zcFieldKey = "zoneCol" + itemIdx;
        const _zcLines = String(item.text || "").split("\n");
        const _zcFieldStyle = _style[_zcFieldKey];
        const _zcHasBoxSize = !!_zcFieldStyle && _zcFieldStyle.size != null;
        const _zcTier = _zcHasBoxSize ? { size: 10, lineH: 12 } : pickZoneColumnTier(_zcLines, font, _zcColW);
        const _zcBaseCoord: BolCoord = { x: 0, y: 0, size: _zcTier.size, lineH: _zcTier.lineH };
        let _zcY = item.y;
        _zcLines.forEach((line, li) => {
          const _zcStyle = resolveStyle(_zcFieldKey, li, _zcBaseCoord);
          if (line) {
            page.drawText(line, { x: item.x, y: _zcY, size: _zcStyle.size, font: _zcStyle.font, color: black });
            if (_zcStyle.underline) drawUnderline(line, item.x, _zcY, _zcStyle.size, _zcStyle.font, black);
          }
          _zcY -= _zcStyle.lineH;
        });
      });
    } else {
      let _commodityText = Array.isArray(_ov.commodity) ? _ov.commodity.join("\n") : bol.commodity_description;
      if (_commodityText && bol.siplast) {
        // Siplast products: prefix the SKU inside parens, e.g. (HB-10) -> (Siplast HB-10)
        _commodityText = String(_commodityText).replace(/\(([^)]+)\)/g, "(Siplast $1)");
      }
      if (_commodityText) {
        // A `_style.commodity` box `size` REPLACES pickCommodityTier entirely for this BOL;
        // per-line sizes without a box size ride on top of the auto-picked tier.
        const _commodityFieldStyle = _style.commodity;
        const _commodityHasBoxSize = !!_commodityFieldStyle && _commodityFieldStyle.size != null;
        let _commodityCoord: BolCoord;
        if (_commodityHasBoxSize) {
          _commodityCoord = { ...COORDS.commodity };
        } else {
          const _tier = pickCommodityTier(String(_commodityText), font);
          _commodityCoord = { ...COORDS.commodity, size: _tier.size, lineH: _tier.lineH };
        }
        drawMultiline(_commodityText, off("commodity", _commodityCoord), "commodity");
      }
    }

    // ── Shipper signature (cursive, all copies) ──
    if (bol.shipper_name && cursive) {
      page.drawText(String(bol.shipper_name), {
        x: COORDS.shipperSignature.x,
        y: COORDS.shipperSignature.y,
        size: COORDS.shipperSignature.size || 22,
        font: cursive,
        color: black,
      });
    }

    // ── Ship date next to shipper signature (auto-populated; regular font) ──
    if (_displayDate) drawText(_displayDate, COORDS.shipperDate);

    // ── QR code (driver tracking link) ──
    if (opts.copyType !== "customer" && !opts.hideQr && bol.access_token) {
      const trackingUrl = `${opts.trackingBaseUrl || ""}/track/${bol.access_token}`;
      // Type 0 = auto-select smallest version that fits; 'M' = medium error correction.
      const qr = qrcode(0, "M");
      qr.addData(trackingUrl);
      qr.make();
      const modules = qr.getModuleCount();
      const cellSize = (COORDS.qrCode.size as number) / modules;
      for (let r = 0; r < modules; r++) {
        for (let c = 0; c < modules; c++) {
          if (qr.isDark(r, c)) {
            page.drawRectangle({
              x: COORDS.qrCode.x + c * cellSize,
              y: COORDS.qrCode.y + (modules - 1 - r) * cellSize, // flip Y (pdf-lib origin is bottom-left)
              width: cellSize,
              height: cellSize,
              color: black,
            });
          }
        }
      }
    }

    // ── Copy page into combined PDF ──
    const [copiedPage] = await combinedPdf.copyPages(templateDoc, [0]);
    combinedPdf.addPage(copiedPage as PDFPage);
  }

  // Append packing slip PDF if provided
  if (opts.packingSlipPdfBytes) {
    try {
      const packingDoc = await PDFDocument.load(opts.packingSlipPdfBytes);
      const packingPages = await combinedPdf.copyPages(packingDoc, packingDoc.getPageIndices());
      packingPages.forEach((p) => combinedPdf.addPage(p));
    } catch (e) {
      console.error("Failed to append packing slip:", e);
    }
  }

  // Append loading diagram PDF if provided (lb-ui-09) — same merge shape as packingSlipPdfBytes above.
  if (opts.loadingDiagramPdfBytes) {
    try {
      const diagramDoc = await PDFDocument.load(opts.loadingDiagramPdfBytes);
      const diagramPages = await combinedPdf.copyPages(diagramDoc, diagramDoc.getPageIndices());
      diagramPages.forEach((p) => combinedPdf.addPage(p));
    } catch (e) {
      console.error("Failed to append loading diagram:", e);
    }
  }

  return await combinedPdf.save();
}
