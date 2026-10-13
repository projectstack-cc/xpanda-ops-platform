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
"use client";

import type { CSSProperties, ReactNode } from "react";
import type { Dimensions, PackColumn, PackTrailer } from "@/lib/packEngine";
import { thicknessColor, thicknessLabel } from "@/lib/thicknessPalette";

interface SelectedColumn {
  rowIndex: number;
  columnIndex: number;
}

export interface RowDropFeedback {
  ok: boolean;
  reason: string;
}

interface TrailerDiagramProps {
  trailer: PackTrailer;
  dims: Dimensions;
  trailerIndex: number;
  selectedColumn: SelectedColumn | null;
  onSelectColumn: (rowIndex: number, columnIndex: number) => void;
  // --- lb-ui-02 additions, all optional ---
  /** Enables drag sources, drop targets, and the keyboard target-picker. */
  editable?: boolean;
  /** The column currently being dragged, if it lives on this trailer — rendered as a dashed
   * placeholder in its original position rather than removed, so the drop target it came from
   * doesn't vanish mid-drag. */
  draggingFrom?: SelectedColumn | null;
  onColumnDragStart?: (rowIndex: number, columnIndex: number) => void;
  onColumnDragEnd?: () => void;
  /** Fires while something is dragged over a row, so the parent can compute live canDrop() feedback. */
  onRowDragOver?: (rowIndex: number) => void;
  onRowDrop?: (rowIndex: number) => void;
  /** Parent-computed hover feedback for the row currently being dragged over. */
  rowDropFeedback?: (rowIndex: number) => RowDropFeedback | null;
  /** Persistent (not drag-dependent) tint for a row a blocking guard has implicated. */
  rowGuardTint?: (rowIndex: number) => boolean;
  /** True while a column is selected and "Move" has been invoked — every row grows a
   * keyboard-focusable "Move here" target. */
  targetPickerActive?: boolean;
  onChooseTargetRow?: (rowIndex: number) => void;
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

export default function TrailerDiagram({
  trailer,
  dims,
  trailerIndex,
  selectedColumn,
  onSelectColumn,
  editable = false,
  draggingFrom = null,
  onColumnDragStart,
  onColumnDragEnd,
  onRowDragOver,
  onRowDrop,
  rowDropFeedback,
  rowGuardTint,
  targetPickerActive = false,
  onChooseTargetRow,
  headerAction,
  typeBadge,
  title,
  subtitle,
}: TrailerDiagramProps) {
  const keyThicknesses = thicknessesOn(trailer);
  const displayOrder = displayRowIndices(trailer.rows.length);
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
      <div style={{ minWidth: DIAGRAM_MIN_WIDTH_PX }}>
      <div className="flex items-center justify-between text-[11px] font-semibold tracking-wide text-text-hint mb-1">
        <span>FRONT · NOSE</span>
        <span>REAR · DOORS</span>
      </div>

      {/* Row labels, legacy print style: R1 at the doors (array index 0) up to Rn at the nose. */}
      <div className="flex w-full mb-0.5" aria-hidden="true">
        {displayOrder.map((rowIndex) => {
          const row = trailer.rows[rowIndex];
          const rowWidthPct = dims.length > 0 ? (row.rowLength / dims.length) * 100 : 0;
          return (
            <div key={rowIndex} className="shrink-0 text-center text-[11px] font-mono tabular-nums text-muted" style={{ width: `${rowWidthPct}%` }}>
              R{rowIndex + 1}
            </div>
          );
        })}
      </div>

      <div
        className="flex w-full rounded-md overflow-hidden border border-[var(--line)]"
        style={{ height: DIAGRAM_HEIGHT_PX }}
      >
        {displayOrder.map((rowIndex, displayPos) => {
          const row = trailer.rows[rowIndex];
          const rowWidthPct = dims.length > 0 ? (row.rowLength / dims.length) * 100 : 0;
          const feedback = editable ? rowDropFeedback?.(rowIndex) ?? null : null;
          const guarded = editable ? rowGuardTint?.(rowIndex) ?? false : false;
          const isLastDisplayed = displayPos === displayOrder.length - 1;
          return (
            <div
              key={rowIndex}
              className={`relative shrink-0 border-[var(--line)] ${isLastDisplayed ? "" : "border-r"}`}
              style={{
                width: `${rowWidthPct}%`,
                // Striped "unused floor" backdrop — shows through wherever a column doesn't cover
                // its lane (shallow depth) or the row's total column width falls short of dims.width.
                backgroundImage:
                  "repeating-linear-gradient(135deg, var(--ghost-bg), var(--ghost-bg) 6px, var(--surface-2) 6px, var(--surface-2) 12px)",
              }}
              onDragOver={
                editable
                  ? (e) => {
                      e.preventDefault();
                      onRowDragOver?.(rowIndex);
                    }
                  : undefined
              }
              onDrop={
                editable
                  ? (e) => {
                      e.preventDefault();
                      onRowDrop?.(rowIndex);
                    }
                  : undefined
              }
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
              {feedback && (
                <div
                  className="absolute inset-x-0 top-0 z-20 px-1.5 py-1 text-[10px] font-mono tabular-nums leading-tight pointer-events-none"
                  style={{
                    background: feedback.ok ? "var(--success-bg)" : "var(--danger-bg)",
                    // on-color-ok: same ternary sets the solid matching --success-bg / --danger-bg above
                    color: feedback.ok ? "var(--success-text)" : "var(--danger-text)",
                  }}
                >
                  {feedback.reason}
                </div>
              )}
              {targetPickerActive && (
                <button
                  type="button"
                  onClick={() => onChooseTargetRow?.(rowIndex)}
                  className="absolute inset-0 z-20 flex items-center justify-center text-[11px] font-semibold cursor-pointer border-2 border-dashed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                  style={{
                    background: "color-mix(in srgb, var(--brand) 10%, transparent)",
                    borderColor: "var(--brand)",
                    color: "var(--brand)",
                  }}
                >
                  Move here (row {rowIndex + 1})
                </button>
              )}
              {row.columns.map((column, columnIndex) => {
                const heightPct = dims.width > 0 ? (column.colWidth / dims.width) * 100 : 0;
                const topPct = dims.width > 0 ? (column.posY / dims.width) * 100 : 0;
                const widthPct = row.rowLength > 0 ? (column.colLength / row.rowLength) * 100 : 100;
                const isSelected = selectedColumn?.rowIndex === rowIndex && selectedColumn?.columnIndex === columnIndex;
                const isDragging = draggingFrom?.rowIndex === rowIndex && draggingFrom?.columnIndex === columnIndex;
                const showLabel = column.colWidth / dims.width >= MIN_WIDTH_FRACTION_FOR_LABEL && column.colLength / row.rowLength >= MIN_DEPTH_FRACTION_FOR_LABEL;
                const baseLayer = column.layers[0];
                const topLayer = column.layers.length > 1 ? column.layers[column.layers.length - 1] : null;
                const baseColor = baseLayer ? thicknessColor(baseLayer.unitHeight) : null;
                const topColor = topLayer ? thicknessColor(topLayer.unitHeight) : null;
                const columnHeightPx = (heightPct / 100) * DIAGRAM_HEIGHT_PX;
                const topFrac = topLayer && column.totalHeight > 0 ? (topLayer.unitHeight * topLayer.count) / column.totalHeight : 0;
                const topBandPx = topLayer ? Math.min(columnHeightPx * 0.6, Math.max(TOP_BAND_MIN_PX, columnHeightPx * topFrac)) : 0;
                const tag = topLayer ? "TOP-OFF" : column.stackKind === "partial" ? "LEFTOVER" : null;

                return (
                  <button
                    key={columnIndex}
                    type="button"
                    draggable={editable}
                    onDragStart={editable ? () => onColumnDragStart?.(rowIndex, columnIndex) : undefined}
                    onDragEnd={editable ? () => onColumnDragEnd?.() : undefined}
                    onClick={() => onSelectColumn(rowIndex, columnIndex)}
                    aria-pressed={isSelected}
                    aria-label={`${stackAccessibleName(column)} Trailer ${trailerIndex + 1}, row R${rowIndex + 1}, position ${columnIndex + 1}.`}
                    title={column.rationale}
                    className={[
                      "absolute left-0 flex flex-col overflow-hidden text-left box-border",
                      editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                      "border border-[var(--line)] transition-[filter] hover:brightness-95",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:z-10",
                      isSelected ? "ring-2 ring-[var(--brand)] z-10" : "",
                      isDragging ? "opacity-40 border-dashed" : "",
                    ].join(" ")}
                    style={{
                      top: `${topPct}%`,
                      height: `${heightPct}%`,
                      width: `${widthPct}%`,
                      background: baseColor?.bg,
                      color: baseColor?.fg,
                      // Selection: a 3px outline in the text token, inset so it stays visible over
                      // any fill, plus the brand ring above.
                      ...(isSelected ? { outline: "3px solid var(--text)", outlineOffset: -3 } : {}),
                    }}
                  >
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
      </div>

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
