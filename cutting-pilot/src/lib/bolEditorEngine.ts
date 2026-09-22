// src/lib/bolEditorEngine.ts
// Canvas + positioned-overlay BOL field editor — ported from logistics/bol-editor.js
// (BolEditor.open) for the logistics v2 BolEditorModal. This stays deliberately imperative DOM,
// same as legacy: dragging absolutely-positioned inputs over a pdf.js canvas render is not a
// case React state meaningfully improves on, and legacy's own implementation already isolated
// it as a self-contained module. BolEditorModal.tsx (React) owns the surrounding Modal chrome,
// the multi-load picker, and the fenced save call; this module owns only the canvas/overlay/
// drag surface, mounted into a container the React component refs.
//
// Differences from bol-editor.js (structural only, no field/coordinate/behavior change):
//   - pdf.js loaded via the npm `pdfjs-dist` package (pinned 4.4.168, matching the legacy CDN
//     version exactly) instead of a CDN dynamic import — same pattern as src/lib/packingSlip.ts,
//     including the `/v2/pdf.worker.min.mjs` workerSrc (copy-pdf-worker.mjs already places that
//     file for packingSlip.ts's use; no new build step needed).
//   - Coordinates/field list come from bolShared.ts's FIELD_MAP/PAGE/COORDS (the already-ported
//     source of truth) instead of window.BolShared.
//   - `open()` returns a cleanup function instead of relying on the caller to call a separate
//     teardown; BolEditorModal calls it on unmount/target change.
import {
  FIELD_MAP,
  PAGE,
  buildShipToLines,
  resolveFieldLineStyle,
  measureStyledField,
  layoutBol,
  getLayoutFonts,
  generatePdf,
  isLikelyFontBytes,
  SCRIPT_FONT_ASSET_PATH,
  pickCommodityTier,
  type BolFieldMapEntry,
  type BolOverrides,
  type BolRecord,
  type BolCoord,
  type BolFieldStyle,
  type BolTextStyle,
  type BolLayoutFonts,
  type BolLayoutRun,
  type BolLayoutFieldBox,
} from "./bolShared";

// ═══════════════════════════════════════════════════════════════════
// TEXT STYLING (bol-style-03, matching bol-style-02's logistics/bol-editor.js exactly) — pure
// logic lives here (not in BolEditorModal.tsx/TextStyleToolbar.tsx) so it's directly testable;
// see bolShared.selfcheck.ts for coverage (no dedicated bolEditorEngine selfcheck exists yet).
// ═══════════════════════════════════════════════════════════════════

// Line-index integrity (bol-style-02 §5, ported): when lines are inserted/deleted in a field,
// shift that field's `lines` map keys so overrides stay on the same TEXT line; drop entries whose
// line was removed. Assumes a single contiguous insert/delete region (true for normal typing).
// Pure — returns a new (or the same, if unaffected) BolFieldStyle rather than mutating in place.
export function shiftLineKeys(
  fieldStyle: BolFieldStyle | undefined,
  oldLines: string[],
  newLines: string[]
): BolFieldStyle | undefined {
  if (!fieldStyle || !fieldStyle.lines || Object.keys(fieldStyle.lines).length === 0) return fieldStyle;
  const oldLen = oldLines.length;
  const newLen = newLines.length;
  if (oldLen === newLen) return fieldStyle;
  let start = 0;
  while (start < Math.min(oldLen, newLen) && oldLines[start] === newLines[start]) start++;
  let oldEnd = oldLen - 1;
  let newEnd = newLen - 1;
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }
  const delta = newLen - oldLen;
  const shifted: Record<string, BolTextStyle> = {};
  for (const key in fieldStyle.lines) {
    const idx = parseInt(key, 10);
    if (idx < start) shifted[key] = fieldStyle.lines[key];
    else if (idx > oldEnd) shifted[String(idx + delta)] = fieldStyle.lines[key];
    // idx within [start, oldEnd] -> its line was replaced/removed; drop the override
  }
  return { ...fieldStyle, lines: shifted };
}

// Save-time prune (bol-style-02 §6, ported): drops every empty `{}`/`lines` container so
// `overrides._style` is written only when something real survives. Pure.
export function pruneStyleOverrides(styleOverrides: Record<string, BolFieldStyle | undefined>): Record<string, BolFieldStyle> {
  const out: Record<string, BolFieldStyle> = {};
  for (const fk in styleOverrides) {
    const fs = styleOverrides[fk];
    if (!fs) continue;
    const o: BolFieldStyle = {};
    if (fs.size != null) o.size = fs.size;
    if (fs.bold != null) o.bold = fs.bold;
    if (fs.italic != null) o.italic = fs.italic;
    if (fs.underline != null) o.underline = fs.underline;
    if (fs.lines) {
      const linesOut: Record<string, BolTextStyle> = {};
      for (const li in fs.lines) {
        const l = fs.lines[li];
        if (!l) continue;
        const lo: BolTextStyle = {};
        if (l.size != null) lo.size = l.size;
        if (l.bold != null) lo.bold = l.bold;
        if (l.italic != null) lo.italic = l.italic;
        if (l.underline != null) lo.underline = l.underline;
        if (Object.keys(lo).length) linesOut[li] = lo;
      }
      if (Object.keys(linesOut).length) o.lines = linesOut;
    }
    if (Object.keys(o).length) out[fk] = o;
  }
  return out;
}

