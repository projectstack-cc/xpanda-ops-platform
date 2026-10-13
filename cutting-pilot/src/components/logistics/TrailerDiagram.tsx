// src/components/logistics/TrailerDiagram.tsx
// lb-ui-01: top-down trailer diagram (Decision, locked — not the legacy side elevation). Trailer
// length runs horizontally; trailer width runs vertically. Stack height is not drawn as geometry —
// see ColumnDetailPanel for that.
//
// The engine's defining behaviour is width pairing (columns of different footprints sharing a row
// across the trailer's width) — a side elevation can't show that, so this reads top-down instead.
//
// Steve, 2026-09-16: nose (cab end) on the left, rear (doors) on the right — readers scan left to
// right, and loading runs nose-first (lb-engine-03 B3). Was rear-left/nose-right (matching legacy's
// own diagram and this file's original lb-ui-01 layout); deliberately flipped on this direct
// instruction. `trailer.rows` itself is still ordered rear-first (index 0 = posFromFront 0,
// unchanged — every rowIndex-keyed prop below, e.g. onSelectColumn/onRowDrop/rowGuardTint, still
// addresses that same original array position); only the VISUAL draw order is reversed, via
// `displayRowIndices` below, so the rear-most row now renders rightmost. Each row's own shallow-
// column anchor (left-0) is UNCHANGED by the mirror — see the geometry note below for why that's a
// rendering convention, not a physical placement, and so has nothing to flip.
//
// row-order-nose-first, same day: packEngine.ts's row sort was ALSO backwards until this fix — it
// put the thickest-base row at the rear/posFromFront 0, which under nose-first loading means the
// thickest freight was loaded LAST, not first. Steve confirmed the actual rule: biggest sizes go
// in first, so they sit at the nose (loaded first). The array is now thinnest-at-rear/thickest-at-
// nose — this component's own left/right mirror logic didn't change (it's thickness-agnostic, just
// an index reversal), so this file needed no code change, only this corrected comment.
//
// Geometry: each PackRow is a vertical slice, on-screen WIDTH proportional to rowLength/dims.length.
// Within a slice, each PackColumn is a block stacked by posY, on-screen HEIGHT proportional to
// colWidth/dims.width. A column shallower than its row (colLength < rowLength) is rendered at a
// fraction of the slice's width (colLength/rowLength) flush to the slice's own left edge — the
// remainder is that lane's wastedFloorArea, left showing the slice's own striped "unused floor"
// backdrop rather than being covered by the column block. This is a display convention, not a
// physical placement decision: PackColumn carries no along-length offset within its row (only
// posY, on the width axis), so the engine itself doesn't model where in the row's depth a shallow
// column actually sits — nothing here to preserve "flush to the rear" under the mirror above.
//
// Token note: the prompt's spec named var(--surface-2)/var(--border-strong) for pure columns and
// var(--bg-accent)/var(--border-accent)/var(--text-accent) for mixed columns — none of the accent
// trio exists in globals.css (see PlanMetricsStrip.tsx's token note for --surface-1). Substituted
// the platform's existing "info" semantic tokens for the mixed-column tint (already theme-aware,
// already used for banners elsewhere) and --border/--card-bg for pure columns.
//
// lb-ui-02: extended (not forked) with optional editing affordances for CustomizeEditor — native
// HTML5 drag source/drop target on rows, a persistent guard tint, and a keyboard target-picker
// overlay ("select column, choose target, confirm"). Every addition is an optional prop; omitting
// all of them (LoadPlanView's read-only panel does) renders byte-identical to lb-ui-01.
//
// lb-ui-03: one more optional addition — `headerAction`, an arbitrary node rendered in the header
// row next to the usedLength/row-count stat, so CustomizeEditor can put a per-trailer "Dissolve…"
// action there without a second header row or forking the component.
//
// lbr-05 (Steve, 2026-10-12: "colors don't differentiate pieces well enough"): cells are FILLED by
// the base layer's thickness color (thicknessPalette.ts — same thickness, same color, every load,
// screen and PDF), replacing the per-SKU border stripes and the pure/mixed info tint. Every cell
// carries its size label (`13″×8`), so color is never the only signal; fractional / >16″ sizes add
// a diagonal hatch. A topped stack draws its top-off as a band in the top layer's color above a
// dashed line, with a TOP-OFF tag; a partial pure stack gets a LEFTOVER tag (columns without
// stackKind — old saved plans — get no tag). Rows are labelled across the top the way legacy prints
// them: R1 at the doors (array index 0) up to Rn at the nose; display stays nose-left/doors-right.
// The per-SKU legend becomes a per-thickness Key. Every existing prop and behaviour is unchanged
// (CustomizeEditor depends on them); selection and edit-mode tints are outlines/overlays so they
// stay legible over any fill. Two additive optional props, `title` and `subtitle`, let the Results
// card show "Trailer N · type · L″×W″×H″" plus a legacy-style subtitle without forking.
//
// lbr-07: drag-and-drop removed (Customize is tap-to-place now). The drag props, the keyboard
// "Move here" overlay and the drop-feedback strip are gone; in their place, three optional props for
// Customize's Step 2 — `columnVerdict` (green ring = ok, amber ring + "!" = warn, faded = no),
// `slotVerdict`/`onChooseSlot` (a lane of dashed "+" new-stack slots under the rows, plus "+ new
// row" at the doors end). In edit mode the diagram is laid out in px, scaled so the shallowest row
// and the narrowest stack stay ≥ 44px (floor-grade targets); it scrolls inside its card as before.
// Read-only rendering (Results) is unchanged.
"use client";

