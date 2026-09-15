// src/app/logistics/load-builder/CustomizeEditor.tsx
// lb-ui-02 Part C: the customize editor. Owns its own EditorState and selection/drag state,
// entirely separate from LoadPlanView's read-only `fixtureId`/`selected` — per the prompt's
// integration-point instruction, edit mode does not touch state read-only mode owns.
//
// The move unit is a whole column (Decision, locked). Every mutation goes through loadEditor.ts's
// pure operations; this component only wires interaction (native HTML5 DnD + a full keyboard
// equivalent: select a column, choose target, confirm) and renders what evaluateGuards()/
// validateForApply() returns. No API routes, no D1, no persistence — Apply hands the finished
// PackPlan back to LoadPlanView, which holds it in memory; saved loads are lb-ui-04.
"use client";

import { useEffect, useMemo, useState } from "react";
import { Undo2, Rows3, XCircle, Check, PackageMinus } from "lucide-react";
import type { CartLine, Dimensions, PackOptions, PackPlan, PackSku } from "@/lib/packEngine";
import {
  createEditorState,
  moveColumn,
  pullToHolding,
  placeFromHolding,
  compactLoad,
  undo,
  canDrop,
  evaluateGuards,
  planForApply,
  type EditorState,
  type ColumnRef,
} from "@/lib/loadEditor";
import TrailerDiagram, { type RowDropFeedback } from "@/components/logistics/TrailerDiagram";
import HoldingArea from "@/components/logistics/HoldingArea";
import EditorGuards, { type HoldingSummaryLine } from "@/components/logistics/EditorGuards";
import ColumnDetailPanel, { type SelectedColumnDetail } from "@/components/logistics/ColumnDetailPanel";
import Modal from "@/components/Modal";

interface CustomizeEditorProps {
  plan: PackPlan;
  dims: Dimensions;
  options: PackOptions;
  cart: CartLine[];
  skus: PackSku[];
  onApply: (appliedPlan: PackPlan) => void;
  onDiscard: () => void;
}

type DragSource = { kind: "trailer"; ref: ColumnRef } | { kind: "holding"; index: number };
type TargetPicker = DragSource;

