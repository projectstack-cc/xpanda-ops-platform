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
//
// lb-ui-07: manual/custom load building. Every operation above REDISTRIBUTES pieces pack() already
// placed; addRow/addColumn/addLayer/setLayerCount/removeRow (loadEditor.ts) CREATE placement pack()
// never chose to make. Surfaced here as one "Edit trailer N" modal per trailer (TrailerEditModal
// below, opened from TrailerDiagram's existing headerAction slot next to Dissolve) rather than new
// per-row/per-column affordances inside TrailerDiagram.tsx itself — that file is outside this
// prompt's fence, so every new control lives in this file instead, matching legacy's own per-trailer
// editor box (load-builder.html:2335-2580) in shape if not in chrome (a Modal, this codebase's one
// reusable primitive, rather than an inline box). A new "Unassigned pieces" panel reuses
// planForApply()'s existing balance+holding merge directly — no fourth bucket invented.
//
// lb-ui-08: a "Print / Export" action (LoadingDiagramPrintButton) added alongside Edit…/Dissolve…
// in the same headerAction slot — builds a standalone loading-diagram PDF per trailer via
// loadingDiagramPdf.ts and opens it in a new tab. No new state here beyond the props the button
// itself needs (state.options.runnerHeight, state.plan.warnings); see loadingDiagramPdf.ts for the
// PDF builder and its own Step 0 notes.
"use client";

import { useEffect, useMemo, useState } from "react";
import { Undo2, Rows3, XCircle, Check, PackageMinus, Shuffle, Plus, Trash2, PackageX } from "lucide-react";
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
  addRow,
  addColumn,
  addLayer,
  setLayerCount,
  removeRow,
  addRowFromLibrary,
  addColumnFromLibrary,
  addLayerFromLibrary,
  type EditorState,
  type ColumnRef,
} from "@/lib/loadEditor";
import { fetchLoadBuilderSkus } from "@/lib/jobPull";
import TrailerDiagram, { type RowDropFeedback } from "@/components/logistics/TrailerDiagram";
import HoldingArea from "@/components/logistics/HoldingArea";
import EditorGuards, { type HoldingSummaryLine } from "@/components/logistics/EditorGuards";
import ColumnDetailPanel, { type SelectedColumnDetail } from "@/components/logistics/ColumnDetailPanel";
import DissolvePreview from "@/components/logistics/DissolvePreview";
import LoadingDiagramPrintButton from "@/components/logistics/LoadingDiagramPrintButton";
import Modal from "@/components/Modal";

interface CustomizeEditorProps {
  plan: PackPlan;
  dims: Dimensions;
  options: PackOptions;
  cart: CartLine[];
  skus: PackSku[];
  // lb-ui-11: cart/skus report the FINAL, post-edit state.cart/state.skus alongside the plan — not
  // just the plan. A parts-library add grows state.cart and appends to state.skus (see loadEditor.ts's
  // introduceSku/cartAfterPlacement); the caller must carry those forward into whatever it re-mounts
  // this editor with next (or persists), or a reopened/reloaded session's originalSkuIds would be
  // rebuilt without the library SKU and immediately misclassify further edits to it, surfacing a
  // conservation violation for pieces that are legitimately already placed on the plan being handed
  // back right now.
  onApply: (appliedPlan: PackPlan, cart: CartLine[], skus: PackSku[]) => void;
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
  const [dissolveTi, setDissolveTi] = useState<number | null>(null);
  const [editTi, setEditTi] = useState<number | null>(null);

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

  // lb-ui-07: "unassigned" = plan.balance merged with holding, by SKU — the exact same computation
  // planForApply already does to feed validateForApply's conservation check (not a fourth bucket:
  // pieces from the original cart/job-pull that would NOT ship if Apply ran right now, whether
  // because pack() never placed them or a planner pulled them into holding).
  const unassignedBalance = useMemo(() => planForApply(state).balance, [state]);
  const unassignedTotal = useMemo(() => unassignedBalance.reduce((s, b) => s + b.remaining, 0), [unassignedBalance]);
  const skuNameById = useMemo(() => new Map(state.skus.map((s) => [s.id, s.name])), [state.skus]);

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
      // lb-ui-03 Part C: only a trailer-sourced drag has a source row that can shrink and offset
      // the target's growth — a holding→trailer placement has no `from` to simulate against (see
      // canDrop's own doc comment).
      const from = dragSource?.kind === "trailer" ? dragSource.ref : undefined;
      const feedback = canDrop(state, column, { t, r: rowIndex }, from);
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

  function handleApplyDissolve(next: EditorState) {
    commit(next);
    setDissolveTi(null);
  }