import type { CSSProperties, ReactNode } from "react";
import type { Dimensions, PackColumn, PackTrailer } from "@/lib/packEngine";
import { thicknessColor, thicknessLabel } from "@/lib/thicknessPalette";

interface SelectedColumn {
  rowIndex: number;
  columnIndex: number;
}

/** lbr-07: a Customize target's verdict (loadEditor's TargetVerdict, minus heightAfter). */
export interface TapVerdict {
  level: "ok" | "warn" | "no";
  reason: string;
}

/** Ring/fade for a stack that is (or isn't) a valid target. */
function verdictStyle(v: TapVerdict | null): CSSProperties {
  if (!v) return {};
  if (v.level === "ok") return { boxShadow: "inset 0 0 0 4px var(--success-bg)" };
  if (v.level === "warn") return { boxShadow: "inset 0 0 0 4px var(--warn-text)" };
  return { opacity: 0.3 };
}

function verdictSuffix(v: TapVerdict | null): string {
  if (!v) return "";
  if (v.level === "ok") return ` Can go here — ${v.reason}.`;
  if (v.level === "warn") return ` Can go here, with a warning — ${v.reason}.`;
  return ` Can't go here — ${v.reason}.`;
}

interface TrailerDiagramProps {
  trailer: PackTrailer;
  dims: Dimensions;
  trailerIndex: number;
  selectedColumn: SelectedColumn | null;
  onSelectColumn: (rowIndex: number, columnIndex: number) => void;
  // --- lb-ui-02 / lbr-07 editing additions, all optional ---
  /** Customize mode: px layout with ≥ 44px targets, verdict rings, the "+" slot lane. */
  editable?: boolean;
  /** Persistent tint for a row a blocking guard has implicated. */
  rowGuardTint?: (rowIndex: number) => boolean;
  /** lbr-07: this stack's verdict as a Step 2 target (null = not a target / nothing armed). */
  columnVerdict?: (rowIndex: number, columnIndex: number) => TapVerdict | null;
  /** lbr-07: a "+" new-stack slot at the end of a row, or "new" = a new row at the doors end.
   * null = no slot drawn there. */
  slotVerdict?: (rowIndex: number | "new") => TapVerdict | null;
  onChooseSlot?: (rowIndex: number | "new") => void;
  /** lb-ui-03: rendered in the header row, right of the usedLength stat. */
  headerAction?: ReactNode;
  /** lb-ui-12: set by the caller (who knows the plan's primary trailer type — this component only
   * ever sees ONE trailer's own dims) when trailer.type diverges from it, e.g. "Auto-downsized ·
   * 26ft Box Truck". Rendered as a small pill next to the "Trailer N" title. Omitted/undefined
   * renders nothing — the common case where every trailer is the primary type. */
  typeBadge?: string;
  /** lbr-05: replaces the default "Trailer N" heading (e.g. "Trailer 1 · 53ft Standard · 636″×98″×109″"). */
  title?: ReactNode;
  /** lbr-05: replaces the default "N″ of M″ used · R rows" stat line. */
  subtitle?: ReactNode;
}

