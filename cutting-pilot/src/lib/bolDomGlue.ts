// src/lib/bolDomGlue.ts
// DOM/download glue for the BOL viewer/generate/editor React components (logistics v2, unit 2).
// bolShared.ts deliberately dropped this glue when it was ported from logistics/bol-shared.js
// (P435) because a pure render lib can't assume a browser environment — see that file's header.
// This file reimplements it for the browser: fetching the template/font assets by URL,
// merging the three copy-type passes (driver/customer/original) into one combined PDF (the
// same packet legacy's generateCombinedCopies/viewBolForJob produce), and the two small DOM
// helpers (openPdf, confirmNoBolNumber) ported near-verbatim from bol-shared.js.
import { PDFDocument } from "pdf-lib";
import type { FuelLine } from "@/lib/logistics/fuelSurcharge";
import {
  generatePdf,
  isLikelyFontBytes,
  TEMPLATE_ASSET_PATH_BY_COPY_TYPE,
  SCRIPT_FONT_ASSET_PATH,
  BODY_FONT_ASSET_PATHS,
  type BolBodyFontBytes,
  type BolRecord,
} from "./bolShared";

async function fetchTemplateBytes(copyType?: "driver" | "customer"): Promise<ArrayBuffer> {
  const path =
    copyType === "driver"
      ? TEMPLATE_ASSET_PATH_BY_COPY_TYPE.driver
      : copyType === "customer"
        ? TEMPLATE_ASSET_PATH_BY_COPY_TYPE.customer
        : TEMPLATE_ASSET_PATH_BY_COPY_TYPE.default;
  const res = await fetch(path);
  if (!res.ok) throw new Error(`BOL template not found at ${path}`);
  return res.arrayBuffer();
}

// Cached across calls in one page session — the font never changes mid-session. `null` means
// "fetched, but not a real font" (path-miss or non-font 200), not "not yet fetched".
let _scriptFontBytes: ArrayBuffer | null | undefined;

// Path is CASE-SENSITIVE on Cloudflare Pages — a wrong-case path still 200s with the app-shell
// HTML. Content-type AND magic-byte checks both required before trusting the bytes (mirrors
// bol-shared.js's inline sniff exactly; isLikelyFontBytes covers only the magic-byte half).
async function fetchScriptFontBytes(): Promise<ArrayBuffer | null> {
  if (_scriptFontBytes !== undefined) return _scriptFontBytes;
  try {
    const res = await fetch(SCRIPT_FONT_ASSET_PATH);
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (res.ok && !ct.includes("text/html")) {
      const buf = await res.arrayBuffer();
      _scriptFontBytes = isLikelyFontBytes(buf) ? buf : null;
    } else {
      _scriptFontBytes = null;
    }
  } catch {
    _scriptFontBytes = null;
  }
  return _scriptFontBytes;
}

// bol-print-01: the four Liberation Sans body faces, fetched once per page session with the same
// content-type + magic-byte sniff as the script font. Resolves null if any face is unavailable
// (generatePdf/getLayoutFonts then fall back to StandardFonts); a miss is not cached, so the next
// call retries. Shared by the combined packet and the editor (layout fonts + Exact preview).
let _bodyFontBytesPromise: Promise<BolBodyFontBytes | null> | null = null;

async function fetchFontBytes(path: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(path);
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok || ct.includes("text/html")) return null;
    const buf = await res.arrayBuffer();
    return isLikelyFontBytes(buf) ? buf : null;
  } catch {
    return null;
  }
}

export function fetchBodyFontBytes(): Promise<BolBodyFontBytes | null> {
  if (!_bodyFontBytesPromise) {
    _bodyFontBytesPromise = Promise.all([
      fetchFontBytes(BODY_FONT_ASSET_PATHS.regular),
      fetchFontBytes(BODY_FONT_ASSET_PATHS.bold),
      fetchFontBytes(BODY_FONT_ASSET_PATHS.italic),
      fetchFontBytes(BODY_FONT_ASSET_PATHS.boldItalic),
    ]).then(([regular, bold, italic, boldItalic]) => {
      if (!regular || !bold || !italic || !boldItalic) {
        _bodyFontBytesPromise = null;
        return null;
      }
      return { regular, bold, italic, boldItalic };
    });
  }
  return _bodyFontBytesPromise;
}

export interface CombinedBolPdfOptions {
  hideQr?: boolean;
  packingSlipPdfBytes?: ArrayBuffer;
}

// lgx-fuel-02 / quickwin-07: live per-mile fuel surcharge lines, one per bolRecords index.
// Fail-soft: any error -> [] -> no line drawn. Shared by the combined packet and the editor preview.
export async function fetchFuelLines(bolRecords: BolRecord[]): Promise<(FuelLine | null)[]> {
  let fuelLines: (FuelLine | null)[] = [];
  try {
    const quote = bolRecords.map((b) => ({
      date: String(b?.date ?? "").slice(0, 10),
      ship_to_street: b?.ship_to_street ?? "",
      ship_to_city: b?.ship_to_city ?? "",
      ship_to_state: b?.ship_to_state ?? "",
      ship_to_zip: b?.ship_to_zip ?? "",
    }));
    if (quote.length) {
      const res = await fetch(`/v2/api/bols/fuel-surcharge?quote=${encodeURIComponent(JSON.stringify(quote))}`, { credentials: "same-origin" });
      if (res.ok) {
        const body = await res.json();
        fuelLines = body && Array.isArray(body.lines) ? body.lines : [];
      }
    }
  } catch {
    fuelLines = [];
  }
  return fuelLines;
}