  function handleAddRow(skuId: string, count: number) {
    if (editTi === null) return;
    commit(addRow(state, editTi, skuId, count));
  }

  function handleAddColumn(rowIndex: number, skuId: string, count: number) {
    if (editTi === null) return;
    commit(addColumn(state, editTi, rowIndex, skuId, count));
  }

  function handleAddLayer(rowIndex: number, columnIndex: number, skuId: string, count: number) {
    if (editTi === null) return;
    commit(addLayer(state, { t: editTi, r: rowIndex, c: columnIndex }, skuId, count));
  }

  // lb-ui-11: parts-library variants — `sku` isn't necessarily in state.skus yet (it's picked from
  // the full /api/load-builder-skus catalog, not this job's own SKU set). addRowFromLibrary etc.
  // introduce it and grow state.cart to cover the new demand in one combined, single-undo-step
  // operation (see loadEditor.ts's own doc comment on why introduceSku isn't composed inline here).
  function handleAddRowFromLibrary(sku: PackSku, count: number) {
    if (editTi === null) return;
    commit(addRowFromLibrary(state, editTi, sku, count));
  }

  function handleAddColumnFromLibrary(rowIndex: number, sku: PackSku, count: number) {
    if (editTi === null) return;
    commit(addColumnFromLibrary(state, editTi, rowIndex, sku, count));
  }

  function handleAddLayerFromLibrary(rowIndex: number, columnIndex: number, sku: PackSku, count: number) {
    if (editTi === null) return;
    commit(addLayerFromLibrary(state, { t: editTi, r: rowIndex, c: columnIndex }, sku, count));
  }

  function handleSetLayerCount(rowIndex: number, columnIndex: number, layerIndex: number, count: number) {
    if (editTi === null) return;
    commit(setLayerCount(state, { t: editTi, r: rowIndex, c: columnIndex }, layerIndex, count));
  }

  function handleRemoveRow(rowIndex: number) {
    if (editTi === null) return;
    commit(removeRow(state, editTi, rowIndex));
  }