export interface ActiveFieldInfo {
  fieldKey: string;
  /** Whether this field supports a per-line ("This line") style scope — multiline/shipto only. */
  supportsLines: boolean;
  /** Field's current on-canvas position, in px relative to the editor's canvas wrapper. */
  left: number;
  top: number;
  /** bol-style-03 follow-up: bottom edge to anchor below when there's no headroom above (past the
   *  per-line preview strip when it's visible, so the toolbar never lands on top of it either). */
  fieldBottom: number;
  /** Canvas wrapper's current rendered size — the toolbar's caller clamps to this so it never
   *  renders partly off the visible editor surface. */
  wrapWidth: number;
  wrapHeight: number;
  scope: "box" | "line";
  /** The effective raw style AT the current scope (box, or the caret's current source line). */
  value: BolTextStyle;
  baseSize: number;
}

let _pdfjs: typeof import("pdfjs-dist") | null = null;
async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  const mod = await import("pdfjs-dist");
  mod.GlobalWorkerOptions.workerSrc = "/v2/pdf.worker.min.mjs";
  _pdfjs = mod;
  return _pdfjs;
}

// bol-wysiwyg-03: canvas overlay glyph rendering (mirrors legacy bol-editor.js's fontCss exactly).
function fontCss(fontKey: string, sizePx: number): string {
  const bold = fontKey === "bold" || fontKey === "boldItalic";
  const italic = fontKey === "italic" || fontKey === "boldItalic";
  return (italic ? "italic " : "") + (bold ? "700 " : "400 ") + sizePx + "px Helvetica, Arial, sans-serif";
}

function deriveValue(bol: BolRecord, field: BolFieldMapEntry): string | boolean {
  const k = field.overrideKey;
  const ov: BolOverrides = (bol._overrides as BolOverrides) || {};

  if (field.type === "single") {
    const colMap: Record<string, keyof BolRecord> = {
      date: "date",
      bolNumber: "bol_number",
      carrierName: "carrier_name",
      trailerNo: "trailer_no",
    };
    return k in ov ? String((ov as any)[k]) : String((bol[colMap[k]] as any) || "");
  }

  if (field.type === "shipto") {
    return k in ov ? (ov.shipTo || []).join("\n") : buildShipToLines(bol).join("\n");
  }

  if (field.type === "multiline") {
    if (k in ov) {
      const v = (ov as any)[k];
      return Array.isArray(v) ? v.join("\n") : String(v);
    }
    if (k === "deliveryTime") return bol.delivery_time || "";
    if (k === "specialInstr") return bol.special_instructions || "";
    if (k === "contactInfo")
      return (
        bol.contact_info ||
        [bol.contact_name ? "POC: " + bol.contact_name : "", bol.contact_phone || ""].filter(Boolean).join(" ")
      );
    if (k === "poNumber") {
      const v = bol.po_number || bol.poNumber || "";
      return v ? "PO: " + v : "";
    }
    if (k === "commodity") return bol.commodity_description || "";
  }

  if (field.type === "scrap") {
    if (typeof (ov as any).scrap === "boolean") return (ov as any).scrap;
    return bol.is_scrap_pickup === 1 || bol.is_scrap_pickup === true || bol.is_scrap_pickup === "1";
  }

  return "";
}

// Identical to deriveValue, but never consults bol._overrides — used to diff the on-screen
// value against the pristine base value (not whatever override was already applied when the
// editor was mounted), so an untouched field with an existing saved override isn't misread as
// "unchanged from base" and dropped from the rebuilt overrides object on Apply.
function deriveBaseValue(bol: BolRecord, field: BolFieldMapEntry): string | boolean {
  const k = field.overrideKey;

  if (field.type === "single") {
    const colMap: Record<string, keyof BolRecord> = {
      date: "date",
      bolNumber: "bol_number",
      carrierName: "carrier_name",
      trailerNo: "trailer_no",
    };
    return String((bol[colMap[k]] as any) || "");
  }

  if (field.type === "shipto") {
    return buildShipToLines(bol).join("\n");
  }

  if (field.type === "multiline") {
    if (k === "deliveryTime") return bol.delivery_time || "";
    if (k === "specialInstr") return bol.special_instructions || "";
    if (k === "contactInfo")
      return (
        bol.contact_info ||
        [bol.contact_name ? "POC: " + bol.contact_name : "", bol.contact_phone || ""].filter(Boolean).join(" ")
      );
    if (k === "poNumber") {
      const v = bol.po_number || bol.poNumber || "";
      return v ? "PO: " + v : "";
    }
    if (k === "commodity") return bol.commodity_description || "";
  }

  if (field.type === "scrap") {
    return bol.is_scrap_pickup === 1 || bol.is_scrap_pickup === true || bol.is_scrap_pickup === "1";
  }

  return "";
}