// Rows are drawn nose-first (visual left) to rear-most (visual right) — the reverse of
// trailer.rows' own array order (rear-first, index 0 = posFromFront 0). Returns original array
// indices in draw order, so every rowIndex-keyed callback still addresses the true array position.
function displayRowIndices(rowCount: number): number[] {
  return Array.from({ length: rowCount }, (_, i) => rowCount - 1 - i);
}

// Every distinct thickness on this trailer (base and top-off layers), thickest first — the Key.
function thicknessesOn(trailer: PackTrailer): number[] {
  const set = new Set<number>();
  for (const row of trailer.rows) for (const column of row.columns) for (const layer of column.layers) set.add(layer.unitHeight);
  return Array.from(set).sort((a, b) => b - a);
}

/** Diagonal stripe overlay for hatched (fractional / >16″) sizes, in the cell's own fg. */
function hatchStyle(fg: string): CSSProperties {
  return { backgroundImage: `repeating-linear-gradient(135deg, ${fg} 0 2px, transparent 2px 7px)`, opacity: 0.35 };
}

function inches(n: number): string {
  return thicknessLabel(n).replace("″", " inch");
}

/** "Stack: 11 inch × 9, 10 inch × 1 on top, 109 inches." */
function stackAccessibleName(column: PackColumn): string {
  const [base, ...rest] = column.layers;
  if (!base) return "Empty stack.";
  const parts = [`${inches(base.unitHeight)} × ${base.count}`];
  for (const l of rest) parts.push(`${inches(l.unitHeight)} × ${l.count} on top`);
  const total = Math.round(column.totalHeight * 100) / 100;
  return `Stack: ${parts.join(", ")}, ${total} inches.`;
}

const DIAGRAM_HEIGHT_PX = 240;
// Below these fractions a column's on-screen box is too small to hold the 14px label legibly —
// drop the label rather than shrinking the type (the accessible name still carries it).
const MIN_WIDTH_FRACTION_FOR_LABEL = 0.07;
const MIN_DEPTH_FRACTION_FOR_LABEL = 0.1;
// The diagram never squeezes below this; narrower screens scroll it inside its card.
const DIAGRAM_MIN_WIDTH_PX = 720;
const TOP_BAND_MIN_PX = 24;
// lbr-07 (edit mode): every stack and row is at least this big, so each tap target is ≥ 44px.
const EDIT_MIN_TARGET_PX = 48;
const EDIT_EMPTY_ROW_PX = 56;
const EDIT_NEW_ROW_MIN_PX = 96;