  function handleApply() {
    if (!guards.canApply) {
      setShowBlockedHint(true);
      return;
    }
    onApply(planForApply(state), state.cart, state.skus);
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
                dims={trailer.dims}
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
                headerAction={
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditTi(t)}
                      className="min-h-[28px] px-2.5 rounded-md text-[12px] font-medium border border-[var(--border)] text-text flex items-center gap-1 cursor-pointer transition-colors hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                    >
                      <Plus className="w-3 h-3" aria-hidden="true" />
                      Edit…
                    </button>
                    <button
                      type="button"
                      onClick={() => setDissolveTi(t)}
                      className="min-h-[28px] px-2.5 rounded-md text-[12px] font-medium border border-[var(--border)] text-text flex items-center gap-1 cursor-pointer transition-colors hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                    >
                      <Shuffle className="w-3 h-3" aria-hidden="true" />
                      Dissolve…
                    </button>
                    <LoadingDiagramPrintButton
                      trailer={trailer}
                      trailerIndex={t}
                      dims={trailer.dims}
                      skus={state.skus}
                      runnerHeight={state.options.runnerHeight}
                      warnings={state.plan.warnings}
                    />
                  </div>
                }
              />
            ))
          )}
        </div>

        <div className="space-y-4">
          {selectedColumn && selectedDetail ? (
            <div className="space-y-2">
              <ColumnDetailPanel selected={selectedDetail} dims={state.plan.trailers[selectedColumn.t]?.dims ?? state.dims} options={state.options} />
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

          {unassignedBalance.length > 0 && (
            <div className="rounded-lg border px-3 py-2 flex items-start gap-2 bg-[var(--warn-bg)] border-[var(--warn-border)]">
              <PackageX className="w-4 h-4 shrink-0 mt-0.5 text-[var(--warn-text)]" aria-hidden="true" />
              <div className="text-sm text-[var(--warn-text)] min-w-0">
                <p className="font-semibold">
                  {unassignedTotal} unassigned piece{unassignedTotal === 1 ? "" : "s"} — won&apos;t ship if you apply now
                </p>
                <ul className="mt-1 space-y-0.5 font-mono text-[13px] tabular-nums">
                  {unassignedBalance.map((b) => (
                    <li key={b.skuId}>
                      {b.remaining} × {skuNameById.get(b.skuId) ?? b.skuId}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {editTi !== null && (
        <TrailerEditModal
          trailerIndex={editTi}
          trailer={state.plan.trailers[editTi]}
          skus={state.skus}
          onAddRow={handleAddRow}
          onAddColumn={handleAddColumn}
          onAddLayer={handleAddLayer}
          onAddRowFromLibrary={handleAddRowFromLibrary}
          onAddColumnFromLibrary={handleAddColumnFromLibrary}
          onAddLayerFromLibrary={handleAddLayerFromLibrary}
          onSetLayerCount={handleSetLayerCount}
          onRemoveRow={handleRemoveRow}
          onClose={() => setEditTi(null)}
        />
      )}

      {dissolveTi !== null && (
        <DissolvePreview
          isOpen={dissolveTi !== null}
          state={state}
          srcTi={dissolveTi}
          onApply={handleApplyDissolve}
          onClose={() => setDissolveTi(null)}
        />
      )}

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

// --- lb-ui-07: manual/custom load building UI, local to this file (TrailerDiagram.tsx is outside
// this prompt's scope fence, so no per-row/per-column affordance can live there — everything below
// is reached through the single "Edit…" entry point already added to headerAction above). ---

interface AddPieceFormProps {
  skus: PackSku[];
  // lb-ui-11: the parts library catalog, already filtered by the caller (TrailerEditModal) to
  // exclude ids already present in `skus` — a part known to this job is only ever offered once,
  // through the "This job" list, whichever way it originally got there.
  libraryParts: PackSku[];
  buttonLabel: string;
  onSubmit: (skuId: string, count: number) => void;
  onSubmitFromLibrary: (sku: PackSku, count: number) => void;
}

/** SKU + count picker, shared by every "add" sub-form below (new row, new column, new layer).
 * Stays mounted after submit (Design Decision: the planner adds several pieces in one modal
 * session, matching legacy's own editor staying open across repeat adds) rather than closing.
 *
 * lb-ui-11: a second source alongside the job's own SKUs — the full parts library (/api/load-
 * builder-skus, the same universe a job pull matches against). Picking a library part that isn't
 * yet part of this job routes through onSubmitFromLibrary, which introduces the SKU to the session
 * and grows the job's own demand to cover it (see loadEditor.ts's introduceSku/cartAfterPlacement) —
 * distinct from onSubmit, which only ever draws down already-known job demand. */
function AddPieceForm({ skus, libraryParts, buttonLabel, onSubmit, onSubmitFromLibrary }: AddPieceFormProps) {
  const hasJobSkus = skus.length > 0;
  const hasLibraryParts = libraryParts.length > 0;
  const [source, setSource] = useState<"job" | "library">(hasJobSkus ? "job" : "library");
  const [skuId, setSkuId] = useState(skus[0]?.id ?? "");
  const [libraryId, setLibraryId] = useState(libraryParts[0]?.id ?? "");
  const [count, setCount] = useState("1");

  // Keep selections valid as the underlying lists change — e.g. a library part moves out of
  // libraryParts into skus the render after it's added, so a stale libraryId would point at
  // nothing.
  useEffect(() => {
    if (!skus.some((s) => s.id === skuId)) setSkuId(skus[0]?.id ?? "");
  }, [skus, skuId]);
  useEffect(() => {
    if (!libraryParts.some((s) => s.id === libraryId)) setLibraryId(libraryParts[0]?.id ?? "");
  }, [libraryParts, libraryId]);

  if (!hasJobSkus && !hasLibraryParts) {
    return <p className="text-[12px] text-muted">No SKUs available to add from.</p>;
  }

  const effectiveSource = source === "job" && !hasJobSkus ? "library" : source === "library" && !hasLibraryParts ? "job" : source;

  function submit() {
    const n = Math.max(1, Math.floor(Number(count)) || 1);
    if (effectiveSource === "job") {
      if (skuId) onSubmit(skuId, n);
    } else {
      const sku = libraryParts.find((s) => s.id === libraryId);
      if (sku) onSubmitFromLibrary(sku, n);
    }
  }

  return (
    <div className="space-y-1.5">
      {hasJobSkus && hasLibraryParts && (
        <div className="flex gap-1">
          {(["job", "library"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              className={[
                "min-h-[24px] px-2 rounded text-[11px] font-medium cursor-pointer transition-colors",
                effectiveSource === s ? "bg-[var(--brand)] text-white" : "text-muted hover:bg-[var(--ghost-bg)]",
              ].join(" ")}
            >
              {s === "job" ? "This job's SKUs" : "Parts library"}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12px] font-medium text-muted">
          SKU
          {effectiveSource === "job" ? (
            <select
              value={skuId}
              onChange={(e) => setSkuId(e.target.value)}
              className="block mt-0.5 h-9 pl-2 pr-1 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-[13px] cursor-pointer"
            >
              {skus.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <select
              value={libraryId}
              onChange={(e) => setLibraryId(e.target.value)}
              className="block mt-0.5 h-9 pl-2 pr-1 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-[13px] cursor-pointer"
            >
              {libraryParts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="text-[12px] font-medium text-muted">
          Count
          <input
            type="number"
            min={1}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="block mt-0.5 h-9 w-16 px-2 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-[13px] font-mono tabular-nums"
          />
        </label>
        <button
          type="button"
          onClick={submit}
          className="min-h-[36px] px-3 rounded-md text-[12px] font-semibold border border-[var(--brand)] text-[var(--brand)] cursor-pointer hover:bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

interface LayerCountInputProps {
  value: number;
  onCommit: (next: number) => void;
}

/** A free-typed count field (legacy's own load-builder.html:2462) that commits on blur/Enter rather
 * than on every keystroke — typing "25" should produce one undo step, not two. */
function LayerCountInput({ value, onCommit }: LayerCountInputProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  function commit() {
    const n = Math.max(0, Math.floor(Number(text)) || 0);
    if (n !== value) onCommit(n);
    else setText(String(value));
  }

  return (
    <input
      type="number"
      min={0}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="h-8 w-16 px-2 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-[13px] font-mono tabular-nums"
    />
  );
}

interface TrailerEditModalProps {
  trailerIndex: number;
  trailer: PackPlan["trailers"][number];
  skus: PackSku[];
  onAddRow: (skuId: string, count: number) => void;
  onAddColumn: (rowIndex: number, skuId: string, count: number) => void;
  onAddLayer: (rowIndex: number, columnIndex: number, skuId: string, count: number) => void;
  onAddRowFromLibrary: (sku: PackSku, count: number) => void;
  onAddColumnFromLibrary: (rowIndex: number, sku: PackSku, count: number) => void;
  onAddLayerFromLibrary: (rowIndex: number, columnIndex: number, sku: PackSku, count: number) => void;
  onSetLayerCount: (rowIndex: number, columnIndex: number, layerIndex: number, count: number) => void;
  onRemoveRow: (rowIndex: number) => void;
  onClose: () => void;
}

/** One trailer's manual editor: pick a row (existing, or "+ New row"); within an existing row, pick
 * a column (existing, or "+ New column"); within an existing column, edit/remove its layers or add
 * a new one. Covers addRow/addColumn/addLayer/setLayerCount/removeRow in a single modal, matching
 * legacy's own per-trailer editor box in shape (load-builder.html:2335-2580) — implemented as a
 * Modal since that's this codebase's one reusable primitive, not an inline box.
 * selectedRow/selectedCol reset to "new" whenever a row disappears out from under them (removeRow)
 * — everywhere else the modal deliberately stays exactly where the planner left it after a
 * mutation, so adding several pieces in a row doesn't require re-navigating the pickers each time.
 *
 * lb-ui-11: fetches the full parts library ONCE per modal open (not once per AddPieceForm — there
 * are up to three mounted at a time) and filters out anything already in `skus`, so a part already
 * reachable through the normal "This job's SKUs" list never appears twice. Fetch failure degrades
 * to an empty library list rather than blocking the modal — the job's own SKUs stay usable either
 * way, matching this file's existing no-pre-validate-let-it-surface-later posture. */
function TrailerEditModal({
  trailerIndex,
  trailer,
  skus,
  onAddRow,
  onAddColumn,
  onAddLayer,
  onAddRowFromLibrary,
  onAddColumnFromLibrary,
  onAddLayerFromLibrary,
  onSetLayerCount,
  onRemoveRow,
  onClose,
}: TrailerEditModalProps) {
  const [selectedRow, setSelectedRow] = useState<number | "new">(trailer.rows.length > 0 ? 0 : "new");
  const [selectedCol, setSelectedCol] = useState<number | "new">("new");
  const [allLibraryParts, setAllLibraryParts] = useState<PackSku[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchLoadBuilderSkus()
      .then((parts) => {
        if (!cancelled) setAllLibraryParts(parts);
      })
      .catch(() => {
        if (!cancelled) setAllLibraryParts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const knownIds = useMemo(() => new Set(skus.map((s) => s.id)), [skus]);
  const libraryParts = useMemo(() => allLibraryParts.filter((p) => !knownIds.has(p.id)), [allLibraryParts, knownIds]);

  const row = selectedRow === "new" ? null : trailer.rows[selectedRow] ?? null;
  // The row the planner was looking at may have been removed elsewhere (or by this modal's own
  // Delete row button) — fall back to "new" rather than rendering a stale/undefined row.
  useEffect(() => {
    if (selectedRow !== "new" && !trailer.rows[selectedRow]) setSelectedRow("new");
  }, [trailer, selectedRow]);

  const column = row && selectedCol !== "new" ? row.columns[selectedCol] ?? null : null;
  // Same staleness risk one level down: setLayerCount(..., 0) on a column's last layer splices the
  // whole column out of row.columns (loadEditor.selfcheck.ts #18) — without this, selectedCol could
  // silently point at a DIFFERENT column after indices shift, and the next add/setLayerCount call
  // would hit the wrong target instead of just rendering nothing.
  useEffect(() => {
    if (row && selectedCol !== "new" && !row.columns[selectedCol]) setSelectedCol("new");
  }, [row, selectedCol]);

  return (
    <Modal isOpen onClose={onClose} title={`Edit trailer ${trailerIndex + 1}`} size="lg">
      <div className="space-y-3">
        <label className="block text-xs font-semibold text-text">
          Row
          <select
            value={String(selectedRow)}
            onChange={(e) => {
              setSelectedRow(e.target.value === "new" ? "new" : Number(e.target.value));
              setSelectedCol("new");
            }}
            className="block mt-1 h-9 pl-2 pr-1 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-[13px] cursor-pointer"
          >
            {trailer.rows.map((r, i) => (
              <option key={i} value={i}>
                Row {i + 1} ({r.columns.length} column{r.columns.length === 1 ? "" : "s"})
              </option>
            ))}
            <option value="new">+ New row</option>
          </select>
        </label>

        {selectedRow === "new" ? (
          <AddPieceForm
            skus={skus}
            libraryParts={libraryParts}
            buttonLabel="Add row"
            onSubmit={(skuId, count) => onAddRow(skuId, count)}
            onSubmitFromLibrary={(sku, count) => onAddRowFromLibrary(sku, count)}
          />
        ) : row ? (
          <>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => onRemoveRow(selectedRow)}
                className="min-h-[32px] px-2.5 rounded-md text-[12px] font-medium border border-[var(--border)] text-[var(--danger-text)] flex items-center gap-1 cursor-pointer hover:bg-[color-mix(in_srgb,var(--danger-bg)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                <Trash2 className="w-3 h-3" aria-hidden="true" />
                Delete row (moves its columns to holding)
              </button>
            </div>

            <label className="block text-xs font-semibold text-text">
              Column
              <select
                value={String(selectedCol)}
                onChange={(e) => setSelectedCol(e.target.value === "new" ? "new" : Number(e.target.value))}
                className="block mt-1 h-9 pl-2 pr-1 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-[13px] cursor-pointer"
              >
                {row.columns.map((c, i) => (
                  <option key={i} value={i}>
                    Col {i + 1} — {c.layers.map((l) => l.skuName).join(" + ")}
                  </option>
                ))}
                <option value="new">+ New column</option>
              </select>
            </label>

            {selectedCol === "new" ? (
              <AddPieceForm
                skus={skus}
                libraryParts={libraryParts}
                buttonLabel="Add column"
                onSubmit={(skuId, count) => onAddColumn(selectedRow, skuId, count)}
                onSubmitFromLibrary={(sku, count) => onAddColumnFromLibrary(selectedRow, sku, count)}
              />
            ) : column ? (
              <>
                <ul className="space-y-1.5">
                  {column.layers.map((layer, li) => (
                    <li key={li} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--ghost-bg)] px-2.5 py-1.5 text-sm">
                      <span className="min-w-0 truncate text-text">
                        {layer.skuName} <span className="text-muted font-mono tabular-nums text-[12px]">({layer.unitHeight}&quot;)</span>
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <LayerCountInput value={layer.count} onCommit={(n) => onSetLayerCount(selectedRow, selectedCol, li, n)} />
                        <button
                          type="button"
                          onClick={() => onSetLayerCount(selectedRow, selectedCol, li, 0)}
                          aria-label={`Remove ${layer.skuName} layer`}
                          className="min-h-[32px] min-w-[32px] rounded-md border border-[var(--border)] text-[var(--danger-text)] cursor-pointer hover:bg-[color-mix(in_srgb,var(--danger-bg)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <AddPieceForm
                  skus={skus}
                  libraryParts={libraryParts}
                  buttonLabel="Add layer"
                  onSubmit={(skuId, count) => onAddLayer(selectedRow, selectedCol, skuId, count)}
                  onSubmitFromLibrary={(sku, count) => onAddLayerFromLibrary(selectedRow, selectedCol, sku, count)}
                />
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