function buildScrapToggle(initVal: boolean): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:absolute;display:flex;flex-direction:column;gap:2px;";
  wrap.dataset.scrapValue = String(initVal);

  function setState(val: boolean) {
    wrap.dataset.scrapValue = String(val);
    wrap.querySelectorAll("button").forEach((b) => {
      const active = (b.dataset.scrapOption === "yes") === val;
      (b as HTMLElement).style.background = active ? "var(--brand,#1e293b)" : "var(--card-bg,#fff)";
      (b as HTMLElement).style.color = active ? "#fff" : "var(--text,#111827)";
    });
  }

  for (const [label, val] of [
    ["Yes", true],
    ["No", false],
  ] as const) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.dataset.scrapOption = val ? "yes" : "no";
    btn.style.cssText =
      "padding:2px 8px;border-radius:4px;cursor:pointer;font-weight:600;border:1px solid var(--border,#d1d5db);";
    btn.style.background = val === initVal ? "var(--brand,#1e293b)" : "var(--card-bg,#fff)";
    btn.style.color = val === initVal ? "#fff" : "var(--text,#111827)";
    btn.addEventListener("click", () => setState(val));
    wrap.appendChild(btn);
  }
  return wrap;
}

export interface BolEditorHandle {
  cleanup: () => void;
  /** Re-enables the Apply button after a failed save (`success=false`) without discarding the
   * user's edits, or tears the editor down after a successful one (`success=true`). The engine
   * intentionally does NOT clean up on its own click handler — a fenced/failed save must never
   * silently wipe what the operator just typed. */
  finishApply: (success: boolean) => void;
  /** bol-style-03: switches the active field's style scope — the React `TextStyleToolbar`'s
   * Box|Line switch calls this; the engine re-fires `onActiveFieldChange` with the new value. */
  setScope: (scope: "box" | "line") => void;
  /** bol-style-03: applies a style patch to the currently active field at its current scope
   * (box, or the caret's current source line for a multiline-capable field). `undefined` in a
   * patch value clears that property back to the next precedence level ("Auto"). */
  setFieldStyleValue: (fieldKey: string, patch: Partial<BolTextStyle>) => void;
  /** bol-style-03: clears a field's entire style override ("Reset field"). */
  resetFieldStyle: (fieldKey: string) => void;
  /** bol-style-03: the DOM node `ActiveFieldInfo.left/top` are relative to — the caller portals
   * `TextStyleToolbar` into this node (via `createPortal`) so its absolute positioning lines up
   * with the engine's own canvas-overlay coordinate space instead of BolEditorModal's own tree. */
  getStyleMountNode: () => HTMLElement | null;
}

export interface BolEditorCallbacks {
  /** Called with the pending change once the operator clicks Apply. The caller owns persistence
   * (the fenced PUT) and must call `handle.finishApply(success)` when it knows the outcome. */
  onApply: (updatedBol: BolRecord) => void;
  onCancel: () => void;
  /** bol-style-03: fires whenever the active styleable field, its scope, or its effective style
   * value changes (focus/blur/caret move/style edit/resize) — drives the React `TextStyleToolbar`,
   * which the engine itself has no knowledge of. `null` when no field is focused. */
  onActiveFieldChange?: (info: ActiveFieldInfo | null) => void;
}

