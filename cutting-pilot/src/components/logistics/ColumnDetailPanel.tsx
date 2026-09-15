// src/components/logistics/ColumnDetailPanel.tsx
// lb-ui-01: the selected column's detail — row/column index, footprint, effective height, and the
// rationale string in monospace (the trust feature; it gets a panel, not a tooltip). Below it, a
// layer table naming the base SKU and each top-off SKU with its gain-per-piece against K.
"use client";

import { Check, X } from "lucide-react";
import type { PackColumn, Dimensions, PackOptions } from "@/lib/packEngine";

export interface SelectedColumnDetail {
  trailerIndex: number;
  rowIndex: number;
  columnIndex: number;
  column: PackColumn;
}

interface ColumnDetailPanelProps {
  selected: SelectedColumnDetail | null;
  dims: Dimensions;
  options: PackOptions;
}

export default function ColumnDetailPanel({ selected, dims, options }: ColumnDetailPanelProps) {
  if (!selected) {
    return (
      <div className="rounded-xl border border-[var(--card-border)] bg-surface p-4">
        <p className="text-sm text-muted">Select a column in the diagram to see its rationale.</p>
      </div>
    );
  }

  const { trailerIndex, rowIndex, columnIndex, column } = selected;
  const runnerHeight = options.runnerHeight ?? 0;
  const effectiveHeight = dims.height - runnerHeight;
  const [baseLayer, ...topoffLayers] = column.layers;

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-surface p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-text">
          Trailer {trailerIndex + 1} · Row {rowIndex + 1} · Column {columnIndex + 1}
        </h3>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted font-mono tabular-nums">
          <span>Footprint {column.colLength}&quot; × {column.colWidth}&quot;</span>
          <span>
            Effective height {effectiveHeight}&quot;
            {runnerHeight > 0 && <> ({dims.height}&quot; trailer − {runnerHeight}&quot; runner)</>}
          </span>
          <span>Stack {column.totalHeight}&quot; · {column.totalWeight}lb</span>
        </div>
      </div>

      <div>
        <div className="text-[13px] text-muted mb-1">Rationale</div>
        <p className="text-sm font-mono bg-[var(--surface-2)] rounded-md px-3 py-2 text-text break-words">
          {column.rationale}
        </p>
      </div>

      <div>
        <div className="text-[13px] text-muted mb-1">Layers</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-xs font-semibold text-muted">
                <th className="py-1.5 pr-3">Role</th>
                <th className="py-1.5 pr-3">SKU</th>
                <th className="py-1.5 pr-3 text-right">Thickness</th>
                <th className="py-1.5 pr-3 text-right">Count</th>
                <th className="py-1.5 text-right">Vs. K ({options.topOffMinInchesPerPiece}&quot;)</th>
              </tr>
            </thead>
            <tbody>
              {baseLayer && (
                <tr className="border-b border-[var(--line)] last:border-b-0">
                  <td className="py-1.5 pr-3 text-muted">Base</td>
                  <td className="py-1.5 pr-3 text-text">{baseLayer.skuName}</td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-text">{baseLayer.unitHeight}&quot;</td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-text">{baseLayer.count}</td>
                  <td className="py-1.5 text-right text-text-hint">—</td>
                </tr>
              )}
              {topoffLayers.map((layer, i) => {
                const passesK = layer.unitHeight >= options.topOffMinInchesPerPiece;
                return (
                  <tr key={i} className="border-b border-[var(--line)] last:border-b-0">
                    <td className="py-1.5 pr-3 text-muted">Top-off</td>
                    <td className="py-1.5 pr-3 text-text">{layer.skuName}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-text">{layer.unitHeight}&quot;</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-text">{layer.count}</td>
                    <td className="py-1.5 text-right">
                      <span
                        className={[
                          "inline-flex items-center gap-1 text-xs font-medium",
                          passesK ? "text-[var(--success-bg)]" : "text-[var(--danger-bg)]",
                        ].join(" ")}
                      >
                        {passesK ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
                        {passesK ? "Meets K" : "Below K"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
