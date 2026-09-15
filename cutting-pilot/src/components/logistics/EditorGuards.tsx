// src/components/logistics/EditorGuards.tsx
// lb-ui-02 Part B: persistent guard banners for the customize editor. Never a fire-and-fade toast —
// legacy's toast-at-apply-time left the planner to work out which column was at fault; a persistent
// condition gets persistent UI, and stays up for as long as the condition holds.
//
// validatePlan() (via loadEditor.ts's evaluateGuards/validateForApply) is the only source of truth
// here — this component renders what it returns, it does not decide what's wrong.
//
// Token note: the prompt's spec named var(--bg-danger)/--border-danger/--text-danger and
// var(--bg-warning)/--border-warning/--text-warning — none of the six exist in globals.css (grep
// confirmed zero matches; see loadEditor.ts's header and TrailerDiagram.tsx's own prior token
// note). The advisory banner uses the real, existing --warn-bg/--warn-border/--warn-text trio
// (already theme-aware, already used for plan.warnings in LoadPlanView). Blocking/bug banners have
// no matching pre-built tint token (--danger-bg is a solid accent color, not a light background),
// so — following the color-mix(...) pattern already established in PlatformHeader.tsx/NoteRow.tsx
// for deriving a tint from a token rather than inventing a new CSS variable (globals.css isn't in
// this prompt's scope fence anyway) — the tint is `color-mix(in srgb, var(--danger-bg) N%,
// transparent)` with --danger-bg itself as the border and ordinary --text for body copy.
"use client";

import { AlertTriangle, AlertOctagon, PackageOpen } from "lucide-react";
import type { EditorGuardState, RowOverflow } from "@/lib/loadEditor";

export interface HoldingSummaryLine {
  skuName: string;
  skuCode: string;
  pieceCount: number;
}

interface EditorGuardsProps {
  guards: EditorGuardState;
  holdingSummary: HoldingSummaryLine[];
}

function overflowLabel(o: RowOverflow): string {
  return `Trailer ${o.trailerIndex + 1}, row ${o.rowIndex + 1} — the load runs ${Math.round(o.overflowBy * 100) / 100}" past the trailer's nose there`;
}

export default function EditorGuards({ guards, holdingSummary }: EditorGuardsProps) {
  const hasRowWidth = guards.blocking.some((v) => v.rule === "row-width");
  const hasTrailerLength = guards.blocking.some((v) => v.rule === "trailer-length");
  const hasNothingToShow =
    !hasRowWidth && !hasTrailerLength && guards.bug.length === 0 && guards.otherViolations.length === 0 && guards.holdingCount === 0;

  if (hasNothingToShow) return null;

  return (
    <div className="space-y-2" role="status" aria-live="polite">
      {hasRowWidth && (
        <div
          className="rounded-lg border px-3 py-2 flex items-start gap-2"
          style={{ background: "color-mix(in srgb, var(--danger-bg) 10%, transparent)", borderColor: "var(--danger-bg)" }}
        >
          <AlertOctagon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--danger-bg)" }} aria-hidden="true" />
          <div className="text-sm text-text">
            <p className="font-semibold" style={{ color: "var(--danger-bg)" }}>
              Row too wide to apply
            </p>
            <ul className="mt-1 space-y-0.5">
              {guards.blocking
                .filter((v) => v.rule === "row-width")
                .map((v, i) => (
                  <li key={i} className="font-mono text-[13px] tabular-nums">
                    Trailer {(v.trailerIndex ?? 0) + 1}, row {(v.rowIndex ?? 0) + 1} — {v.detail}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}

      {hasTrailerLength && (
        <div
          className="rounded-lg border px-3 py-2 flex items-start gap-2"
          style={{ background: "color-mix(in srgb, var(--danger-bg) 10%, transparent)", borderColor: "var(--danger-bg)" }}
        >
          <AlertOctagon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--danger-bg)" }} aria-hidden="true" />
          <div className="text-sm text-text">
            <p className="font-semibold" style={{ color: "var(--danger-bg)" }}>
              Trailer runs out of room to apply
            </p>
            <ul className="mt-1 space-y-0.5">
              {guards.overflowingRows.length > 0 ? (
                guards.overflowingRows.map((o, i) => (
                  <li key={i} className="font-mono text-[13px] tabular-nums">
                    {overflowLabel(o)}
                  </li>
                ))
              ) : (
                <li className="font-mono text-[13px]">A deeper column pushed a downstream row past the trailer&apos;s length.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {guards.bug.length > 0 && (
        <div
          className="rounded-lg border px-3 py-2 flex items-start gap-2"
          style={{ background: "color-mix(in srgb, var(--danger-bg) 18%, transparent)", borderColor: "var(--danger-bg)" }}
        >
          <AlertOctagon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--danger-bg)" }} aria-hidden="true" />
          <div className="text-sm text-text">
            <p className="font-semibold" style={{ color: "var(--danger-bg)" }}>
              Bug: a column&apos;s height changed from a move that should never change it
            </p>
            <p className="mt-1 text-[13px]">This should be unreachable through normal editing. Please report it before applying.</p>
            <ul className="mt-1 space-y-0.5 font-mono text-[13px]">
              {guards.bug.map((v, i) => (
                <li key={i}>
                  Trailer {(v.trailerIndex ?? 0) + 1}, row {(v.rowIndex ?? 0) + 1}, column {(v.columnIndex ?? 0) + 1} — {v.detail}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {guards.otherViolations.length > 0 && (
        <div
          className="rounded-lg border px-3 py-2 flex items-start gap-2"
          style={{ background: "color-mix(in srgb, var(--danger-bg) 10%, transparent)", borderColor: "var(--danger-bg)" }}
        >
          <AlertOctagon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--danger-bg)" }} aria-hidden="true" />
          <div className="text-sm text-text">
            <p className="font-semibold" style={{ color: "var(--danger-bg)" }}>
              Plan failed validation
            </p>
            <ul className="mt-1 space-y-0.5 font-mono text-[13px]">
              {guards.otherViolations.map((v, i) => (
                <li key={i}>
                  {v.rule}: {v.detail}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {guards.holdingCount > 0 && (
        <div className="rounded-lg border px-3 py-2 flex items-start gap-2 bg-[var(--warn-bg)] border-[var(--warn-border)]">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[var(--warn-text)]" aria-hidden="true" />
          <div className="text-sm text-[var(--warn-text)]">
            <p className="font-semibold flex items-center gap-1.5">
              <PackageOpen className="w-3.5 h-3.5" aria-hidden="true" />
              {guards.holdingCount} column{guards.holdingCount === 1 ? "" : "s"} will be dropped from the load if you apply now
            </p>
            <ul className="mt-1 space-y-0.5 font-mono text-[13px]">
              {holdingSummary.map((h, i) => (
                <li key={i}>
                  {h.skuName} ({h.skuCode}) — {h.pieceCount}pc
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
