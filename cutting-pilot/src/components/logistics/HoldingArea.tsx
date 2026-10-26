// src/components/logistics/HoldingArea.tsx
// lb-ui-02 Part C: the holding area — columns pulled off a trailer, listed with base SKU,
// thickness, and piece count.
//
// lbr-07: drag-and-drop removed. Each held stack is one ≥ 44px button: tap it to select it
// (Customize's Step 1 — the action bar then offers Place / Stack onto / Take off the top). While a
// placement action is armed (Step 2), `holdingTarget` turns the tray itself into a target ("Put it
// in holding", for pieces taken off a trailer stack), and `itemVerdict` fades held stacks that
// can't take the pieces, with the same green/amber/faded language as the trailer diagram.
//
// lb-edge-01: a held on-edge stack reads "6″ on edge ×4" with the hatched on-edge swatch (its layer
// unitHeight is the 24″ tier, not a size). Its actions (Place in a wall slot, Lay flat, Change count)
// live in Customize's action bar, like every held stack's.
"use client";

import { PackageOpen, Layers } from "lucide-react";
import type { PackColumn } from "@/lib/packEngine";
import { thicknessColor, thicknessLabel } from "@/lib/thicknessPalette";
import type { TapVerdict } from "./TrailerDiagram";

interface HoldingAreaProps {
  holding: PackColumn[];
  editable?: boolean;
  selectedIndex?: number | null;
  onSelect?: (holdingIndex: number) => void;
  /** Step 2: per-held-stack verdict (null = not a target). */
  itemVerdict?: (holdingIndex: number) => TapVerdict | null;
  /** Step 2: the tray as a target; null hides it. */
  holdingTarget?: TapVerdict | null;
  onChooseHolding?: () => void;
}

function stackLabel(column: PackColumn): string {
  if (column.onEdge) return column.layers.map((l) => `${thicknessLabel(column.colWidth)} on edge ×${l.count}`).join(" + ");
  return column.layers.map((l) => `${l.unitHeight}″×${l.count}`).join(" + ");
}

export default function HoldingArea({
  holding,
  editable = false,
  selectedIndex = null,
  onSelect,
  itemVerdict,
  holdingTarget = null,
  onChooseHolding,
}: HoldingAreaProps) {
  const targetOk = holdingTarget && holdingTarget.level !== "no";
  return (
    <div
      className="rounded-xl border p-4 transition-colors"
      style={{
        borderColor: holdingTarget ? (targetOk ? "var(--success-bg)" : "var(--card-border)") : "var(--card-border)",
        borderWidth: holdingTarget ? 2 : 1,
        background: "var(--surface)",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-text flex items-center gap-1.5">
          <PackageOpen className="w-4 h-4" aria-hidden="true" />
          Holding area
        </h3>
        <span className="text-xs font-mono tabular-nums text-muted">
          {holding.length} stack{holding.length === 1 ? "" : "s"}
        </span>
      </div>

      {editable && holdingTarget && (
        <button
          type="button"
          onClick={onChooseHolding}
          aria-label={`Holding area. ${holdingTarget.level === "no" ? "Can't go here" : "Can go here"} — ${holdingTarget.reason}.`}
          className="w-full mb-2 min-h-[48px] rounded-lg border-2 border-dashed text-sm font-semibold text-text bg-surface cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          style={{ borderColor: targetOk ? "var(--success-bg)" : "var(--border)", opacity: targetOk ? 1 : 0.45 }}
        >
          Put it in holding
        </button>
      )}

      {holding.length === 0 ? (
        <p className="text-sm text-muted">
          {editable ? "No stacks held. Tap a stack, then choose Send to holding to set it aside." : "No columns held."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {holding.map((column, index) => {
            const base = column.layers[0];
            if (!base) return null;
            const isSelected = selectedIndex === index;
            const verdict = editable && !isSelected ? itemVerdict?.(index) ?? null : null;
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-text font-medium">{base.skuName}</span>
                  <span className="text-[12px] text-muted font-mono tabular-nums flex items-center gap-1">
                    {column.onEdge ? (
                      <span className="relative inline-block w-3 h-3 rounded-sm border border-[var(--line)] overflow-hidden" style={{ background: thicknessColor(column.colWidth).bg }} aria-hidden="true">
                        <span className="absolute inset-0" style={{ backgroundImage: "repeating-linear-gradient(135deg, var(--text) 0 1.5px, transparent 1.5px 4px)", opacity: 0.4 }} />
                      </span>
                    ) : (
                      <Layers className="w-3 h-3" aria-hidden="true" />
                    )}
                    {stackLabel(column)} · {column.stackCount}pc
                  </span>
                </span>
                {editable && (
                  <span className="shrink-0 text-[12px] font-semibold text-muted">{isSelected ? "Selected" : "Tap to pick"}</span>
                )}
              </>
            );
            return (
              <li key={index}>
                {editable ? (
                  <button
                    type="button"
                    onClick={() => onSelect?.(index)}
                    aria-pressed={isSelected}
                    aria-label={`Held stack: ${base.skuName}, ${stackLabel(column)}.${verdict ? (verdict.level === "no" ? ` Can't go here — ${verdict.reason}.` : ` Can go here — ${verdict.reason}.`) : ""}`}
                    className="w-full min-h-[48px] flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-sm text-left cursor-pointer transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--ghost-bg)",
                      ...(isSelected ? { outline: "3px solid var(--text)", outlineOffset: -3, boxShadow: "inset 0 0 0 7px var(--warn-border)" } : {}),
                      ...(verdict?.level === "no" ? { opacity: 0.35 } : {}),
                    }}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-sm" style={{ borderColor: "var(--border)", background: "var(--ghost-bg)" }}>
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