// Mounts the canvas+overlay editor into `mountEl`. Returns a handle with `cleanup()` — call it
// on unmount or before mounting a different BOL (e.g. switching the multi-load picker).
export async function mountBolEditor(
  mountEl: HTMLElement,
  bolIn: BolRecord,
  { onApply, onCancel, onActiveFieldChange }: BolEditorCallbacks
): Promise<BolEditorHandle> {
  const bol: BolRecord = { ...bolIn };
  if (!bol._overrides && bol.render_overrides) {
    try {
      bol._overrides = typeof bol.render_overrides === "string" ? JSON.parse(bol.render_overrides) : (bol.render_overrides as BolOverrides);
    } catch {
      // leave unset — editor falls back to base fields
    }
  }

  mountEl.innerHTML = "";
  mountEl.style.cssText = "display:flex;flex-direction:column;height:100%;overflow:hidden;";

  const loadingEl = document.createElement("div");
  loadingEl.style.cssText =
    "flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted,#4b5563);font-size:14px;";
  loadingEl.textContent = "Loading editor…";
  mountEl.appendChild(loadingEl);

  let pdfPage: any;
  let fonts: BolLayoutFonts;
  try {
    const pdfjs = await loadPdfJs();
    const resp = await fetch("/logistics/assets/BLANK_BOL_Xpanda.pdf");
    if (!resp.ok) throw new Error("BOL template not found");
    const bytes = await resp.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    pdfPage = await doc.getPage(1);
    // bol-wysiwyg-01/03: real embedded Helvetica metrics — the SAME metrics generatePdf uses — so
    // layoutBol's placement here matches the PDF exactly, not an approximation.
    fonts = await getLayoutFonts();
  } catch (e: any) {
    loadingEl.textContent = "Editor failed to load: " + (e?.message || String(e));
    return {
      cleanup: () => {},
      finishApply: () => {},
      setScope: () => {},
      setFieldStyleValue: () => {},
      resetFieldStyle: () => {},
      getStyleMountNode: () => null,
    };
  }
  loadingEl.remove();

  const scrollArea = document.createElement("div");
  scrollArea.style.cssText =
    "flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:12px;background:var(--bg,#f0f2f5);";
  mountEl.appendChild(scrollArea);

  const canvasWrap = document.createElement("div");
  canvasWrap.style.cssText = "position:relative;display:inline-block;box-shadow:0 2px 8px rgba(0,0,0,0.15);";
  scrollArea.appendChild(canvasWrap);

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;top:0;left:0;";
  canvasWrap.appendChild(canvas);

  // bol-wysiwyg-03: transparent overlay canvas — the actual WYSIWYG text layer, drawn from
  // layoutBol runs (or the real generatePdf output when "Exact preview" is on). Sits above the
  // template render, below the (now-invisible) edit inputs/handles/toolbar.
  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;";
  canvasWrap.appendChild(overlayCanvas);

  const actionBar = document.createElement("div");
  actionBar.style.cssText =
    "flex-shrink:0;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border,#d1d5db);background:var(--card-bg,#fff);";

  const exactPreviewLabel = document.createElement("label");
  exactPreviewLabel.style.cssText =
    "display:flex;align-items:center;gap:6px;margin-right:auto;font-size:13px;font-weight:600;color:var(--text,#111827);cursor:pointer;user-select:none;";
  const exactPreviewCheckbox = document.createElement("input");
  exactPreviewCheckbox.type = "checkbox";
  exactPreviewCheckbox.style.cssText = "width:18px;height:18px;cursor:pointer;";
  // Disabled until the first reflow() sizes the canvases/sets scale — clicking before that would
  // render the exact preview into a still-default-sized canvas (bol-wysiwyg-02's caught race). See
  // reflow() below.
  exactPreviewCheckbox.disabled = true;
  exactPreviewLabel.appendChild(exactPreviewCheckbox);
  exactPreviewLabel.appendChild(document.createTextNode("Exact preview"));
  exactPreviewLabel.title = "Renders the actual PDF output (ground truth) instead of the fast approximation";
  actionBar.appendChild(exactPreviewLabel);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText =
    "padding:8px 20px;border-radius:8px;border:1px solid var(--border,#d1d5db);background:var(--card-bg,#fff);cursor:pointer;font-size:14px;font-weight:600;color:var(--text,#111827);";

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.textContent = "Apply Changes";
  applyBtn.style.cssText =
    "padding:8px 20px;border-radius:8px;border:none;background:var(--brand,#1e293b);color:#fff;cursor:pointer;font-size:14px;font-weight:600;";

  actionBar.appendChild(cancelBtn);
  actionBar.appendChild(applyBtn);
  mountEl.appendChild(actionBar);

  const inputEls: Record<string, HTMLInputElement | HTMLTextAreaElement | HTMLDivElement> = {};
  const handleEls: Record<string, HTMLDivElement> = {};
  const initialValues: Record<string, string | boolean> = {};

  const savedPos = (bol._overrides && (bol._overrides as BolOverrides)._pos) || {};
  const posOverrides: Record<string, { dx: number; dy: number }> = {};
  for (const k in savedPos) {
    const p = savedPos[k];
    if (p) posOverrides[k] = { dx: p.dx || 0, dy: p.dy || 0 };
  }

  // bol-style-03: working copy seeded from bol._overrides._style, mirroring savedPos above.
  const savedStyle = (bol._overrides && (bol._overrides as BolOverrides)._style) || {};
  const styleOverrides: Record<string, BolFieldStyle | undefined> = {};
  for (const fk in savedStyle) {
    if (savedStyle[fk]) styleOverrides[fk] = JSON.parse(JSON.stringify(savedStyle[fk]));
  }
  const prevLines: Record<string, string[]> = {};
  let activeFieldKey: string | null = null;
  let activeScope: "box" | "line" = "box";
  let lastBoxes: Record<string, BolLayoutFieldBox> = {}; // fieldKey -> box, from the most recent layoutBol call
  let lastRuns: BolLayoutRun[] = []; // runs from the most recent layoutBol call, for exact-preview's failure fallback

  function fieldSupportsLines(fieldKey: string): boolean {
    const field = FIELD_MAP.find((f) => f.overrideKey === fieldKey);
    return !!field && (field.type === "multiline" || field.type === "shipto");
  }
  function currentTextValue(fieldKey: string): string {
    const el = inputEls[fieldKey];
    return el ? String((el as HTMLTextAreaElement).value ?? "") : "";
  }
  // Base/"Auto" size used only by the style toolbar's stepper and "Auto(N)" label — reflects the
  // REAL tier/coord default (dynamically recomputed for commodity, unlike the old static
  // COORDS-only approximation this replaces).
  function baseCoordForField(fieldKey: string): BolCoord {
    const field = FIELD_MAP.find((f) => f.overrideKey === fieldKey);
    if (!field) return { x: 0, y: 0, size: 10, lineH: 12 };
    if (field.type === "shipto") return (field.coords as BolCoord[])[0];
    if (fieldKey === "commodity") {
      const tier = pickCommodityTier(currentTextValue("commodity"), fonts.regular);
      return { x: 0, y: 0, size: tier.size, lineH: tier.lineH };
    }
    return field.coord as BolCoord;
  }
  function caretLineIndex(el: HTMLInputElement | HTMLTextAreaElement | HTMLDivElement | undefined): number {
    const ta = el as HTMLTextAreaElement;
    if (!ta || typeof ta.selectionStart !== "number") return 0;
    return ta.value.slice(0, ta.selectionStart).split("\n").length - 1;
  }
  function currentEffectiveValue(fieldKey: string, scope: "box" | "line"): BolTextStyle {
    const fs = styleOverrides[fieldKey];
    if (!fs) return {};
    if (scope === "line" && fieldSupportsLines(fieldKey)) {
      const li = caretLineIndex(inputEls[fieldKey]);
      return (fs.lines && fs.lines[String(li)]) || {};
    }
    return { size: fs.size, bold: fs.bold, italic: fs.italic, underline: fs.underline };
  }
  function notifyActiveField() {
    if (!onActiveFieldChange) return;
    if (!activeFieldKey) {
      onActiveFieldChange(null);
      return;
    }
    const el = inputEls[activeFieldKey];
    if (!el) {
      onActiveFieldChange(null);
      return;
    }
    const baseCoord = baseCoordForField(activeFieldKey);
    const top = parseFloat(el.style.top) || 0;
    const fieldH = parseFloat(el.style.height) || 0;
    // bol-wysiwyg-03: no more per-line preview strip below the field (removed — the WYSIWYG canvas
    // layer now shows per-line styles in place), so fieldBottom is simply the field's own bottom edge.
    onActiveFieldChange({
      fieldKey: activeFieldKey,
      supportsLines: fieldSupportsLines(activeFieldKey),
      left: parseFloat(el.style.left) || 0,
      top,
      fieldBottom: top + fieldH,
      wrapWidth: canvasWrap.clientWidth,
      wrapHeight: canvasWrap.clientHeight,
      scope: activeScope,
      value: currentEffectiveValue(activeFieldKey, activeScope),
      baseSize: baseCoord.size || 10,
    });
  }

  // bol-wysiwyg-03: overflow warning is now the amber outline only — the separate per-line preview
  // strip below multiline fields is REMOVED; the WYSIWYG canvas overlay shows per-line styles in
  // place instead. Driven by measureStyledField, itself a layoutField-backed real-metric check.
  function updateFieldOverflow(fieldKey: string) {
    const el = inputEls[fieldKey];
    if (!el || !fieldSupportsLines(fieldKey)) return;
    const text = currentTextValue(fieldKey);
    const measured = measureStyledField(fieldKey, text, styleOverrides[fieldKey]);
    if (measured.overflow) {
      (el as HTMLElement).style.boxShadow = "0 0 0 2px #f59e0b";
      (el as HTMLElement).title =
        fieldKey === "shipTo" ? "Only the first 4 non-blank lines will be saved" : "May overflow the box";
    } else {
      (el as HTMLElement).style.boxShadow = "none";
      (el as HTMLElement).title = "";
    }
  }

  function applyStylePatch(fieldKey: string, patch: Partial<BolTextStyle>) {
    if (!styleOverrides[fieldKey]) styleOverrides[fieldKey] = {};
    const fs = styleOverrides[fieldKey]!;
    let target: BolTextStyle = fs;
    if (activeScope === "line" && fieldSupportsLines(fieldKey)) {
      const li = caretLineIndex(inputEls[fieldKey]);
      if (!fs.lines) fs.lines = {};
      if (!fs.lines[String(li)]) fs.lines[String(li)] = {};
      target = fs.lines[String(li)];
    }
    for (const k in patch) {
      const v = (patch as Record<string, unknown>)[k];
      if (v === undefined) delete (target as Record<string, unknown>)[k];
      else (target as Record<string, unknown>)[k] = v;
    }
    if (activeScope === "line" && fs.lines) {
      const li = caretLineIndex(inputEls[fieldKey]);
      if (fs.lines[String(li)] && Object.keys(fs.lines[String(li)]).length === 0) delete fs.lines[String(li)];
      if (Object.keys(fs.lines).length === 0) delete fs.lines;
    }
    if (Object.keys(fs).length === 0) delete styleOverrides[fieldKey];
    notifyActiveField();
    scheduleRelayout();
  }

  // Transparent, borderless edit surface (bol-wysiwyg-03): the canvas overlay is the visual source
  // of truth; inputs/textareas exist only to host the caret/selection/typing, positioned and sized
  // entirely from layoutBol's boxes (no COORDS geometry, no padding/border offset).
  const EDIT_SURFACE_CSS =
    "position:absolute;box-sizing:border-box;background:transparent;" +
    "border:none;outline:1px dashed rgba(30,41,59,0.35);padding:0;margin:0;" +
    "font-family:Helvetica,Arial,sans-serif;color:transparent;caret-color:var(--text,#111827);resize:none;overflow:hidden;";

  for (const field of FIELD_MAP) {
    if (field.type === "zonecolumns") continue; // no zone-column editing UI in v2 (BACKLOG.md)
    const k = field.overrideKey;
    const initVal = deriveValue(bol, field);
    initialValues[k] = initVal;

    let el: HTMLInputElement | HTMLTextAreaElement | HTMLDivElement;
    if (field.type === "scrap") {
      el = buildScrapToggle(initVal as boolean);
    } else if (field.type === "single") {
      const input = document.createElement("input");
      input.type = "text";
      input.value = String(initVal);
      input.style.cssText = EDIT_SURFACE_CSS;
      el = input;
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = String(initVal);
      textarea.style.cssText = EDIT_SURFACE_CSS;
      if (k === "commodity") textarea.style.textAlign = "center";
      el = textarea;
    }

    inputEls[k] = el;
    canvasWrap.appendChild(el);

    // bol-style-03: 'scrap' is NOT styleable (spec) — every other field gets live style visuals,
    // toolbar activation, and line-index-integrity tracking on its input/textarea.
    if (field.type !== "scrap") {
      prevLines[k] = String(initVal).split("\n");
      el.addEventListener("focus", () => {
        activeFieldKey = k;
        notifyActiveField();
      });
      el.addEventListener("blur", () => {
        setTimeout(() => {
          if (activeFieldKey === k && document.activeElement !== inputEls[k]) {
            activeFieldKey = null;
            notifyActiveField();
          }
        }, 0);
      });
      el.addEventListener("click", () => {
        if (activeFieldKey === k) notifyActiveField();
      });
      el.addEventListener("keyup", () => {
        if (activeFieldKey === k) notifyActiveField();
      });
      el.addEventListener("input", () => {
        const newLines = (el as HTMLTextAreaElement).value.split("\n");
        styleOverrides[k] = shiftLineKeys(styleOverrides[k], prevLines[k], newLines);
        prevLines[k] = newLines;
        if (activeFieldKey === k) notifyActiveField();
        scheduleRelayout();
      });
    } else {
      el.addEventListener("click", () => scheduleRelayout());
    }

    const handle = document.createElement("div");
    handle.title = "Drag to move · double-click to reset";
    handle.style.cssText =
      "position:absolute;width:16px;height:16px;border-radius:4px;background:var(--brand,#1e293b);color:#fff;font-size:11px;line-height:16px;text-align:center;cursor:grab;z-index:5;box-shadow:0 1px 2px rgba(0,0,0,0.3);touch-action:none;user-select:none;";
    handle.textContent = "✥";
    attachDragHandle(handle, k);
    handleEls[k] = handle;
    canvasWrap.appendChild(handle);
  }

  let renderTask: any = null;
  let scale = 1;
  let relayoutTimer: ReturnType<typeof setTimeout> | null = null; // ~120ms throttle shared by edits/drag/style changes

  function attachDragHandle(handle: HTMLDivElement, k: string) {
    let startX = 0,
      startY = 0,
      baseDx = 0,
      baseDy = 0,
      dragging = false;

    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      handle.setPointerCapture(e.pointerId);
      handle.style.cursor = "grabbing";
      startX = e.clientX;
      startY = e.clientY;
      const cur = posOverrides[k] || { dx: 0, dy: 0 };
      baseDx = cur.dx;
      baseDy = cur.dy;
    });

    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const s = scale || 1;
      const dx = baseDx + (e.clientX - startX) / s;
      const dy = baseDy - (e.clientY - startY) / s;
      // bol-wysiwyg-03: 0.5pt drag snap (was whole-point).
      posOverrides[k] = { dx: Math.round(dx * 2) / 2, dy: Math.round(dy * 2) / 2 };
      scheduleRelayout();
    });

    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        // already released
      }
      handle.style.cursor = "grab";
      if (posOverrides[k] && posOverrides[k].dx === 0 && posOverrides[k].dy === 0) delete posOverrides[k];
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);

    handle.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      delete posOverrides[k];
      scheduleRelayout();
    });
  }

  function reflow() {
    if (renderTask) {
      try {
        renderTask.cancel();
      } catch {
        // already finished
      }
      renderTask = null;
    }

    const logicalW = Math.max(200, scrollArea.clientWidth - 24);
    const logicalH = Math.round((logicalW * PAGE.height) / PAGE.width);
    const s = logicalW / PAGE.width;
    scale = s;
    const dpr = window.devicePixelRatio || 1;

    [canvas, overlayCanvas].forEach((c) => {
      c.width = Math.round(logicalW * dpr);
      c.height = Math.round(logicalH * dpr);
      c.style.width = logicalW + "px";
      c.style.height = logicalH + "px";
    });
    canvasWrap.style.width = logicalW + "px";
    canvasWrap.style.height = logicalH + "px";

    const ctx = canvas.getContext("2d")!;
    const vp = pdfPage.getViewport({ scale: s * dpr });
    renderTask = pdfPage.render({ canvasContext: ctx, viewport: vp });
    renderTask.promise.then(() => (renderTask = null)).catch(() => {});

    relayoutNow();
    exactPreviewCheckbox.disabled = false;
  }

  // ── The WYSIWYG core (bol-wysiwyg-03): one function computes the live layout from the CURRENT
  // editing state (via computeOverrides()) and drives both the edit-surface boxes and the canvas
  // overlay text from the exact same layoutBol call generatePdf itself would make. ──

  function computeOverrides(): BolOverrides {
    const overrides: BolOverrides = {};

    for (const field of FIELD_MAP) {
      const k = field.overrideKey;
      const el = inputEls[k];
      if (!el) continue;

      if (field.type === "single") {
        const val = (el as HTMLInputElement).value;
        if (val !== deriveBaseValue(bol, field)) (overrides as any)[k] = val;
      } else if (field.type === "shipto") {
        const lines = (el as HTMLTextAreaElement).value
          .split("\n")
          .map((l) => l.trimEnd())
          .filter((l) => l.trim())
          .slice(0, 4);
        const base = String(deriveBaseValue(bol, field) || "")
          .split("\n")
          .map((l) => l.trimEnd())
          .filter((l) => l.trim())
          .slice(0, 4);
        if (lines.join("\n") !== base.join("\n")) overrides.shipTo = lines;
      } else if (field.type === "multiline") {
        const lines = (el as HTMLTextAreaElement).value.split("\n").map((l) => l.trimEnd());
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        const base = String(deriveBaseValue(bol, field) || "")
          .split("\n")
          .map((l) => l.trimEnd());
        while (base.length && !base[base.length - 1].trim()) base.pop();
        if (lines.join("\n") !== base.join("\n")) (overrides as any)[k] = lines;
      } else if (field.type === "scrap") {
        const val = (el as HTMLDivElement).dataset.scrapValue === "true";
        if (val !== deriveBaseValue(bol, field)) overrides.scrap = val;
      }
    }

    const posOut: Record<string, { dx: number; dy: number }> = {};
    for (const pk in posOverrides) {
      const pv = posOverrides[pk];
      if (pv && (pv.dx || pv.dy)) posOut[pk] = { dx: pv.dx, dy: pv.dy };
    }
    if (Object.keys(posOut).length > 0) overrides._pos = posOut;

    // bol-style-03: prune empty style objects and write overrides._style only if non-empty, next
    // to _pos. Its OWN pass (not gated by any field's text-unchanged check above) — a style
    // survives even when the field's text reverts to its base value (spec §7).
    const styleOut = pruneStyleOverrides(styleOverrides);
    if (Object.keys(styleOut).length > 0) overrides._style = styleOut;

    return overrides;
  }

  function relayoutNow() {
    const liveBol: BolRecord = { ...bol, _overrides: computeOverrides() };
    const { runs, boxes } = layoutBol(liveBol, fonts);
    lastBoxes = boxes;
    lastRuns = runs;
    positionAll(scale, boxes);
    if (exactPreviewOn) {
      scheduleExactPreview();
    } else {
      drawOverlay(runs, scale);
    }
  }

  function scheduleRelayout() {
    if (relayoutTimer) return; // already scheduled — fires at a steady ~120ms cadence during
    // continuous activity (typing, dragging) rather than only once activity stops.
    relayoutTimer = setTimeout(() => {
      relayoutTimer = null;
      relayoutNow();
    }, 120);
  }

  function drawOverlay(runs: BolLayoutRun[], s: number) {
    const octx = overlayCanvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    octx.scale(dpr, dpr);
    octx.textBaseline = "alphabetic";
    const H = PAGE.height;
    runs.forEach((run) => {
      if (!run.text) return;
      const x = run.x * s;
      const y = (H - run.y) * s;
      octx.font = fontCss(run.fontKey, run.size * s);
      octx.fillStyle = run.color === "red" ? "#ff0000" : "#000000";
      octx.fillText(run.text, x, y);
      if (run.underline) {
        const uy = y + Math.max(1, run.size * 0.12) * s;
        octx.strokeStyle = octx.fillStyle;
        octx.lineWidth = Math.max(0.5, run.size * 0.06) * s;
        octx.beginPath();
        octx.moveTo(x, uy);
        octx.lineTo(x + run.width * s, uy);
        octx.stroke();
      }
    });
  }

  // ── "Exact preview" (bol-wysiwyg-02 §5, ported identically): renders the ACTUAL generatePdf
  // output via pdf.js into the overlay canvas — the ground-truth check, throttled 400ms since it's
  // a real PDF render (fonts + template + font-file fetch) rather than a cheap canvas fillText
  // pass. templateBytes/scriptFontBytes are fetched lazily (only once Exact preview is first
  // toggled on) and cached — separate from the ArrayBuffer already consumed by pdf.js above, since
  // pdf.js may transfer/detach that buffer to its worker. ──
  let exactPreviewOn = false;
  let exactTimer: ReturnType<typeof setTimeout> | null = null;
  let exactRenderTask: { promise: Promise<unknown>; cancel: () => void } | null = null;
  let exactPreviewTemplateBytes: ArrayBuffer | null = null;
  let exactPreviewScriptFontBytes: ArrayBuffer | null | undefined;

  async function fetchExactPreviewTemplateBytes(): Promise<ArrayBuffer> {
    if (exactPreviewTemplateBytes) return exactPreviewTemplateBytes;
    const res = await fetch("/logistics/assets/BLANK_BOL_Xpanda.pdf");
    if (!res.ok) throw new Error("BOL template not found");
    exactPreviewTemplateBytes = await res.arrayBuffer();
    return exactPreviewTemplateBytes;
  }

  async function fetchExactPreviewScriptFontBytes(): Promise<ArrayBuffer | null> {
    if (exactPreviewScriptFontBytes !== undefined) return exactPreviewScriptFontBytes;
    try {
      const res = await fetch(SCRIPT_FONT_ASSET_PATH);
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (res.ok && !ct.includes("text/html")) {
        const buf = await res.arrayBuffer();
        exactPreviewScriptFontBytes = isLikelyFontBytes(buf) ? buf : null;
      } else {
        exactPreviewScriptFontBytes = null;
      }
    } catch {
      exactPreviewScriptFontBytes = null;
    }
    return exactPreviewScriptFontBytes;
  }

  function scheduleExactPreview() {
    if (exactTimer) return;
    exactTimer = setTimeout(async () => {
      exactTimer = null;
      if (!exactPreviewOn) return;
      try {
        const liveBol: BolRecord = { ...bol, _overrides: computeOverrides() };
        const templateBytes = await fetchExactPreviewTemplateBytes();
        const scriptFontBytes = await fetchExactPreviewScriptFontBytes();
        const trackingBaseUrl = typeof window !== "undefined" ? window.location.origin : "";
        const pdfBytes = await generatePdf([liveBol], { templateBytes, scriptFontBytes, trackingBaseUrl });
        const pdfjs = await loadPdfJs();
        const doc = await pdfjs.getDocument({ data: pdfBytes }).promise;
        const p = await doc.getPage(1);
        const dpr = window.devicePixelRatio || 1;
        const vp = p.getViewport({ scale: scale * dpr });
        const octx = overlayCanvas.getContext("2d")!;
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        if (exactRenderTask) {
          try {
            exactRenderTask.cancel();
          } catch {
            // already finished
          }
        }
        const task = p.render({ canvasContext: octx, viewport: vp });
        exactRenderTask = task;
        await task.promise;
        exactRenderTask = null;
      } catch (e) {
        // Best-effort ground-truth preview; never blocks editing on a render hiccup — but never
        // leave the operator staring at a blank form either, so fall back to the approximation.
        console.warn("[bolEditorEngine] exact preview render failed, falling back to approximation:", e);
        drawOverlay(lastRuns, scale);
      }
    }, 400);
  }

  exactPreviewCheckbox.addEventListener("change", () => {
    exactPreviewOn = exactPreviewCheckbox.checked;
    if (exactPreviewOn) {
      scheduleExactPreview();
    } else {
      if (exactRenderTask) {
        try {
          exactRenderTask.cancel();
        } catch {
          // already finished
        }
        exactRenderTask = null;
      }
      relayoutNow();
    }
  });

  function positionAll(s: number, boxes: Record<string, BolLayoutFieldBox>) {
    const H = PAGE.height;
    for (const field of FIELD_MAP) {
      if (field.type === "zonecolumns") continue;
      const k = field.overrideKey;
      const el = inputEls[k];
      const box = boxes[k];
      if (!el || !box) continue;

      el.style.left = Math.round(box.x * s) + "px";
      el.style.top = Math.round((H - box.y) * s) + "px";
      el.style.width = Math.round(box.w * s) + "px";
      el.style.height = Math.round(box.h * s) + "px";

      if (field.type === "scrap") {
        el.querySelectorAll("button").forEach((b) => {
          (b as HTMLElement).style.fontSize = Math.max(10, Math.round(box.h * s * 0.55)) + "px";
        });
      }

      const hx = parseFloat(el.style.left);
      const hy = parseFloat(el.style.top);
      const handle = handleEls[k];
      if (handle) {
        handle.style.left = Math.max(0, hx - 2) + "px";
        handle.style.top = Math.max(0, hy - 18) + "px";
      }

      if (field.type !== "scrap") updateFieldOverflow(k);
    }
    if (activeFieldKey) notifyActiveField();
  }

  applyBtn.addEventListener("click", () => {
    const overrides = computeOverrides();
    const updated: BolRecord = { ...bol };
    if (Object.keys(overrides).length > 0) {
      updated._overrides = overrides;
    } else {
      delete updated._overrides;
    }

    // Deliberately no cleanup() here — the caller (React) owns persistence and decides via
    // finishApply() whether this succeeded (tear down) or failed (leave the edits on screen).
    applyBtn.disabled = true;
    cancelBtn.disabled = true;
    applyBtn.textContent = "Saving…";
    onApply(updated);
  });

  cancelBtn.addEventListener("click", () => {
    cleanup();
    onCancel();
  });

  let ro: ResizeObserver | null = null;

  function cleanup() {
    if (renderTask) {
      try {
        renderTask.cancel();
      } catch {
        // already finished
      }
      renderTask = null;
    }
    if (exactTimer) {
      clearTimeout(exactTimer);
      exactTimer = null;
    }
    if (exactRenderTask) {
      try {
        exactRenderTask.cancel();
      } catch {
        // already finished
      }
      exactRenderTask = null;
    }
    if (relayoutTimer) {
      clearTimeout(relayoutTimer);
      relayoutTimer = null;
    }
    if (ro) {
      ro.disconnect();
      ro = null;
    }
    mountEl.innerHTML = "";
    mountEl.style.cssText = "";
  }

  ro = new ResizeObserver(reflow);
  ro.observe(scrollArea);

  requestAnimationFrame(reflow);

  function finishApply(success: boolean) {
    if (success) {
      cleanup();
      return;
    }
    applyBtn.disabled = false;
    cancelBtn.disabled = false;
    applyBtn.textContent = "Apply Changes";
  }

  function setScope(newScope: "box" | "line") {
    activeScope = newScope;
    notifyActiveField();
  }
  function setFieldStyleValue(fieldKey: string, patch: Partial<BolTextStyle>) {
    applyStylePatch(fieldKey, patch);
  }
  function resetFieldStyle(fieldKey: string) {
    delete styleOverrides[fieldKey];
    notifyActiveField();
    scheduleRelayout();
  }

  function getStyleMountNode(): HTMLElement | null {
    return canvasWrap;
  }

  return { cleanup, finishApply, setScope, setFieldStyleValue, resetFieldStyle, getStyleMountNode };
}
