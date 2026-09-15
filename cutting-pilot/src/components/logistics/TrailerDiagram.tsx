// src/components/logistics/TrailerDiagram.tsx
// lb-ui-01: top-down trailer diagram (Decision, locked — not the legacy side elevation). Rear at
// the left (posFromFront = 0), nose at the right. Trailer length runs horizontally; trailer width
// runs vertically. Stack height is not drawn as geometry — see ColumnDetailPanel for that.
//
// The engine's defining behaviour is width pairing (columns of different footprints sharing a row
// across the trailer's width) — a side elevation can't show that, so this reads top-down instead.
//
// Geometry: each PackRow is a vertical slice, on-screen WIDTH proportional to rowLength/dims.length.
// Within a slice, each PackColumn is a block stacked by posY, on-screen HEIGHT proportional to
// colWidth/dims.width. A column shallower than its row (colLength < rowLength) is rendered at a
// fraction of the slice's width (colLength/rowLength) flush to the slice's near edge — the
// remainder is that lane's wastedFloorArea, left showing the slice's own striped "unused floor"
// backdrop rather than being covered by the column block.
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
}: TrailerDiagramProps) {
  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-text">Trailer {trailerIndex + 1}</h3>
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-xs font-mono tabular-nums text-muted">
            {Math.round(trailer.usedLength)}&quot; of {Math.round(dims.length)}&quot; used · {trailer.rows.length} row{trailer.rows.length === 1 ? "" : "s"}
          </span>
          {headerAction}
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-text-hint mb-1">
        <span>Rear (doors)</span>
        <span>Nose</span>
      </div>

      <div
        className="flex w-full rounded-md overflow-hidden border border-[var(--line)]"
        style={{ height: DIAGRAM_HEIGHT_PX }}
      >
        {trailer.rows.map((row, rowIndex) => {
          const rowWidthPct = dims.length > 0 ? (row.rowLength / dims.length) * 100 : 0;
          const feedback = editable ? rowDropFeedback?.(rowIndex) ?? null : null;
          const guarded = editable ? rowGuardTint?.(rowIndex) ?? false : false;
          return (
            <div
              key={rowIndex}
              className="relative shrink-0 border-r border-[var(--line)] last:border-r-0"
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
          Mixed (base + top-off)
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
    </div>
  );
}
