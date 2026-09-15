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

export const PAGE = { width: 612, height: 792 }; // template is fixed US Letter

// Field map — single source of truth for what is editable and how it renders.
export type BolFieldType = "single" | "multiline" | "shipto" | "scrap";

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

export interface BolOverrides {
  _pos?: Record<string, BolPositionOverride | undefined>;
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

    const drawText = (
      text: unknown,
      coord: BolCoord,
      overrides: { x?: number; y?: number; size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; maxWidth?: number } = {}
    ) => {
      if (!text && text !== 0) return;
      const o: {
        x: number;
        y: number;
        size: number;
        font: PDFFont;
        color: ReturnType<typeof rgb>;
        maxWidth?: number;
      } = {
        x: overrides.x || coord.x,
        y: overrides.y || coord.y,
        size: overrides.size || coord.size || 10,
        font: coord.bold || overrides.bold ? fontBold : font,
        color: overrides.color || black,
      };
      if (overrides.maxWidth || coord.maxW) o.maxWidth = overrides.maxWidth || coord.maxW;
      page.drawText(String(text), o);
    };

    const drawMultiline = (text: unknown, coord: BolCoord) => {
      if (!text) return;
      const size = coord.size || 10;
      const lineH = coord.lineH || 12;
      const maxW = coord.maxW || 250;
      const wrappedLines = wrapText(String(text), font, size, maxW);
      wrappedLines.forEach((line, i) => {
        const lineOpts: { x: number; y: number; size: number; font: PDFFont; color: ReturnType<typeof rgb>; maxWidth?: number } = {
          x: coord.x,
          y: coord.y - i * lineH,
          size,
          font,
          color: black,
        };
        if (coord.center && line) {
          const lineWidth = font.widthOfTextAtSize(line, size);
          lineOpts.x = coord.x + (maxW - lineWidth) / 2;
        } else {
          lineOpts.maxWidth = maxW;
        }
        page.drawText(line, lineOpts);
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

    // ── Delivery time (bold red, top right; multiline-capable via override — P122) ──
    const _deliveryTimeVal =
      "deliveryTime" in _ov ? (Array.isArray(_ov.deliveryTime) ? _ov.deliveryTime.join("\n") : _ov.deliveryTime) : bol.delivery_time;
    if (_deliveryTimeVal) {
      const _dc = off("deliveryTime", COORDS.deliveryTime);
      const _dLines = wrapText(String(_deliveryTimeVal), fontBold, _dc.size as number, _dc.maxW || 200);
      _dLines.forEach((line, i) => {
        page.drawText(line, {
          x: _dc.x,
          y: _dc.y - i * (_dc.lineH || 28),
          size: _dc.size,
          font: fontBold,
          color: rgb(1, 0, 0),
        });
      });
    }

    // ── Standard fields ──
    const _rawDate = "date" in _ov ? _ov.date : bol.date;
    const _displayDate = "date" in _ov ? String(_rawDate) : formatBolDate(_rawDate);
    drawText(_displayDate, off("date", COORDS.date));
    drawText("bolNumber" in _ov ? _ov.bolNumber : String(bol.bol_number || ""), off("bolNumber", COORDS.bolNumber));
    drawText("carrierName" in _ov ? _ov.carrierName : bol.carrier_name, off("carrierName", COORDS.carrierName));
    drawText("trailerNo" in _ov ? _ov.trailerNo : bol.trailer_no, off("trailerNo", COORDS.trailerNo));

    // ── Ship-to address (up to 4 lines) ──
    const shipLines = Array.isArray(_ov.shipTo) ? _ov.shipTo : buildShipToLines(bol);
    const shipCoords = [COORDS.shipLine1, COORDS.shipLine2, COORDS.shipLine3, COORDS.shipLine4];
    shipLines.forEach((line, i) => {
      if (shipCoords[i]) drawText(line, off("shipTo", shipCoords[i]));
    });

    // ── Special Instructions ──
    drawMultiline(
      Array.isArray(_ov.specialInstr) ? _ov.specialInstr.join("\n") : bol.special_instructions,
      off("specialInstr", COORDS.specialInstr)
    );

    // ── Contact Info ──
    // Accept either contact_info (BOL generator) or contact_name/contact_phone (load builder).
    // Override arrives as literal lines — draw verbatim (no 'POC: ' prefix added).
    const _contactVal = Array.isArray(_ov.contactInfo)
      ? _ov.contactInfo.join("\n")
      : bol.contact_info ||
        [bol.contact_name ? "POC: " + bol.contact_name : "", bol.contact_phone || ""].filter(Boolean).join(" ");
    if (_contactVal) drawMultiline(_contactVal, off("contactInfo", COORDS.contactInfo));

    // ── PO / Invoice Number ──
    // Override arrives as literal lines — draw verbatim (no 'PO: ' prefix added).
    // Default path: bold "PO:" label, regular PO number offset by the label width.
    if (Array.isArray(_ov.poNumber)) {
      const _poVal = _ov.poNumber.join("\n");
      if (_poVal) drawMultiline(_poVal, off("poNumber", COORDS.poNumber));
    } else {
      const _poNum = bol.po_number || bol.poNumber || "";
      if (_poNum) {
        const _pc = off("poNumber", COORDS.poNumber);
        const _poSize = _pc.size || 12;
        const _poLabel = "PO:";
        page.drawText(_poLabel, { x: _pc.x, y: _pc.y, size: _poSize, font: fontBold, color: black });
        const _poLabelW = fontBold.widthOfTextAtSize(_poLabel + " ", _poSize);
        page.drawText(String(_poNum), { x: _pc.x + _poLabelW, y: _pc.y, size: _poSize, font, color: black });
      }
    }

    // ── Scrap Pick Up ──
    const _isScrap =
      typeof _ov.scrap === "boolean" ? _ov.scrap : bol.is_scrap_pickup === 1 || bol.is_scrap_pickup === true || bol.is_scrap_pickup === "1";
    drawText("X", off("scrap", _isScrap ? COORDS.scrapYes : COORDS.scrapNo));

    // ── Commodity description (centered, auto-sized by wrapped line count) ──
    let _commodityText = Array.isArray(_ov.commodity) ? _ov.commodity.join("\n") : bol.commodity_description;
    if (_commodityText && bol.siplast) {
      // Siplast products: prefix the SKU inside parens, e.g. (HB-10) -> (Siplast HB-10)
      _commodityText = String(_commodityText).replace(/\(([^)]+)\)/g, "(Siplast $1)");
    }
    if (_commodityText) {
      const _tier = pickCommodityTier(String(_commodityText), font);
      drawMultiline(_commodityText, off("commodity", { ...COORDS.commodity, size: _tier.size, lineH: _tier.lineH }));
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
