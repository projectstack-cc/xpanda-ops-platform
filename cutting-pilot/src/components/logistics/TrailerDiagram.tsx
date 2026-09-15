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
"use client";

import type { Dimensions, PackTrailer } from "@/lib/packEngine";

interface SelectedColumn {
  rowIndex: number;
  columnIndex: number;
}

interface TrailerDiagramProps {
  trailer: PackTrailer;
  dims: Dimensions;
  trailerIndex: number;
  selectedColumn: SelectedColumn | null;
  onSelectColumn: (rowIndex: number, columnIndex: number) => void;
}

const DIAGRAM_HEIGHT_PX = 176;
// Below these fractions a column's on-screen box is too small to hold ≥11px text legibly —
// drop the label rather than shrinking the type (per spec).
const MIN_WIDTH_FRACTION_FOR_LABEL = 0.07;
const MIN_DEPTH_FRACTION_FOR_LABEL = 0.1;

export default function TrailerDiagram({ trailer, dims, trailerIndex, selectedColumn, onSelectColumn }: TrailerDiagramProps) {
  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-surface p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-text">Trailer {trailerIndex + 1}</h3>
        <span className="text-xs font-mono tabular-nums text-muted">
          {Math.round(trailer.usedLength)}&quot; of {Math.round(dims.length)}&quot; used · {trailer.rows.length} row{trailer.rows.length === 1 ? "" : "s"}
        </span>
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
            >
              {row.columns.map((column, columnIndex) => {
                const heightPct = dims.width > 0 ? (column.colWidth / dims.width) * 100 : 0;
                const topPct = dims.width > 0 ? (column.posY / dims.width) * 100 : 0;
                const widthPct = row.rowLength > 0 ? (column.colLength / row.rowLength) * 100 : 100;
                const isSelected = selectedColumn?.rowIndex === rowIndex && selectedColumn?.columnIndex === columnIndex;
                const showLabel = column.colWidth / dims.width >= MIN_WIDTH_FRACTION_FOR_LABEL && column.colLength / row.rowLength >= MIN_DEPTH_FRACTION_FOR_LABEL;
                const baseLayer = column.layers[0];

                return (
                  <button
                    key={columnIndex}
                    type="button"
                    onClick={() => onSelectColumn(rowIndex, columnIndex)}
                    aria-pressed={isSelected}
                    aria-label={`Trailer ${trailerIndex + 1}, row ${rowIndex + 1}, column ${columnIndex + 1}${column.mixed ? " (mixed)" : ""}: ${column.rationale}`}
                    className={[
                      "absolute left-0 flex items-center justify-center overflow-hidden cursor-pointer",
                      "border box-border text-left px-1 transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:z-10",
                      column.mixed
                        ? "bg-[var(--info-bg)] border-[var(--info-border)] text-[var(--info-text)] hover:brightness-95"
                        : "bg-[var(--card-bg)] border-[var(--border)] text-text hover:bg-[var(--ghost-bg)]",
                      isSelected ? "ring-2 ring-[var(--brand)] z-10" : "",
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