// Renders the same combined packet Generate/View produce in legacy: driver -> customer ->
// original passes (each a full bolShared.generatePdf call, one page per bolRecord), merged into
// a single PDF. trackingBaseUrl is always the real page origin — required for the QR's drawn
// geometry to match legacy's window.location.origin-derived output (see bolShared.ts header).
export async function buildCombinedBolPdf(
  bolRecords: BolRecord[],
  opts: CombinedBolPdfOptions = {}
): Promise<Uint8Array> {
  const scriptFontBytes = await fetchScriptFontBytes();
  const bodyFontBytes = await fetchBodyFontBytes();
  const trackingBaseUrl = typeof window !== "undefined" ? window.location.origin : "";
  // lgx-fuel-02: live per-mile fuel surcharge (never frozen onto the BOL) — one server-built line per
  // bolRecords index. Fetched once for all three copy passes. Fail-soft: any error -> [] -> no line.
  const fuelLines = await fetchFuelLines(bolRecords);
  const out = await PDFDocument.create();

  for (const copyType of ["driver", "customer", undefined] as const) {
    const templateBytes = await fetchTemplateBytes(copyType);
    const bytes = await generatePdf(bolRecords, {
      copyType,
      templateBytes,
      scriptFontBytes,
      bodyFontBytes,
      hideQr: opts.hideQr,
      trackingBaseUrl,
      fuelLines,
    });
    const src = await PDFDocument.load(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }

  if (opts.packingSlipPdfBytes) {
    try {
      const packingDoc = await PDFDocument.load(opts.packingSlipPdfBytes);
      const packingPages = await out.copyPages(packingDoc, packingDoc.getPageIndices());
      packingPages.forEach((p) => out.addPage(p));
    } catch (e) {
      console.error("Failed to append packing slip:", e);
    }
  }

  return out.save();
}

// bem-01: ONE copy pass (e.g. the driver copy the BOL Email Queue attaches), same body as one
// iteration of buildCombinedBolPdf's loop. fetchFuelLines is required here: v2's generatePdf only
// draws the fuel lines it is passed (legacy bol-shared.js fetched them inside generatePdf).
export async function buildSingleCopyPdf(
  bolRecords: BolRecord[],
  copyType: "driver" | "customer" | undefined
): Promise<Uint8Array> {
  const scriptFontBytes = await fetchScriptFontBytes();
  const bodyFontBytes = await fetchBodyFontBytes();
  const trackingBaseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const fuelLines = await fetchFuelLines(bolRecords);
  const templateBytes = await fetchTemplateBytes(copyType);
  return generatePdf(bolRecords, {
    copyType,
    templateBytes,
    scriptFontBytes,
    bodyFontBytes,
    trackingBaseUrl,
    fuelLines,
  });
}

// Ported from bol-shared.js's openPdf: open in a new tab (no auto-download), revoke after a
// delay long enough for the tab to finish loading the blob.
export function openPdf(blobUrl: string): void {
  const win = window.open(blobUrl, "_blank");
  if (!win) {
    alert("Your browser blocked the popup. Please allow popups for this site.");
    return;
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
}

// Ported near-verbatim (vanilla DOM, not a React component) from bol-shared.js's
// confirmNoBolNumber — a one-shot promise-resolving confirm toast invoked from the generate
// flow. Kept as plain DOM glue, consistent with the rest of this file, rather than a React
// dialog: it has no reusable call sites beyond this one confirm.
export function confirmNoBolNumber(): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:10000;display:flex;align-items:center;justify-content:center;";

    // Tokenized (var(--surface)/var(--text)/var(--border)/var(--brand)), not hardcoded hex, so
    // this respects light/dark theme like every other surface in the app.
    const card = document.createElement("div");
    card.style.cssText =
      "background:var(--surface);border-radius:12px;padding:24px;max-width:360px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.15);text-align:center;";
    card.innerHTML = `
      <div style="font-size:15px;font-weight:600;margin-bottom:16px;color:var(--text);">No BOL/INV # entered.<br>Continue without one?</div>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button id="bol-toast-cancel" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border);background:var(--surface);cursor:pointer;font-size:14px;font-weight:600;color:var(--text);">Cancel</button>
        <button id="bol-toast-continue" style="padding:10px 20px;border-radius:8px;border:none;background:var(--brand);color:#fff;cursor:pointer;font-size:14px;font-weight:600;">Continue</button>
      </div>
    `;
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    const cleanup = (result: boolean) => {
      backdrop.remove();
      resolve(result);
    };
    card.querySelector("#bol-toast-continue")?.addEventListener("click", () => cleanup(true));
    card.querySelector("#bol-toast-cancel")?.addEventListener("click", () => cleanup(false));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) cleanup(false);
    });
  });
}