export default function TrailerDiagram({
  trailer,
  dims,
  trailerIndex,
  selectedColumn,
  onSelectColumn,
  editable = false,
  rowGuardTint,
  columnVerdict,
  slotVerdict,
  onChooseSlot,
  headerAction,
  typeBadge,
  title,
  subtitle,
}: TrailerDiagramProps) {
  const keyThicknesses = thicknessesOn(trailer);
  const displayOrder = displayRowIndices(trailer.rows.length);

  // lbr-07: edit-mode px layout. Inches -> px, scaled so the shallowest stack (along the length) and
  // the narrowest stack (across the width) are each ≥ EDIT_MIN_TARGET_PX; empty placeholder rows get
  // a fixed width so their "+" slot still exists.
  const allColumns = trailer.rows.flatMap((r) => r.columns);
  const minColLength = Math.min(...allColumns.map((c) => c.colLength), dims.length);
  const minColWidth = Math.min(...allColumns.map((c) => c.colWidth), dims.width);
  const pxPerInch = editable && dims.length > 0 ? Math.max(DIAGRAM_MIN_WIDTH_PX / dims.length, EDIT_MIN_TARGET_PX / Math.max(1, minColLength)) : 0;
  const bandHeightPx = editable && dims.width > 0 ? Math.max(DIAGRAM_HEIGHT_PX, Math.ceil((EDIT_MIN_TARGET_PX * dims.width) / Math.max(1, minColWidth))) : DIAGRAM_HEIGHT_PX;
  const rowPx = (rowIndex: number) => {
    const len = trailer.rows[rowIndex].rowLength;
    return len > 0 ? Math.round(len * pxPerInch) : EDIT_EMPTY_ROW_PX;
  };
  const freeLength = Math.max(0, dims.length - trailer.usedLength);
  const newRowVerdict = editable ? slotVerdict?.("new") ?? null : null;
  const freePx = editable ? Math.max(freeLength * pxPerInch, newRowVerdict ? EDIT_NEW_ROW_MIN_PX : 0) : 0;
  const editWidthPx = editable ? displayOrder.reduce((s, r) => s + rowPx(r), 0) + freePx : 0;
  const rowWidthStyle = (rowIndex: number): CSSProperties =>
    editable ? { width: rowPx(rowIndex) } : { width: `${dims.length > 0 ? (trailer.rows[rowIndex].rowLength / dims.length) * 100 : 0}%` };
  const anySlot = editable && !!slotVerdict && (newRowVerdict !== null || displayOrder.some((r) => slotVerdict(r) !== null));

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-text">{title ?? `Trailer ${trailerIndex + 1}`}</h3>
          {typeBadge && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--brand)_12%,transparent)] text-[var(--brand)]">
              {typeBadge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 ml-auto">
          {subtitle === undefined ? (
            <span className="text-xs font-mono tabular-nums text-muted">
              {Math.round(trailer.usedLength)}&quot; of {Math.round(dims.length)}&quot; used · {trailer.rows.length} row{trailer.rows.length === 1 ? "" : "s"}
            </span>
          ) : null}
          {headerAction}
        </div>
      </div>

      {subtitle !== undefined && subtitle !== null && <div className="-mt-2 mb-3 text-xs font-mono tabular-nums text-muted">{subtitle}</div>}

      <div className="overflow-x-auto">
      <div style={editable ? { width: Math.max(editWidthPx, DIAGRAM_MIN_WIDTH_PX) } : { minWidth: DIAGRAM_MIN_WIDTH_PX }}>
      <div className="flex items-center justify-between text-[11px] font-semibold tracking-wide text-text-hint mb-1">
        <span>FRONT · NOSE</span>
        <span>REAR · DOORS</span>
      </div>

      {/* Row labels, legacy print style: R1 at the doors (array index 0) up to Rn at the nose. */}
      <div className="flex w-full mb-0.5" aria-hidden="true">
        {displayOrder.map((rowIndex) => (
          <div key={rowIndex} className="shrink-0 text-center text-[11px] font-mono tabular-nums text-muted" style={rowWidthStyle(rowIndex)}>
            R{rowIndex + 1}
          </div>
        ))}
      </div>

      <div
        className="flex w-full rounded-md overflow-hidden border border-[var(--line)]"
        style={{ height: bandHeightPx }}
      >
        {displayOrder.map((rowIndex, displayPos) => {
          const row = trailer.rows[rowIndex];
          const guarded = editable ? rowGuardTint?.(rowIndex) ?? false : false;
          const isLastDisplayed = displayPos === displayOrder.length - 1;
          return (
            <div
              key={rowIndex}
              className={`relative shrink-0 border-[var(--line)] ${isLastDisplayed ? "" : "border-r"}`}
              style={{
                ...rowWidthStyle(rowIndex),
                // Striped "unused floor" backdrop — shows through wherever a column doesn't cover
                // its lane (shallow depth) or the row's total column width falls short of dims.width.
                backgroundImage:
                  "repeating-linear-gradient(135deg, var(--ghost-bg), var(--ghost-bg) 6px, var(--surface-2) 6px, var(--surface-2) 12px)",
              }}
            >
              {guarded && (
                <div
                  className="absolute inset-0 pointer-events-none z-[5]"
                  style={{
                    background: "color-mix(in srgb, var(--danger-bg) 12%, transparent)",
                    boxShadow: "inset 0 0 0 2px var(--danger-bg)",
                  }}
                  aria-hidden="true"
                />
              )}
              {row.columns.map((column, columnIndex) => {
                const heightPct = dims.width > 0 ? (column.colWidth / dims.width) * 100 : 0;
                const topPct = dims.width > 0 ? (column.posY / dims.width) * 100 : 0;
                const widthPct = row.rowLength > 0 ? (column.colLength / row.rowLength) * 100 : 100;
                const isSelected = selectedColumn?.rowIndex === rowIndex && selectedColumn?.columnIndex === columnIndex;
                const verdict = editable ? columnVerdict?.(rowIndex, columnIndex) ?? null : null;
                const showLabel = column.colWidth / dims.width >= MIN_WIDTH_FRACTION_FOR_LABEL && column.colLength / row.rowLength >= MIN_DEPTH_FRACTION_FOR_LABEL;
                const baseLayer = column.layers[0];
                const topLayer = column.layers.length > 1 ? column.layers[column.layers.length - 1] : null;
                const baseColor = baseLayer ? thicknessColor(baseLayer.unitHeight) : null;
                const topColor = topLayer ? thicknessColor(topLayer.unitHeight) : null;
                const columnHeightPx = (heightPct / 100) * bandHeightPx;
                const topFrac = topLayer && column.totalHeight > 0 ? (topLayer.unitHeight * topLayer.count) / column.totalHeight : 0;
                const topBandPx = topLayer ? Math.min(columnHeightPx * 0.6, Math.max(TOP_BAND_MIN_PX, columnHeightPx * topFrac)) : 0;
                const tag = topLayer ? "TOP-OFF" : column.stackKind === "partial" ? "LEFTOVER" : null;

                return (
                  <button
                    key={columnIndex}
                    type="button"
                    onClick={() => onSelectColumn(rowIndex, columnIndex)}
                    aria-pressed={isSelected}
                    aria-label={`${stackAccessibleName(column)} Trailer ${trailerIndex + 1}, row R${rowIndex + 1}, position ${columnIndex + 1}.${verdictSuffix(verdict)}`}
                    title={verdict ? verdict.reason : column.rationale}
                    className={[
                      "absolute left-0 flex flex-col overflow-hidden text-left box-border cursor-pointer",
                      "border border-[var(--line)] transition-[filter] hover:brightness-95",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:z-10",
                      isSelected ? "ring-2 ring-[var(--brand)] z-10" : "",
                    ].join(" ")}
                    style={{
                      top: `${topPct}%`,
                      height: `${heightPct}%`,
                      width: `${widthPct}%`,
                      background: baseColor?.bg,
                      color: baseColor?.fg,
                      ...verdictStyle(verdict),
                      // Selection: a 3px outline in the text token, inset so it stays visible over
                      // any fill, plus the brand ring above — and, in Customize (lbr-07), a yellow ring.
                      ...(isSelected ? { outline: "3px solid var(--text)", outlineOffset: -3 } : {}),
                      ...(isSelected && editable ? { boxShadow: "inset 0 0 0 7px var(--warn-border)" } : {}),
                    }}
                  >
                    {verdict?.level === "warn" && (
                      <span
                        className="absolute top-1 right-1 z-10 w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold border"
                        style={{ background: "var(--warn-bg)", color: "var(--warn-text)", borderColor: "var(--warn-text)" }}
                        aria-hidden="true"
                      >
                        !
                      </span>
                    )}
                    {topLayer && topColor && (
                      <span
                        className="relative w-full shrink-0 flex items-center justify-center"
                        style={{ height: topBandPx, background: topColor.bg, color: topColor.fg, borderBottom: `2px dashed ${baseColor?.fg}` }}
                      >
                        {topColor.hatched && <span className="absolute inset-0 pointer-events-none" style={hatchStyle(topColor.fg)} aria-hidden="true" />}
                        {showLabel && (
                          <span className="relative text-[14px] leading-none font-mono font-semibold tabular-nums truncate px-1">
                            +{thicknessLabel(topLayer.unitHeight)}×{topLayer.count}
                          </span>
                        )}
                      </span>
                    )}
                    <span className="relative w-full flex-1 min-h-0 flex flex-col items-center justify-center gap-0.5">
                      {baseColor?.hatched && <span className="absolute inset-0 pointer-events-none" style={hatchStyle(baseColor.fg)} aria-hidden="true" />}
                      {showLabel && baseLayer && (
                        <span className="relative text-[14px] leading-none font-mono font-semibold tabular-nums truncate px-1">
                          {thicknessLabel(baseLayer.unitHeight)}×{baseLayer.count}
                        </span>
                      )}
                      {/* Stacked under the label (never over it); dropped when both don't fit. */}
                      {showLabel && tag && columnHeightPx - topBandPx >= 32 && (
                        <span className="relative text-[9px] font-semibold tracking-wide leading-none px-1 py-0.5 rounded-sm bg-surface text-text border border-[var(--line)]">
                          {tag}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {editable && freePx > 0 && <div className="shrink-0" style={{ width: freePx }} aria-hidden="true" />}
      </div>

      {/* lbr-07: "+" new-stack slots, one under each row that has width left, and "+ new row" under
          the free floor at the doors end. Only drawn while a placement action is armed. */}
      {anySlot && (
        <div className="flex mt-1.5" style={{ width: editWidthPx }}>
          {displayOrder.map((rowIndex) => {
            const v = slotVerdict?.(rowIndex) ?? null;
            return (
              <div key={rowIndex} className="shrink-0 px-0.5" style={rowWidthStyle(rowIndex)}>
                {v && (
                  <SlotButton verdict={v} label="+" ariaLabel={`New stack at the end of row R${rowIndex + 1}.${verdictSuffix(v)}`} onClick={() => onChooseSlot?.(rowIndex)} />
                )}
              </div>
            );
          })}
          {freePx > 0 && (
            <div className="shrink-0 px-0.5" style={{ width: freePx }}>
              {newRowVerdict && (
                <SlotButton verdict={newRowVerdict} label="+ new row" ariaLabel={`New row at the doors end of trailer ${trailerIndex + 1}.${verdictSuffix(newRowVerdict)}`} onClick={() => onChooseSlot?.("new")} />
              )}
            </div>
          )}
        </div>
      )}

      </div>
      </div>

      {/* Key (lbr-05): one swatch per thickness on this trailer, plus how to read a box. */}
      <div className="mt-3 pt-2 border-t border-[var(--line)] text-xs text-muted space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-semibold text-text">Key</span>
          {keyThicknesses.map((t) => {
            const c = thicknessColor(t);
            return (
              <span key={t} className="inline-flex items-center gap-1.5">
                <span className="relative inline-block w-4 h-4 rounded-sm border border-[var(--line)] overflow-hidden" style={{ background: c.bg }} aria-hidden="true">
                  {c.hatched && <span className="absolute inset-0" style={hatchStyle(c.fg)} />}
                </span>
                <span className="font-mono tabular-nums text-text">{thicknessLabel(t).replace("″", " in")}</span>
              </span>
            );
          })}
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-6 border-t-2 border-dashed border-[var(--text)]" aria-hidden="true" />
            top-off sits above the line
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-4 h-4 rounded-sm border border-[var(--line)]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(135deg, var(--ghost-bg), var(--ghost-bg) 3px, var(--surface-2) 3px, var(--surface-2) 6px)",
              }}
              aria-hidden="true"
            />
            unused floor
          </span>
        </div>
        <div>Each box = one stack · “11″×9” = nine 11-inch pieces</div>
      </div>
    </div>
  );
}

/** lbr-07: a dashed "+" target in the slot lane — ≥ 44px, colored by its verdict. */
function SlotButton({ verdict, label, ariaLabel, onClick }: { verdict: TapVerdict; label: string; ariaLabel: string; onClick: () => void }) {
  const color = verdict.level === "ok" ? "var(--success-bg)" : verdict.level === "warn" ? "var(--warn-text)" : "var(--border)";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={verdict.reason}
      className="w-full min-h-[44px] rounded-md border-2 border-dashed text-[13px] font-semibold cursor-pointer bg-surface text-text whitespace-nowrap overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      style={{ borderColor: color, opacity: verdict.level === "no" ? 0.45 : 1 }}
    >
      {label}
    </button>
  );
}