export default function CustomizeEditor({ plan, dims, options, cart, skus, onApply, onDiscard }: CustomizeEditorProps) {
  const [state, setState] = useState<EditorState>(() => createEditorState(plan, dims, options, cart, skus));
  const [selectedColumn, setSelectedColumn] = useState<ColumnRef | null>(null);
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [hoverRow, setHoverRow] = useState<{ t: number; r: number } | null>(null);
  const [holdingDropActive, setHoldingDropActive] = useState(false);
  const [targetPicker, setTargetPicker] = useState<TargetPicker | null>(null);
  const [compactMessage, setCompactMessage] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showBlockedHint, setShowBlockedHint] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setTargetPicker(null);
        setSelectedColumn(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const guards = useMemo(() => evaluateGuards(state), [state]);
  const overflowRowKeys = useMemo(() => new Set(guards.overflowingRows.map((o) => `${o.trailerIndex}:${o.rowIndex}`)), [guards]);

  const holdingSummary: HoldingSummaryLine[] = useMemo(
    () =>
      state.holding.map((column) => {
        const base = column.layers[0];
        return { skuName: base?.skuName ?? "?", skuCode: base?.skuCode ?? "?", pieceCount: column.stackCount };
      }),
    [state.holding]
  );

  const selectedDetail: SelectedColumnDetail | null = useMemo(() => {
    if (!selectedColumn) return null;
    const column = state.plan.trailers[selectedColumn.t]?.rows[selectedColumn.r]?.columns[selectedColumn.c];
    if (!column) return null;
    return { trailerIndex: selectedColumn.t, rowIndex: selectedColumn.r, columnIndex: selectedColumn.c, column };
  }, [selectedColumn, state.plan]);

  function draggedColumn() {
    if (!dragSource) return null;
    if (dragSource.kind === "trailer") {
      return state.plan.trailers[dragSource.ref.t]?.rows[dragSource.ref.r]?.columns[dragSource.ref.c] ?? null;
    }
    return state.holding[dragSource.index] ?? null;
  }

  function commit(next: EditorState) {
    setState(next);
    setCompactMessage(null);
    setShowBlockedHint(false);
  }

  function handleSelectColumn(t: number, r: number, c: number) {
    setTargetPicker(null);
    setSelectedColumn({ t, r, c });
  }

  function handleColumnDragStart(t: number, r: number, c: number) {
    setDragSource({ kind: "trailer", ref: { t, r, c } });
  }
  function handleHoldingDragStart(index: number) {
    setDragSource({ kind: "holding", index });
  }
  function handleDragEnd() {
    setDragSource(null);
    setHoverRow(null);
    setHoldingDropActive(false);
  }

  function handleRowDragOver(t: number, r: number) {
    setHoverRow({ t, r });
  }

  function handleRowDrop(t: number, r: number) {
    if (!dragSource) return;
    const slot = state.plan.trailers[t]?.rows[r]?.columns.length ?? 0;
    if (dragSource.kind === "trailer") {
      commit(moveColumn(state, dragSource.ref, { t, r, slot }));
    } else {
      commit(placeFromHolding(state, dragSource.index, { t, r, slot }));
    }
    handleDragEnd();
  }

  function handleDropOnHolding() {
    if (dragSource?.kind === "trailer") {
      commit(pullToHolding(state, dragSource.ref));
    }
    handleDragEnd();
  }

  function rowDropFeedbackFor(t: number) {
    return (rowIndex: number): RowDropFeedback | null => {
      if (hoverRow?.t !== t || hoverRow.r !== rowIndex) return null;
      const column = draggedColumn();
      if (!column) return null;
      const feedback = canDrop(state, column, { t, r: rowIndex });
      return { ok: feedback.ok, reason: feedback.reason };
    };
  }

  function rowGuardTintFor(t: number) {
    return (rowIndex: number): boolean => {
      const widthHit = guards.blocking.some((v) => v.rule === "row-width" && v.trailerIndex === t && v.rowIndex === rowIndex);
      const lengthHit = overflowRowKeys.has(`${t}:${rowIndex}`);
      return widthHit || lengthHit;
    };
  }

  function handleMoveSelected() {
    if (selectedColumn) setTargetPicker({ kind: "trailer", ref: selectedColumn });
  }

  function handlePullSelected() {
    if (selectedColumn) {
      commit(pullToHolding(state, selectedColumn));
      setSelectedColumn(null);
    }
  }

  function handleRequestPlace(holdingIndex: number) {
    setSelectedColumn(null);
    setTargetPicker((current) => (current?.kind === "holding" && current.index === holdingIndex ? null : { kind: "holding", index: holdingIndex }));
  }

  function handleChooseTarget(t: number, r: number) {
    if (!targetPicker) return;
    const slot = state.plan.trailers[t]?.rows[r]?.columns.length ?? 0;
    if (targetPicker.kind === "trailer") {
      commit(moveColumn(state, targetPicker.ref, { t, r, slot }));
      setSelectedColumn(null);
    } else {
      commit(placeFromHolding(state, targetPicker.index, { t, r, slot }));
    }
    setTargetPicker(null);
  }

  function handleUndo() {
    commit(undo(state));
    setSelectedColumn(null);
    setTargetPicker(null);
  }

  function handleCompact() {
    const next = compactLoad(state);
    if (next === state) {
      setCompactMessage("Load already compact — nothing to shift.");
      return;
    }
    commit(next);
  }

  function handleDiscardConfirmed() {
    setShowDiscardConfirm(false);
    onDiscard();
  }

  function handleApply() {
    if (!guards.canApply) {
      setShowBlockedHint(true);
      return;
    }
    onApply(planForApply(state));
  }

  const hasEdits = state.history.length > 0 || state.holding.length > 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--card-border)] bg-surface p-3">
        <button
          type="button"
          onClick={handleUndo}
          disabled={state.history.length === 0}
          className="min-h-[36px] px-3 rounded-lg text-[13px] font-medium border border-[var(--border)] text-text flex items-center gap-1.5 cursor-pointer transition-colors hover:bg-[var(--ghost-bg)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
          Undo
        </button>

        <div className="flex flex-col">
          <button
            type="button"
            onClick={handleCompact}
            className="min-h-[36px] px-3 rounded-lg text-[13px] font-medium border border-[var(--border)] text-text flex items-center gap-1.5 cursor-pointer transition-colors hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            <Rows3 className="w-3.5 h-3.5" aria-hidden="true" />
            Compact load
          </button>
          {compactMessage && <span className="text-[11px] text-muted mt-1">{compactMessage}</span>}
        </div>

        <button
          type="button"
          onClick={() => setShowDiscardConfirm(true)}
          className="min-h-[36px] px-3 rounded-lg text-[13px] font-medium border border-[var(--border)] text-text flex items-center gap-1.5 cursor-pointer transition-colors hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
          Discard
        </button>

        <div className="ml-auto flex flex-col items-end">
          {/* Doctrine: prefer an enabled control that explains itself over a dead low-contrast
           * button — Apply stays clickable while blocked; clicking it surfaces why instead of
           * doing nothing. */}
          <button
            type="button"
            onClick={handleApply}
            className={[
              "min-h-[36px] px-4 rounded-lg text-[13px] font-semibold flex items-center gap-1.5 cursor-pointer transition-colors border",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
              guards.canApply
                ? "border-[var(--brand)] bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)]"
                : "border-[var(--border)] text-muted hover:bg-[var(--ghost-bg)]",
            ].join(" ")}
          >
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            Apply
          </button>
          {showBlockedHint && !guards.canApply && <span className="text-[11px] mt-1" style={{ color: "var(--danger-bg)" }}>Fix the issues below before applying.</span>}
        </div>
      </div>

      <EditorGuards guards={guards} holdingSummary={holdingSummary} />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
        <div className="space-y-4">
          {state.plan.trailers.length === 0 ? (
            <div className="rounded-xl border border-[var(--card-border)] bg-surface p-6 text-sm text-muted">Nothing placed on any trailer.</div>
          ) : (
            state.plan.trailers.map((trailer, t) => (
              <TrailerDiagram
                key={t}
                trailer={trailer}
                dims={state.dims}
                trailerIndex={t}
                selectedColumn={selectedColumn && selectedColumn.t === t ? { rowIndex: selectedColumn.r, columnIndex: selectedColumn.c } : null}
                onSelectColumn={(r, c) => handleSelectColumn(t, r, c)}
                editable
                draggingFrom={dragSource?.kind === "trailer" && dragSource.ref.t === t ? { rowIndex: dragSource.ref.r, columnIndex: dragSource.ref.c } : null}
                onColumnDragStart={(r, c) => handleColumnDragStart(t, r, c)}
                onColumnDragEnd={handleDragEnd}
                onRowDragOver={(r) => handleRowDragOver(t, r)}
                onRowDrop={(r) => handleRowDrop(t, r)}
                rowDropFeedback={rowDropFeedbackFor(t)}
                rowGuardTint={rowGuardTintFor(t)}
                targetPickerActive={targetPicker !== null}
                onChooseTargetRow={(r) => handleChooseTarget(t, r)}
              />
            ))
          )}
        </div>

        <div className="space-y-4">
          {selectedColumn && selectedDetail ? (
            <div className="space-y-2">
              <ColumnDetailPanel selected={selectedDetail} dims={state.dims} options={state.options} />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleMoveSelected}
                  className="flex-1 min-h-[40px] px-3 rounded-lg text-[13px] font-semibold border border-[var(--brand)] text-[var(--brand)] cursor-pointer hover:bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                >
                  Move…
                </button>
                <button
                  type="button"
                  onClick={handlePullSelected}
                  className="flex-1 min-h-[40px] px-3 rounded-lg text-[13px] font-semibold border border-[var(--border)] text-text flex items-center justify-center gap-1.5 cursor-pointer hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                >
                  <PackageMinus className="w-3.5 h-3.5" aria-hidden="true" />
                  Pull to holding
                </button>
              </div>
              {targetPicker !== null && (
                <p className="text-[12px] text-muted">
                  Choose a row in the diagram (or press Escape to cancel).
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--card-border)] bg-surface p-4">
              <p className="text-sm text-muted">Select a column to move it or pull it to holding.</p>
            </div>
          )}

          <HoldingArea
            holding={state.holding}
            editable
            armedHoldingIndex={targetPicker?.kind === "holding" ? targetPicker.index : null}
            onRequestPlace={handleRequestPlace}
            onColumnDragStart={handleHoldingDragStart}
            onColumnDragEnd={handleDragEnd}
            isDropTarget={holdingDropActive && dragSource?.kind === "trailer"}
            onDragOverHolding={() => setHoldingDropActive(true)}
            onDropOnHolding={handleDropOnHolding}
          />
        </div>
      </div>

      <Modal isOpen={showDiscardConfirm} onClose={() => setShowDiscardConfirm(false)} title="Discard changes?">
        <p className="text-sm text-text">
          {hasEdits
            ? "This drops every edit made in this session and returns to the original plan. This cannot be undone."
            : "No edits have been made yet."}
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => setShowDiscardConfirm(false)}
            className="min-h-[40px] px-4 rounded-lg text-[13px] font-medium border border-[var(--border)] text-text cursor-pointer hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={handleDiscardConfirmed}
            className="min-h-[40px] px-4 rounded-lg text-[13px] font-semibold text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            style={{ background: "var(--danger-bg)" }}
          >
            Discard
          </button>
        </div>
      </Modal>
    </div>
  );
}
