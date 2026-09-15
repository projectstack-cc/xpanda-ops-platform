// src/components/logistics/DissolvePreview.tsx
// lb-ui-03 Part B: preview + apply surface for dissolving one trailer's headroom into others.
// proposeDissolve() (dissolve.ts) is the sole source of candidate moves — this component renders
// what it returns and lets the planner exclude whole groups, exactly the way EditorGuards renders
// what evaluateGuards() returns rather than deciding anything itself.
//
// The eligible-receiver count is surfaced up front (Decision, locked) — including "0 eligible,
// nothing to dissolve" as a real, designed empty state, not a blank panel. Reuses EditorGuards'
// persistent-banner token conventions (color-mix off --warn-bg/--danger-bg — none of the six
// var(--bg-warning) etc. tokens the original spec named exist in globals.css, confirmed by the same
// grep lb-ui-02 already ran) rather than inventing a third banner style.
"use client";

import { useMemo, useState } from "react";
import { PackageOpen, ArrowRight } from "lucide-react";
import type { EditorState } from "@/lib/loadEditor";
import { proposeDissolve, applyDissolve, dissolveGroupKey, type DissolveMove } from "@/lib/dissolve";
import Modal from "@/components/Modal";

interface DissolvePreviewProps {
  isOpen: boolean;
  state: EditorState;
  srcTi: number;
  onApply: (next: EditorState) => void;
  onClose: () => void;
}

interface MoveGroup {
  key: string;
  skuName: string;
  skuCode: string;
  unitHeight: number;
  toTi: number;
  moves: DissolveMove[];
}

function fmtInches(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export default function DissolvePreview({ isOpen, state, srcTi, onApply, onClose }: DissolvePreviewProps) {
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set());

  // Recomputed whenever the modal is (re-)opened against the current state — proposeDissolve is
  // pure and cheap (it operates on a scratch clone, never touches state.plan).
  const proposal = useMemo(() => (isOpen ? proposeDissolve(state, srcTi) : null), [isOpen, state, srcTi]);

  const groups: MoveGroup[] = useMemo(() => {
    if (!proposal) return [];
    const byKey = new Map<string, MoveGroup>();
    for (const move of proposal.moves) {
      const key = dissolveGroupKey(move);
      const existing = byKey.get(key);
      if (existing) {
        existing.moves.push(move);
      } else {
        byKey.set(key, { key, skuName: move.skuName, skuCode: move.skuCode, unitHeight: move.unitHeight, toTi: move.toTi, moves: [move] });
      }
    }
    return Array.from(byKey.values());
  }, [proposal]);

  function toggleGroup(key: string) {
    setExcludedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleApply() {
    if (!proposal) return;
    const next = applyDissolve(state, proposal, excludedKeys);
    onApply(next);
    setExcludedKeys(new Set());
  }

  function handleClose() {
    setExcludedKeys(new Set());
    onClose();
  }

  const totalMoving = proposal ? proposal.moves.filter((m) => !excludedKeys.has(dissolveGroupKey(m))).length : 0;
  const totalExcluded = proposal ? proposal.moves.length - totalMoving : 0;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Dissolve trailer ${srcTi + 1}`} size="lg">
      {!proposal || proposal.moves.length === 0 ? (
        <div className="rounded-xl border border-[var(--card-border)] bg-surface p-6 flex items-start gap-3">
          <PackageOpen className="w-5 h-5 shrink-0 mt-0.5 text-muted" aria-hidden="true" />
          <div className="text-sm text-text">
            <p className="font-semibold">0 eligible — nothing to dissolve</p>
            <p className="mt-1 text-muted">
              No piece on trailer {srcTi + 1} has an eligible receiver elsewhere in this plan — either every other
              trailer&apos;s matching columns are already full, already at the 2-SKU cap, or no other trailer shares a
              matching row length / column width. This is expected for a load the engine already topped off tightly.
            </p>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted font-mono tabular-nums">
            {proposal.eligibleReceiverCount} eligible receiver{proposal.eligibleReceiverCount === 1 ? "" : "s"} ·{" "}
            {proposal.totalSrcUnits} pieces on trailer {srcTi + 1} · {totalMoving} proposed to move
            {totalExcluded > 0 && ` (${totalExcluded} excluded)`}
          </p>

          <div className="max-h-[50vh] overflow-y-auto space-y-1.5 pt-1">
            {groups.map((g) => {
              const excluded = excludedKeys.has(g.key);
              return (
                <label
                  key={g.key}
                  className={[
                    "flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors",
                    excluded ? "border-[var(--border)] opacity-50" : "border-[var(--card-border)] bg-surface",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={!excluded}
                    onChange={() => toggleGroup(g.key)}
                    className="w-4 h-4 shrink-0 cursor-pointer accent-[var(--brand)]"
                    aria-label={`Include ${g.skuName} (${g.skuCode}) in the dissolve`}
                  />
                  <div className="flex-1 min-w-0 text-sm text-text">
                    <span className="font-medium">{g.skuName}</span>{" "}
                    <span className="text-muted font-mono">({g.skuCode})</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[13px] font-mono tabular-nums text-muted shrink-0">
                    <span>{fmtInches(g.unitHeight)}&quot;</span>
                    <span>×{g.moves.length}</span>
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Trailer {g.toTi + 1}</span>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="min-h-[40px] px-4 rounded-lg text-[13px] font-medium border border-[var(--border)] text-text cursor-pointer hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={totalMoving === 0}
              className="min-h-[40px] px-4 rounded-lg text-[13px] font-semibold border border-[var(--brand)] bg-[var(--brand)] text-white cursor-pointer hover:bg-[var(--brand-hover)] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              Apply dissolve ({totalMoving})
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
