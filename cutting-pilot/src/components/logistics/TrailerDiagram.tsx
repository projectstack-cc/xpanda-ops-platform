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
"use client";

import type { ReactNode } from "react";
import type { Dimensions, PackTrailer } from "@/lib/packEngine";

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
}

// Rows are drawn nose-first (visual left) to rear-most (visual right) — the reverse of
// trailer.rows' own array order (rear-first, index 0 = posFromFront 0). Returns original array
// indices in draw order, so every rowIndex-keyed callback still addresses the true array position.
function displayRowIndices(rowCount: number): number[] {
  return Array.from({ length: rowCount }, (_, i) => rowCount - 1 - i);
}

// Every distinct SKU placed on this trailer, name-sorted, one entry per skuId — the legend
// decoding the per-SKU border-stripe colors added to each column box below. Colors come straight
// off PackLayer.color (packEngine.ts's colorForSku, already computed, previously unused by this
// component — see loadingDiagramPdf.ts's PIECES table and JobPullModal's SKU swatches for the
// same palette used elsewhere).
function skuLegendFor(trailer: PackTrailer): { skuId: string; name: string; color: string }[] {
  const bySku = new Map<string, { skuId: string; name: string; color: string }>();
  for (const row of trailer.rows) {
    for (const column of row.columns) {
      for (const layer of column.layers) {
        if (!bySku.has(layer.skuId)) {
          bySku.set(layer.skuId, { skuId: layer.skuId, name: layer.skuName, color: layer.color });
        }
      }
    }
  }
  return Array.from(bySku.values()).sort((a, b) => a.name.localeCompare(b.name));
}

const DIAGRAM_HEIGHT_PX = 176;
// Below these fractions a column's on-screen box is too small to hold ≥11px text legibly —
// drop the label rather than shrinking the type (per spec).
const MIN_WIDTH_FRACTION_FOR_LABEL = 0.07;
const MIN_DEPTH_FRACTION_FOR_LABEL = 0.1;

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
}: TrailerDiagramProps) {
  const skuLegend = skuLegendFor(trailer);
  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-text">Trailer {trailerIndex + 1}</h3>
          {typeBadge && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--brand)_12%,transparent)] text-[var(--brand)]">
              {typeBadge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-xs font-mono tabular-nums text-muted">
            {Math.round(trailer.usedLength)}&quot; of {Math.round(dims.length)}&quot; used · {trailer.rows.length} row{trailer.rows.length === 1 ? "" : "s"}
          </span>
          {headerAction}
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-text-hint mb-1">
        <span>Nose</span>
        <span>Rear (doors)</span>
      </div>

      <div
        className="flex w-full rounded-md overflow-hidden border border-[var(--line)]"
        style={{ height: DIAGRAM_HEIGHT_PX }}
      >
        {displayRowIndices(trailer.rows.length).map((rowIndex, displayPos, displayOrder) => {
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
                    background: feedback.ok ? "color-mix(in srgb, var(--success-bg) 85%, transparent)" : "color-mix(in srgb, var(--danger-bg) 85%, transparent)",
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
                // Per-SKU color stripes (Steve's requested color coding — colorForSku already
                // computed by packEngine.ts onto every PackLayer, but never rendered here). Left
                // edge is always the base SKU's color; a topped-off column also gets its last
                // (topmost) layer's color on the right edge, so a two-colored box reads as "two
                // SKUs stacked here" at a glance, without depending on the text label fitting.
                // Existing pure/mixed background/border stays as the "was this topped off" status
                // signal — the stripes are layered ON TOP of that, not a replacement for it.
                const topLayer = column.layers[column.layers.length - 1];

                return (
                  <button
                    key={columnIndex}
                    type="button"
                    draggable={editable}
                    onDragStart={editable ? () => onColumnDragStart?.(rowIndex, columnIndex) : undefined}
                    onDragEnd={editable ? () => onColumnDragEnd?.() : undefined}
                    onClick={() => onSelectColumn(rowIndex, columnIndex)}
                    aria-pressed={isSelected}
                    aria-label={`Trailer ${trailerIndex + 1}, row ${rowIndex + 1}, column ${columnIndex + 1}${column.mixed ? " (mixed)" : ""}: ${column.rationale}`}
                    className={[
                      "absolute left-0 flex items-center justify-center overflow-hidden",
                      editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                      "border box-border text-left px-1 transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:z-10",
                      column.mixed
                        ? "bg-[var(--info-bg)] border-[var(--info-border)] text-[var(--info-text)] hover:brightness-95"
                        : "bg-[var(--card-bg)] border-[var(--border)] text-text hover:bg-[var(--ghost-bg)]",
                      isSelected ? "ring-2 ring-[var(--brand)] z-10" : "",
                      isDragging ? "opacity-40 border-dashed" : "",
                    ].join(" ")}
                    style={{
                      top: `${topPct}%`,
                      height: `${heightPct}%`,
                      width: `${widthPct}%`,
                      borderLeftWidth: 4,
                      borderLeftColor: baseLayer?.color,
                      ...(column.mixed && topLayer
                        ? { borderRightWidth: 4, borderRightColor: topLayer.color }
                        : {}),
                    }}
                  >
                    {showLabel && baseLayer && (
                      <span className="text-[11px] leading-tight font-mono tabular-nums truncate">
                        {baseLayer.unitHeight}&quot; · {column.stackCount}pc
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 mt-2 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-[var(--card-bg)] border border-[var(--border)]" aria-hidden="true" />
          Pure stack
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-[var(--info-bg)] border border-[var(--info-border)]" aria-hidden="true" />
          Mixed (multiple SKUs)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-3 rounded-sm border border-[var(--line)]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, var(--ghost-bg), var(--ghost-bg) 3px, var(--surface-2) 3px, var(--surface-2) 6px)",
            }}
            aria-hidden="true"
          />
          Unused floor
        </span>
      </div>

      {skuLegend.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 pt-1.5 border-t border-[var(--line)] text-[11px] text-muted">
          {skuLegend.map((s) => (
            <span key={s.skuId} className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} aria-hidden="true" />
              <span className="truncate max-w-[160px]">{s.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
