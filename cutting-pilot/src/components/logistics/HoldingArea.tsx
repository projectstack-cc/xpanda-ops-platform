// src/components/logistics/HoldingArea.tsx
// lb-ui-02 Part C: the holding area — columns pulled off a trailer, listed with base SKU,
// thickness, and piece count, each with a Place action. Also a native HTML5 drop target (dragging
// a trailer column here pulls it to holding) and a drag source (dragging a held column onto a row
// places it back), with "Place" as the full keyboard equivalent for both directions.
"use client";

import { PackageOpen, Layers } from "lucide-react";
import type { PackColumn } from "@/lib/packEngine";

interface HoldingAreaProps {
  holding: PackColumn[];
  editable?: boolean;
  armedHoldingIndex?: number | null;
  onRequestPlace?: (holdingIndex: number) => void;
  onColumnDragStart?: (holdingIndex: number) => void;
  onColumnDragEnd?: () => void;
  isDropTarget?: boolean;
  onDragOverHolding?: () => void;
  onDropOnHolding?: () => void;
}

export default function HoldingArea({
  holding,
  editable = false,
  armedHoldingIndex = null,
  onRequestPlace,
  onColumnDragStart,
  onColumnDragEnd,
  isDropTarget = false,
  onDragOverHolding,
  onDropOnHolding,
}: HoldingAreaProps) {
  return (
    <div
      className="rounded-xl border p-4 transition-colors"
      style={{
        borderColor: isDropTarget ? "var(--brand)" : "var(--card-border)",
        background: isDropTarget ? "color-mix(in srgb, var(--brand) 6%, var(--surface))" : "var(--surface)",
      }}
      onDragOver={
        editable
          ? (e) => {
              e.preventDefault();
              onDragOverHolding?.();
            }
          : undefined
      }
      onDrop={
        editable
          ? (e) => {
              e.preventDefault();
              onDropOnHolding?.();
            }
          : undefined
      }
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-text flex items-center gap-1.5">
          <PackageOpen className="w-4 h-4" aria-hidden="true" />
          Holding area
        </h3>
        <span className="text-xs font-mono tabular-nums text-muted">
          {holding.length} column{holding.length === 1 ? "" : "s"}
        </span>
      </div>

      {holding.length === 0 ? (
        <p className="text-sm text-muted">
          {editable ? "No columns held. Drag a column here, or select it and choose Pull to Holding, to set it aside." : "No columns held."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {holding.map((column, index) => {
            const base = column.layers[0];
            if (!base) return null;
            const isArmed = armedHoldingIndex === index;
            return (
              <li
                key={index}
                draggable={editable}
                onDragStart={editable ? () => onColumnDragStart?.(index) : undefined}
                onDragEnd={editable ? () => onColumnDragEnd?.() : undefined}
                className={[
                  "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-sm",
                  editable ? "cursor-grab active:cursor-grabbing" : "",
                  isArmed ? "ring-2 ring-[var(--brand)]" : "",
                ].join(" ")}
                style={{ borderColor: "var(--border)", background: "var(--ghost-bg)" }}
              >
                <div className="min-w-0">
                  <p className="truncate text-text font-medium">{base.skuName}</p>
                  <p className="text-[11px] text-muted font-mono tabular-nums flex items-center gap-1">
                    <Layers className="w-3 h-3" aria-hidden="true" />
                    {base.unitHeight}&quot; thick · {column.stackCount}pc
                  </p>
                </div>
                {editable && (
                  <button
                    type="button"
                    onClick={() => onRequestPlace?.(index)}
                    className={[
                      "shrink-0 min-h-[36px] px-2.5 rounded-md text-[12px] font-semibold cursor-pointer transition-colors border",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                      isArmed
                        ? "border-[var(--brand)] text-[var(--brand)] bg-transparent"
                        : "border-[var(--border)] text-muted hover:text-text hover:bg-[var(--surface-2)]",
                    ].join(" ")}
                  >
                    {isArmed ? "Choose a row…" : "Place"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
