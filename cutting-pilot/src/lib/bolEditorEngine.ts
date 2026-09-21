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
  type BolFieldMapEntry,
  type BolOverrides,
  type BolRecord,
  type BolCoord,
  type BolFieldStyle,
  type BolTextStyle,
} from "./bolShared";

const BASELINE_FUDGE = 0;

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
  try {
    const pdfjs = await loadPdfJs();
    const resp = await fetch("/logistics/assets/BLANK_BOL_Xpanda.pdf");
    if (!resp.ok) throw new Error("BOL template not found");
    const bytes = await resp.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    pdfPage = await doc.getPage(1);
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
  canvasWrap.appendChild(canvas);

  const actionBar = document.createElement("div");
  actionBar.style.cssText =
    "flex-shrink:0;display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border,#d1d5db);background:var(--card-bg,#fff);";

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
  const previewEls: Record<string, HTMLDivElement> = {};
  let activeFieldKey: string | null = null;
  let activeScope: "box" | "line" = "box";

  function fieldSupportsLines(fieldKey: string): boolean {
    const field = FIELD_MAP.find((f) => f.overrideKey === fieldKey);
    return !!field && (field.type === "multiline" || field.type === "shipto");
  }
  function baseCoordForField(fieldKey: string): BolCoord {
    const field = FIELD_MAP.find((f) => f.overrideKey === fieldKey);
    if (!field) return { x: 0, y: 0, size: 10, lineH: 12 };
    if (field.type === "shipto") return (field.coords as BolCoord[])[0];
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
    onActiveFieldChange({
      fieldKey: activeFieldKey,
      supportsLines: fieldSupportsLines(activeFieldKey),
      left: parseFloat(el.style.left) || 0,
      top: parseFloat(el.style.top) || 0,
      scope: activeScope,
      value: currentEffectiveValue(activeFieldKey, activeScope),
      baseSize: baseCoord.size || 10,
    });
  }

  function ensurePreviewEl(fieldKey: string): HTMLDivElement {
    if (previewEls[fieldKey]) return previewEls[fieldKey];
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;display:none;pointer-events:none;font-family:Helvetica,Arial,sans-serif;line-height:1.3;z-index:4;";
    canvasWrap.appendChild(el);
    previewEls[fieldKey] = el;
    return el;
  }

  // bol-style-03: box CSS (size/weight/style/underline) + a thin per-line preview/overflow strip
  // beneath multiline-capable fields — a plain <textarea> can't show mixed per-line styles inline.
  function updateFieldVisual(fieldKey: string) {
    const el = inputEls[fieldKey];
    if (!el) return;
    const s = scale || 1;
    const fs = styleOverrides[fieldKey];
    const baseCoord = baseCoordForField(fieldKey);
    const r = resolveFieldLineStyle(fs, null, baseCoord);
    el.style.fontSize = r.size * s + "px";
    el.style.fontWeight = r.bold ? "700" : "400";
    el.style.fontStyle = r.italic ? "italic" : "normal";
    el.style.textDecoration = r.underline ? "underline" : "none";

    if (!fieldSupportsLines(fieldKey)) return;
    const text = String((el as HTMLTextAreaElement).value || "");
    const sourceLines = text.split("\n");
    const hasLineOverrides = !!(fs && fs.lines && Object.keys(fs.lines).length);
    const measured = measureStyledField(fieldKey, text, fs);

    const preview = ensurePreviewEl(fieldKey);
    preview.innerHTML = "";
    let showPreview = false;

    if (measured.overflow) {
      const warn = document.createElement("div");
      warn.textContent =
        fieldKey === "shipTo"
          ? "⚠ Only the first 4 non-blank lines will be saved"
          : "⚠ May overflow the box";
      warn.style.cssText =
        "color:#92400e;background:#fef3c7;border:1px solid #f59e0b;border-radius:4px;padding:1px 4px;font-size:11px;font-weight:700;margin-bottom:2px;display:inline-block;";
      preview.appendChild(warn);
      showPreview = true;
      (el as HTMLElement).style.boxShadow = "0 0 0 2px #f59e0b";
    } else {
      (el as HTMLElement).style.boxShadow = "none";
    }

    if (hasLineOverrides) {
      showPreview = true;
      const strip = document.createElement("div");
      sourceLines.forEach((line, idx) => {
        const row = document.createElement("div");
        const hasOverride = !!(fs!.lines && fs!.lines[String(idx)]);
        const dot = document.createElement("span");
        dot.textContent = hasOverride ? "●" : " ";
        dot.style.cssText = "display:inline-block;width:10px;color:var(--muted,#4b5563);font-size:9px;";
        const lr = resolveFieldLineStyle(fs, idx, baseCoord);
        const span = document.createElement("span");
        span.textContent = line || " ";
        span.style.cssText =
          "font-size:" + Math.max(8, lr.size * s * 0.7) + "px;" +
          "font-weight:" + (lr.bold ? "700" : "400") + ";" +
          "font-style:" + (lr.italic ? "italic" : "normal") + ";" +
          "text-decoration:" + (lr.underline ? "underline" : "none") + ";" +
          "color:var(--muted,#4b5563);";
        row.appendChild(dot);
        row.appendChild(span);
        strip.appendChild(row);
      });
      preview.appendChild(strip);
    }
    preview.style.display = showPreview ? "block" : "none";
  }

  function positionPreview(fieldKey: string) {
    if (!fieldSupportsLines(fieldKey)) return;
    const el = inputEls[fieldKey];
    const preview = previewEls[fieldKey];
    if (!el || !preview) return;
    preview.style.left = el.style.left;
    preview.style.top = parseFloat(el.style.top) + parseFloat(el.style.height) + 2 + "px";
    preview.style.width = el.style.width;
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
    updateFieldVisual(fieldKey);
    notifyActiveField();
  }

  for (const field of FIELD_MAP) {
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
      input.style.cssText =
        "position:absolute;box-sizing:border-box;background:rgba(255,255,255,0.88);border:1.5px solid var(--border,#d1d5db);border-radius:4px;padding:1px 4px;font-family:Helvetica,Arial,sans-serif;color:var(--text,#111827);";
      el = input;
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = String(initVal);
      textarea.style.cssText =
        "position:absolute;box-sizing:border-box;background:rgba(255,255,255,0.88);border:1.5px solid var(--border,#d1d5db);border-radius:4px;padding:2px 4px;font-family:Helvetica,Arial,sans-serif;color:var(--text,#111827);resize:none;overflow:hidden;";
      textarea.addEventListener("input", function (this: HTMLTextAreaElement) {
        this.style.height = "auto";
        this.style.height = this.scrollHeight + "px";
      });
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
        updateFieldVisual(k);
        positionPreview(k);
        if (activeFieldKey === k) notifyActiveField();
      });
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
      posOverrides[k] = { dx: Math.round(dx), dy: Math.round(dy) };
      positionAll(scale);
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
      positionAll(scale);
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

    canvas.width = Math.round(logicalW * dpr);
    canvas.height = Math.round(logicalH * dpr);
    canvas.style.width = logicalW + "px";
    canvas.style.height = logicalH + "px";
    canvasWrap.style.width = logicalW + "px";
    canvasWrap.style.height = logicalH + "px";

    const ctx = canvas.getContext("2d")!;
    const vp = pdfPage.getViewport({ scale: s * dpr });
    renderTask = pdfPage.render({ canvasContext: ctx, viewport: vp });
    renderTask.promise.then(() => (renderTask = null)).catch(() => {});

    positionAll(s);
  }

  function positionAll(s: number) {
    const H = PAGE.height;
    for (const field of FIELD_MAP) {
      const k = field.overrideKey;
      const el = inputEls[k];
      if (!el) continue;

      if (field.type === "single") {
        const c = field.coord!;
        el.style.left = Math.round(c.x * s) + "px";
        el.style.top = Math.round((H - c.y) * s - (c.size || 10) * s + BASELINE_FUDGE) + "px";
        el.style.fontSize = (c.size || 10) * s + "px";
        el.style.height = Math.round(((c.size || 10) + 6) * s) + "px";
        el.style.lineHeight = Math.round(((c.size || 10) + 4) * s) + "px";
        el.style.width = Math.round((PAGE.width - c.x - 10) * s) + "px";
      } else if (field.type === "multiline") {
        const c = field.coord!;
        const lineH = c.lineH || 14;
        const lc = Math.max(2, ((el as HTMLTextAreaElement).value || "").split("\n").length);
        el.style.left = Math.round(c.x * s) + "px";
        el.style.top = Math.round((H - c.y) * s - (c.size || 10) * s + BASELINE_FUDGE) + "px";
        el.style.fontSize = (c.size || 10) * s + "px";
        el.style.width = Math.round((c.maxW || 250) * s) + "px";
        el.style.height = Math.round(lc * lineH * s + 8 * s) + "px";
        el.style.lineHeight = Math.round(lineH * s) + "px";
      } else if (field.type === "shipto") {
        const coords = field.coords as any[];
        const c1 = coords[0];
        const c4 = coords[3];
        const topPx = Math.round((H - c1.y) * s - c1.size * s + BASELINE_FUDGE);
        const bottomPx = Math.round((H - c4.y) * s + c4.size * s);
        el.style.left = Math.round(c1.x * s) + "px";
        el.style.top = topPx + "px";
        el.style.fontSize = c1.size * s + "px";
        el.style.width = Math.round(210 * s) + "px";
        el.style.height = bottomPx - topPx + "px";
        el.style.lineHeight = Math.round(14 * s) + "px";
      } else if (field.type === "scrap") {
        const coords = field.coords as any;
        const c = coords.yes;
        el.style.left = Math.round((c.x - 35) * s) + "px";
        el.style.top = Math.round((H - c.y) * s - c.size * s + BASELINE_FUDGE) + "px";
        el.style.fontSize = c.size * s + "px";
        el.querySelectorAll("button").forEach((b) => {
          (b as HTMLElement).style.fontSize = Math.round(c.size * s * 0.75) + "px";
        });
      }

      const p = posOverrides[k];
      if (p) {
        el.style.left = parseFloat(el.style.left) + p.dx * s + "px";
        el.style.top = parseFloat(el.style.top) - p.dy * s + "px";
      }
      const hx = parseFloat(el.style.left);
      const hy = parseFloat(el.style.top);
      const handle = handleEls[k];
      if (handle) {
        handle.style.left = Math.max(0, hx - 2) + "px";
        handle.style.top = Math.max(0, hy - 18) + "px";
      }

      // bol-style-03: box CSS (size/weight/style/underline) + the per-line preview/overflow strip.
      if (field.type !== "scrap") {
        updateFieldVisual(k);
        positionPreview(k);
      }
    }
    if (activeFieldKey) notifyActiveField();
  }

  applyBtn.addEventListener("click", () => {
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
    updateFieldVisual(fieldKey);
    positionPreview(fieldKey);
    notifyActiveField();
  }

  function getStyleMountNode(): HTMLElement | null {
    return canvasWrap;
  }

  return { cleanup, finishApply, setScope, setFieldStyleValue, resetFieldStyle, getStyleMountNode };
}
