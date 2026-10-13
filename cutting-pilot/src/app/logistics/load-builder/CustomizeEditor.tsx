// src/app/logistics/load-builder/CustomizeEditor.tsx
// lb-ui-02 Part C: the customize editor. Owns its own EditorState and selection state, entirely
// separate from LoadPlanView's read-only `fixtureId`/`selected` — edit mode does not touch state
// read-only mode owns. Every mutation goes through loadEditor.ts's pure operations; this component
// only wires interaction and renders what evaluateGuards()/validateForApply() returns. Apply hands
// the finished PackPlan (plus cart/skus) back to LoadPlanView.
//
// lbr-07 (Steve, 2026-10-12: drag "doesn't always put the pieces where we want them"; "not being
// able to move pieces on top of each other"; "use pieces that are in holding"): drag-and-drop is
// gone. Customize is TAP → CHOOSE ACTION → TAP TARGET, matching the approved mockup:
//   Step 1  tap a stack (on a trailer, or in the holding tray). The action bar (a bottom sheet on
//           narrow screens, the side panel on xl) offers plain-language actions: Move or swap ·
//           Stack it onto another stack · Take pieces off the top… · Move just the top-off · Send to
//           holding · Change counts · Remove · Delete this row. A held stack offers Place as a new
//           stack · Stack it onto a stack · Take pieces off the top….
//   Step 2  every candidate shows its verdict (loadEditor's evaluate*Target): green = ok, amber +
//           "!" = allowed with a warning (a one-line confirm), faded = no (tapping it shows why).
//           "+" slots (a new stack at the end of a row, or a new row at the doors) appear only while
//           a placement action is armed.
// "Add pieces…" (job or parts-library SKUs) now feeds addToHolding — pieces land in holding,
// auto-selected in Place mode, and are placed with the same tap flow. That single path replaces
// lb-ui-07's per-trailer "Edit…" modal: its add row / add column / add layer are now "+ new row" /
// "+" slot / Stack onto, its per-layer counts are "Change counts", and "Delete row" (still moving
// the row's stacks to holding) lives in the action bar.
//
// lb-ui-08: a "Print / Export" action (LoadingDiagramPrintButton) sits alongside Dissolve… in each
// trailer's header; see loadingDiagramPdf.ts.
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Undo2,
  Rows3,
  XCircle,
  Check,
  PackageMinus,
  PackagePlus,
  Shuffle,
  Plus,
  Minus,
  Trash2,
  PackageX,
  Layers,
  ArrowLeftRight,
  RotateCcw,
  ArrowUpFromLine,
  ListOrdered,
  X,
} from "lucide-react";
import type { CartLine, Dimensions, PackColumn, PackOptions, PackPlan, PackSku } from "@/lib/packEngine";
import {
  createEditorState,
  compactLoad,
  undo,
  evaluateGuards,
  planForApply,
  setLayerCount,
  removeRow,
  withHistory,
  evaluateStackTarget,
  stackOnto,
  evaluateSlotTarget,
  moveToSlot,
  takeToHolding,
  evaluateSwapTarget,
  swapColumns,
  addToHolding,
  NEW_ROW,
  type EditorState,
  type ColumnRef,
  type PieceSource,
  type TargetVerdict,
} from "@/lib/loadEditor";
import { fetchLoadBuilderSkus } from "@/lib/jobPull";
import TrailerDiagram, { type TapVerdict } from "@/components/logistics/TrailerDiagram";
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
  // lb-ui-11: cart/skus report the FINAL, post-edit state.cart/state.skus alongside the plan — a
  // parts-library add grows state.cart and appends to state.skus (see loadEditor.ts's
  // introduceSku/cartAfterPlacement); the caller must carry those forward into whatever it re-mounts
  // this editor with next (or persists), or a reopened session's originalSkuIds would be rebuilt
  // without the library SKU and misclassify further edits to it as a conservation violation.
  onApply: (appliedPlan: PackPlan, cart: CartLine[], skus: PackSku[]) => void;
  onDiscard: () => void;
}

/** Step 1's selection: a stack on a trailer, or a held stack. */
type Selection = { kind: "trailer"; ref: ColumnRef } | { kind: "holding"; index: number };

/** Step 2's armed action: what the next target tap does, and with which pieces. "add" = pieces just
 * added to holding: a new stack in a slot OR on top of a stack, whichever the planner taps. */
type ArmedAction = "move" | "stack" | "take" | "place" | "add";
interface Armed {
  action: ArmedAction;
  source: PieceSource;
}

/** What the action bar is showing for the current selection. */
type Panel = "actions" | "take" | "counts";

type Target = { kind: "stack"; ref: ColumnRef } | { kind: "slot"; t: number; r: number | "new" } | { kind: "holding" };

const HOWTO_KEY = "lb_customize_howto_v1";

const BTN =
  "min-h-[44px] px-3 rounded-lg text-[14px] font-medium border border-[var(--border)] text-text flex items-center gap-2 cursor-pointer transition-colors hover:bg-[var(--ghost-bg)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";
const ACTION_BTN =
  "w-full min-h-[48px] px-3 rounded-lg text-[15px] font-medium border border-[var(--border)] bg-surface text-text flex items-center gap-2.5 text-left cursor-pointer transition-colors hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";

const key = (r: ColumnRef) => `${r.t}:${r.r}:${r.c}`;
const sameRef = (a: ColumnRef, b: ColumnRef) => a.t === b.t && a.r === b.r && a.c === b.c;

function sizeLabel(column: PackColumn): string {
  return column.layers.map((l) => `${l.unitHeight}″×${l.count}`).join(" + ");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function readHowtoDismissed(): boolean {
  try {
    return window.localStorage.getItem(HOWTO_KEY) === "1";
  } catch {
    return false;
  }
}

export default function CustomizeEditor({ plan, dims, options, cart, skus, onApply, onDiscard }: CustomizeEditorProps) {
  const [state, setState] = useState<EditorState>(() => createEditorState(plan, dims, options, cart, skus));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [panel, setPanel] = useState<Panel>("actions");
  const [takeCount, setTakeCount] = useState(1);
  const [armed, setArmed] = useState<Armed | null>(null);
  const [pendingWarn, setPendingWarn] = useState<{ reason: string; target: Target } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [compactMessage, setCompactMessage] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showBlockedHint, setShowBlockedHint] = useState(false);
  const [dissolveTi, setDissolveTi] = useState<number | null>(null);
  const [showAddPieces, setShowAddPieces] = useState(false);
  const [showHowto, setShowHowto] = useState(false);

  useEffect(() => {
    setShowHowto(!readHowtoDismissed());
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") cancelAll();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

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

  // lb-ui-07: "unassigned" = plan.balance merged with holding, by SKU — the same computation
  // planForApply feeds validateForApply's conservation check (not a fourth bucket).
  const unassignedBalance = useMemo(() => planForApply(state).balance, [state]);
  const unassignedTotal = useMemo(() => unassignedBalance.reduce((s, b) => s + b.remaining, 0), [unassignedBalance]);
  const skuNameById = useMemo(() => new Map(state.skus.map((s) => [s.id, s.name])), [state.skus]);

  const selectedColumn: PackColumn | null = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === "trailer") return state.plan.trailers[selection.ref.t]?.rows[selection.ref.r]?.columns[selection.ref.c] ?? null;
    return state.holding[selection.index] ?? null;
  }, [selection, state]);

  const selectedDetail: SelectedColumnDetail | null = useMemo(() => {
    if (selection?.kind !== "trailer" || !selectedColumn) return null;
    return { trailerIndex: selection.ref.t, rowIndex: selection.ref.r, columnIndex: selection.ref.c, column: selectedColumn };
  }, [selection, selectedColumn]);

  // Step 2 verdicts, computed once per (state, armed action) — never per cell in render.
  const verdicts = useMemo(() => {
    if (!armed) return null;
    const stacks = new Map<string, TargetVerdict>();
    const slots = new Map<string, TargetVerdict>();
    const srcRef = armed.source.kind === "column" || armed.source.kind === "top" ? armed.source.ref : null;
    state.plan.trailers.forEach((trailer, t) => {
      trailer.rows.forEach((row, r) => {
        row.columns.forEach((_, c) => {
          const ref = { t, r, c };
          if (srcRef && sameRef(srcRef, ref)) return;
          if (armed.action === "move" && srcRef) stacks.set(key(ref), evaluateSwapTarget(state, srcRef, ref));
          else if (armed.action === "place") stacks.set(key(ref), { level: "no", reason: "tap a + spot to place it as a new stack", heightAfter: 0 });
          else stacks.set(key(ref), evaluateStackTarget(state, armed.source, ref));
        });
        if (armed.action !== "stack" && row.rowWidthUsed < trailer.dims.width - 1e-6) {
          slots.set(`${t}:${r}`, evaluateSlotTarget(state, armed.source, { t, r, slot: row.columns.length }));
        }
      });
      if (armed.action !== "stack" && trailer.usedLength < trailer.dims.length - 1e-6) {
        slots.set(`${t}:new`, evaluateSlotTarget(state, armed.source, { t, r: NEW_ROW, slot: 0 }));
      }
    });
    const holdingTarget: TargetVerdict | null =
      armed.action === "take" && armed.source.kind === "top" ? { level: "ok", reason: "set the pieces aside", heightAfter: 0 } : null;
    return { stacks, slots, holdingTarget };
  }, [armed, state]);

  function commit(next: EditorState) {
    setState(next);
    setCompactMessage(null);
    setShowBlockedHint(false);
  }

  function cancelAll() {
    setSelection(null);
    setArmed(null);
    setPanel("actions");
    setPendingWarn(null);
  }

  function finishAction(next: EditorState) {
    if (next !== state) commit(next);
    cancelAll();
  }

  // --- Step 1: selection ---

  function handleTapStack(t: number, r: number, c: number) {
    const ref = { t, r, c };
    if (armed) {
      if (selection?.kind === "trailer" && sameRef(selection.ref, ref)) {
        cancelAll();
        return;
      }
      chooseTarget({ kind: "stack", ref });
      return;
    }
    if (selection?.kind === "trailer" && sameRef(selection.ref, ref)) {
      cancelAll();
      return;
    }
    setPendingWarn(null);
    setPanel("actions");
    setSelection({ kind: "trailer", ref });
  }

  function handleTapHeld(index: number) {
    if (selection?.kind === "holding" && selection.index === index) {
      cancelAll();
      return;
    }
    if (armed) {
      setToast("Can't go there — pieces can't go onto a held stack. Place it on a trailer first.");
      return;
    }
    setPendingWarn(null);
    setPanel("actions");
    setSelection({ kind: "holding", index });
  }

  // --- Step 2: targets ---

  function verdictFor(target: Target): TargetVerdict | null {
    if (!verdicts) return null;
    if (target.kind === "stack") return verdicts.stacks.get(key(target.ref)) ?? null;
    if (target.kind === "slot") return verdicts.slots.get(`${target.t}:${target.r}`) ?? null;
    return verdicts.holdingTarget;
  }

  function chooseTarget(target: Target) {
    const verdict = verdictFor(target);
    if (!armed || !verdict) return;
    if (verdict.level === "no") {
      setToast(`Can't go there — ${verdict.reason}`);
      return;
    }
    if (verdict.level === "warn") {
      setPendingWarn({ reason: verdict.reason, target });
      return;
    }
    applyTarget(target);
  }

  function applyTarget(target: Target) {
    if (!armed) return;
    const { action, source } = armed;
    if (target.kind === "stack") {
      if (action === "move" && source.kind === "column") finishAction(swapColumns(state, source.ref, target.ref));
      else finishAction(stackOnto(state, source, target.ref));
    } else if (target.kind === "slot") {
      const r = target.r === "new" ? NEW_ROW : target.r;
      const slot = target.r === "new" ? 0 : state.plan.trailers[target.t]?.rows[target.r]?.columns.length ?? 0;
      finishAction(moveToSlot(state, source, { t: target.t, r, slot }));
    } else if (source.kind === "top") {
      finishAction(takeToHolding(state, source));
    }
  }

  // --- action bar ---

  function arm(action: ArmedAction, source: PieceSource) {
    setPendingWarn(null);
    setArmed({ action, source });
  }

  function openTake() {
    setTakeCount(1);
    setPanel("take");
  }

  function armTake(count: number) {
    if (!selection) return;
    const source: PieceSource =
      selection.kind === "trailer" ? { kind: "top", ref: selection.ref, count } : { kind: "holdingTop", index: selection.index, count };
    arm("take", source);
  }

  function handleSendToHolding() {
    if (selection?.kind !== "trailer") return;
    finishAction(takeToHolding(state, { kind: "column", ref: selection.ref }));
  }

  /** Remove the whole stack from the load (its pieces become unassigned) — one undo step. */
  function handleRemoveStack() {
    if (selection?.kind !== "trailer" || !selectedColumn) return;
    let next = state;
    for (let li = selectedColumn.layers.length - 1; li >= 0; li--) next = setLayerCount(next, selection.ref, li, 0);
    finishAction(next === state ? state : { ...next, history: withHistory(state) });
  }

  function handleDeleteRow() {
    if (selection?.kind !== "trailer") return;
    finishAction(removeRow(state, selection.ref.t, selection.ref.r));
  }

  function handleSetLayerCount(layerIndex: number, count: number) {
    if (selection?.kind !== "trailer") return;
    const next = setLayerCount(state, selection.ref, layerIndex, count);
    if (next === state) return;
    commit(next);
    // Zeroing the last layer removes the stack itself — nothing left to show counts for.
    if (!next.plan.trailers[selection.ref.t]?.rows[selection.ref.r]?.columns[selection.ref.c]) cancelAll();
  }

  // --- toolbar ---

  function handleUndo() {
    commit(undo(state));
    cancelAll();
  }

  function handleCompact() {
    const next = compactLoad(state);
    if (next === state) {
      setCompactMessage("Load already compact — nothing to shift.");
      return;
    }
    commit(next);
    cancelAll();
  }

  /** Back to the plan Customize opened with, as one undoable step (the auto-pack, unless an earlier
   * Customize was already applied — Results' Re-pack goes all the way back to the auto-pack). */
  function handleResetConfirmed() {
    setShowResetConfirm(false);
    const fresh = createEditorState(plan, dims, options, cart, skus);
    commit({ ...fresh, originalSkuIds: state.originalSkuIds, history: withHistory(state) });
    cancelAll();
  }

  function handleAddPieces(sku: PackSku, count: number) {
    const next = addToHolding(state, sku, count);
    setShowAddPieces(false);
    if (next === state) return;
    commit(next);
    const index = state.holding.length;
    setPanel("actions");
    setSelection({ kind: "holding", index });
    setArmed({ action: "add", source: { kind: "holding", index } });
  }

  function handleApply() {
    if (!guards.canApply) {
      setShowBlockedHint(true);
      return;
    }
    onApply(planForApply(state), state.cart, state.skus);
  }

  function dismissHowto() {
    setShowHowto(false);
    try {
      window.localStorage.setItem(HOWTO_KEY, "1");
    } catch {
      // private mode / blocked storage: the card just shows again next time
    }
  }

  function rowGuardTintFor(t: number) {
    return (rowIndex: number): boolean => {
      const widthHit = guards.blocking.some((v) => v.rule === "row-width" && v.trailerIndex === t && v.rowIndex === rowIndex);
      return widthHit || overflowRowKeys.has(`${t}:${rowIndex}`);
    };
  }

  const hasEdits = state.history.length > 0 || state.holding.length > 0;
  const verb = armed?.action === "stack" ? "stack" : armed?.action === "place" || armed?.action === "add" ? "place" : "move";
  const topLayer = selectedColumn ? selectedColumn.layers[selectedColumn.layers.length - 1] : null;

  return (
    <div className={`space-y-4 ${selection ? "pb-72 xl:pb-0" : ""}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--card-border)] bg-surface p-3">
        <button type="button" onClick={handleUndo} disabled={state.history.length === 0} className={BTN}>
          <Undo2 className="w-4 h-4" aria-hidden="true" />
          Undo
        </button>
        <button type="button" onClick={() => setShowAddPieces(true)} className={BTN}>
          <PackagePlus className="w-4 h-4" aria-hidden="true" />
          Add pieces…
        </button>
        <div className="flex flex-col">
          <button type="button" onClick={handleCompact} className={BTN}>
            <Rows3 className="w-4 h-4" aria-hidden="true" />
            Compact load
          </button>
          {compactMessage && <span className="text-[12px] text-muted mt-1">{compactMessage}</span>}
        </div>
        <button type="button" onClick={() => setShowResetConfirm(true)} className={BTN}>
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
          Reset to auto-pack
        </button>
        <button type="button" onClick={() => setShowDiscardConfirm(true)} className={BTN}>
          <XCircle className="w-4 h-4" aria-hidden="true" />
          Discard
        </button>

        <div className="ml-auto flex flex-col items-end">
          {/* Doctrine: an enabled control that explains itself beats a dead low-contrast button —
           * Done stays clickable while blocked; clicking it surfaces why. */}
          <button
            type="button"
            onClick={handleApply}
            className={[
              "min-h-[44px] px-4 rounded-lg text-[14px] font-semibold flex items-center gap-2 cursor-pointer transition-colors border",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
              guards.canApply
                ? "border-[var(--brand)] bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)]"
                : "border-[var(--border)] text-muted hover:bg-[var(--ghost-bg)]",
            ].join(" ")}
          >
            <Check className="w-4 h-4" aria-hidden="true" />
            Done customizing
          </button>
          {showBlockedHint && !guards.canApply && <span className="text-[12px] mt-1 text-[var(--danger-ink)]">Fix the issues below before finishing.</span>}
        </div>
      </div>

      {/* First use */}
      {showHowto && (
        <div className="rounded-xl border border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info-text)] p-4 flex items-start gap-3">
          <div className="min-w-0 flex-1 text-sm space-y-1">
            <p className="font-semibold">How it works</p>
            <p>1. Tap a stack — on a trailer or in holding — to pick it.</p>
            <p>2. Choose what to do: move it, stack it onto another stack, or take pieces off the top.</p>
            <p>3. Tap a green spot. Faded spots can&apos;t take it — tap one to see why. Undo reverses any step.</p>
          </div>
          <button type="button" onClick={dismissHowto} className="shrink-0 min-h-[44px] px-3 rounded-lg border border-[var(--info-border)] bg-surface text-text text-sm font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
            Got it
          </button>
        </div>
      )}

      {/* Hint bar — always visible */}
      <div
        role="status"
        className="rounded-xl border px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 min-h-[56px]"
        style={
          armed
            ? { borderColor: "var(--success-bg)", background: "color-mix(in srgb, var(--success-bg) 10%, var(--surface))", color: "var(--success-ink)" }
            : { borderColor: "var(--info-border)", background: "var(--info-bg)", color: "var(--info-text)" }
        }
      >
        <p className="text-sm font-medium flex-1 min-w-[220px]">
          {armed
            ? `Step 2 — Tap a green spot to ${verb} it. Faded spots can't take it — tap one to see why.`
            : "Step 1 — Tap the stack you want to change."}
        </p>
        {selection && (
          <button type="button" onClick={cancelAll} className="min-h-[44px] px-3 rounded-lg border border-[var(--border)] bg-surface text-text text-sm font-semibold flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
            <X className="w-4 h-4" aria-hidden="true" />
            Cancel
          </button>
        )}
      </div>

      <EditorGuards guards={guards} holdingSummary={holdingSummary} />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          {state.plan.trailers.length === 0 ? (
            <div className="rounded-xl border border-[var(--card-border)] bg-surface p-6 text-sm text-muted">Nothing placed on any trailer.</div>
          ) : (
            state.plan.trailers.map((trailer, t) => (
              <TrailerDiagram
                key={t}
                trailer={trailer}
                dims={trailer.dims}
                trailerIndex={t}
                typeBadge={trailer.type && trailer.type !== state.options.trailerTypeLabel ? `Auto-downsized · ${trailer.type}` : undefined}
                selectedColumn={selection?.kind === "trailer" && selection.ref.t === t ? { rowIndex: selection.ref.r, columnIndex: selection.ref.c } : null}
                onSelectColumn={(r, c) => handleTapStack(t, r, c)}
                editable
                rowGuardTint={rowGuardTintFor(t)}
                columnVerdict={verdicts ? (r, c): TapVerdict | null => verdicts.stacks.get(key({ t, r, c })) ?? null : undefined}
                slotVerdict={verdicts ? (r): TapVerdict | null => verdicts.slots.get(`${t}:${r}`) ?? null : undefined}
                onChooseSlot={(r) => chooseTarget({ kind: "slot", t, r })}
                headerAction={
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setDissolveTi(t)}
                      className="min-h-[44px] px-3 rounded-md text-[13px] font-medium border border-[var(--border)] text-text flex items-center gap-1.5 cursor-pointer transition-colors hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                    >
                      <Shuffle className="w-3.5 h-3.5" aria-hidden="true" />
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

        <div className="space-y-4 min-w-0">
          {/* Action bar: the side panel on xl, a sticky bottom sheet on narrow screens. */}
          {selection && selectedColumn ? (
            <section
              aria-label="Actions for the selected stack"
              className="fixed inset-x-0 bottom-0 z-40 max-h-[60vh] overflow-y-auto rounded-t-2xl border-t border-[var(--card-border)] bg-surface p-4 shadow-[0_-8px_24px_rgba(0,0,0,0.18)] xl:static xl:z-auto xl:max-h-none xl:overflow-visible xl:rounded-xl xl:border xl:shadow-none"
            >
              <ActionBar
                selection={selection}
                column={selectedColumn}
                armed={armed}
                panel={panel}
                takeCount={takeCount}
                pendingWarn={pendingWarn}
                detail={selectedDetail}
                detailDims={selection.kind === "trailer" ? state.plan.trailers[selection.ref.t]?.dims ?? state.dims : state.dims}
                options={state.options}
                verb={verb}
                onMove={() => selection.kind === "trailer" && arm("move", { kind: "column", ref: selection.ref })}
                onStack={() => arm("stack", selection.kind === "trailer" ? { kind: "column", ref: selection.ref } : { kind: "holding", index: selection.index })}
                onPlace={() => selection.kind === "holding" && arm("place", { kind: "holding", index: selection.index })}
                onOpenTake={openTake}
                onTakeCount={(n) => setTakeCount(Math.max(1, Math.min(topLayer?.count ?? 1, n)))}
                onArmTake={() => armTake(takeCount)}
                onMoveTopOff={() => topLayer && armTake(topLayer.count)}
                onSendToHolding={handleSendToHolding}
                onCounts={() => setPanel("counts")}
                onBack={() => setPanel("actions")}
                onSetLayerCount={handleSetLayerCount}
                onRemove={handleRemoveStack}
                onDeleteRow={handleDeleteRow}
                onConfirmWarn={() => pendingWarn && applyTarget(pendingWarn.target)}
                onDismissWarn={() => setPendingWarn(null)}
                onCancel={cancelAll}
              />
            </section>
          ) : (
            <div className="hidden xl:block rounded-xl border border-[var(--card-border)] bg-surface p-4">
              <p className="text-sm text-muted">Tap a stack on a trailer, or a held stack, to see what you can do with it.</p>
            </div>
          )}

          <HoldingArea
            holding={state.holding}
            editable
            selectedIndex={selection?.kind === "holding" ? selection.index : null}
            onSelect={handleTapHeld}
            itemVerdict={armed ? () => ({ level: "no", reason: "pieces can't go onto a held stack" }) : undefined}
            holdingTarget={verdicts?.holdingTarget ?? null}
            onChooseHolding={() => chooseTarget({ kind: "holding" })}
          />

          {unassignedBalance.length > 0 && (
            <div className="rounded-lg border px-3 py-2 flex items-start gap-2 bg-[var(--warn-bg)] border-[var(--warn-border)]">
              <PackageX className="w-4 h-4 shrink-0 mt-0.5 text-[var(--warn-text)]" aria-hidden="true" />
              <div className="text-sm text-[var(--warn-text)] min-w-0">
                <p className="font-semibold">
                  {unassignedTotal} unassigned piece{unassignedTotal === 1 ? "" : "s"} — won&apos;t ship if you finish now
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

      {toast && (
        <div
          role="alert"
          className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 max-w-[min(520px,calc(100vw-32px))] px-4 py-3 rounded-xl text-sm font-medium bg-[var(--primary-bg)] text-[var(--primary-text)] shadow-lg"
        >
          {toast}
        </div>
      )}

      {showAddPieces && <AddPiecesModal skus={state.skus} onAdd={handleAddPieces} onClose={() => setShowAddPieces(false)} />}

      {dissolveTi !== null && (
        <DissolvePreview
          isOpen={dissolveTi !== null}
          state={state}
          srcTi={dissolveTi}
          onApply={(next) => {
            commit(next);
            setDissolveTi(null);
            cancelAll();
          }}
          onClose={() => setDissolveTi(null)}
        />
      )}

      <Modal isOpen={showResetConfirm} onClose={() => setShowResetConfirm(false)} title="Reset to auto-pack?">
        <p className="text-sm text-text">Every stack goes back to where it was when you opened Customize. You can Undo this.</p>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => setShowResetConfirm(false)} className={BTN}>
            Keep editing
          </button>
          <button
            type="button"
            onClick={handleResetConfirmed}
            className="min-h-[44px] px-4 rounded-lg text-[14px] font-semibold bg-[var(--primary-bg)] text-[var(--primary-text)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            Reset
          </button>
        </div>
      </Modal>

      <Modal isOpen={showDiscardConfirm} onClose={() => setShowDiscardConfirm(false)} title="Discard changes?">
        <p className="text-sm text-text">
          {hasEdits
            ? "This drops every edit made in this session and returns to the original plan. This cannot be undone."
            : "No edits have been made yet."}
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => setShowDiscardConfirm(false)} className={BTN}>
            Keep editing
          </button>
          <button
            type="button"
            onClick={() => {
              setShowDiscardConfirm(false);
              onDiscard();
            }}
            className="min-h-[44px] px-4 rounded-lg text-[14px] font-semibold bg-[var(--danger-bg)] text-[var(--danger-text)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            Discard
          </button>
        </div>
      </Modal>
    </div>
  );
}

// --- the action bar (Step 1 actions, the take-count stepper, counts, and the Step 2 strip) ---

interface ActionBarProps {
  selection: Selection;
  column: PackColumn;
  armed: Armed | null;
  panel: Panel;
  takeCount: number;
  pendingWarn: { reason: string } | null;
  detail: SelectedColumnDetail | null;
  detailDims: Dimensions;
  options: PackOptions;
  verb: string;
  onMove: () => void;
  onStack: () => void;
  onPlace: () => void;
  onOpenTake: () => void;
  onTakeCount: (n: number) => void;
  onArmTake: () => void;
  onMoveTopOff: () => void;
  onSendToHolding: () => void;
  onCounts: () => void;
  onBack: () => void;
  onSetLayerCount: (layerIndex: number, count: number) => void;
  onRemove: () => void;
  onDeleteRow: () => void;
  onConfirmWarn: () => void;
  onDismissWarn: () => void;
  onCancel: () => void;
}

function ActionBar(p: ActionBarProps) {
  const { selection, column, armed, panel } = p;
  const top = column.layers[column.layers.length - 1];
  const where =
    selection.kind === "trailer" ? `Trailer ${selection.ref.t + 1} · row R${selection.ref.r + 1}` : "Holding area";
  const heading = (
    <div className="mb-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{where}</p>
      <p className="text-base font-semibold text-text font-mono tabular-nums">
        {sizeLabel(column)} · {Math.round(column.totalHeight * 100) / 100}″
      </p>
    </div>
  );

  if (p.pendingWarn) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-[var(--warn-text)] rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2">
          {capitalize(p.pendingWarn.reason)}. Do it anyway?
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={p.onConfirmWarn} className="flex-1 min-h-[48px] px-4 rounded-lg text-[15px] font-semibold bg-[var(--primary-bg)] text-[var(--primary-text)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
            Do it anyway
          </button>
          <button type="button" onClick={p.onDismissWarn} className="flex-1 min-h-[48px] px-4 rounded-lg text-[15px] font-medium border border-[var(--border)] text-text cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
            Pick another spot
          </button>
        </div>
      </div>
    );
  }

  if (armed) {
    // Step 2 on a narrow screen: collapse to one line + Cancel so the targets stay visible.
    return (
      <div className="flex items-center gap-3">
        <p className="flex-1 text-sm text-text">
          <span className="font-semibold">{sizeLabel(column)}</span> — tap a green spot to {p.verb} {armed.source.kind === "top" || armed.source.kind === "holdingTop" ? `the ${armed.source.count} piece${armed.source.count === 1 ? "" : "s"}` : "it"}.
        </p>
        <button type="button" onClick={p.onCancel} className="shrink-0 min-h-[44px] px-3 rounded-lg border border-[var(--border)] text-text text-sm font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
          Cancel
        </button>
      </div>
    );
  }

  if (panel === "take" && top) {
    return (
      <div>
        {heading}
        <p className="text-sm text-text mb-2">
          How many {top.unitHeight}″ pieces off the top? <span className="text-muted">(the top layer has {top.count})</span>
        </p>
        <div className="flex items-center gap-2 mb-3">
          <button type="button" onClick={() => p.onTakeCount(p.takeCount - 1)} disabled={p.takeCount <= 1} aria-label="One fewer" className="min-h-[48px] min-w-[48px] rounded-lg border border-[var(--border)] text-text flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
            <Minus className="w-5 h-5" aria-hidden="true" />
          </button>
          <span className="min-w-[64px] text-center text-2xl font-semibold font-mono tabular-nums text-text" aria-live="polite">
            {p.takeCount}
          </span>
          <button type="button" onClick={() => p.onTakeCount(p.takeCount + 1)} disabled={p.takeCount >= top.count} aria-label="One more" className="min-h-[48px] min-w-[48px] rounded-lg border border-[var(--border)] text-text flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
            <Plus className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={p.onArmTake} className="flex-1 min-h-[48px] px-4 rounded-lg text-[15px] font-semibold bg-[var(--primary-bg)] text-[var(--primary-text)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
            Choose where they go
          </button>
          <button type="button" onClick={p.onBack} className="min-h-[48px] px-4 rounded-lg text-[15px] font-medium border border-[var(--border)] text-text cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
            Back
          </button>
        </div>
      </div>
    );
  }

  if (panel === "counts" && selection.kind === "trailer") {
    return (
      <div>
        {heading}
        <ul className="space-y-1.5 mb-3">
          {column.layers.map((layer, li) => (
            <li key={li} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--ghost-bg)] px-2.5 py-1.5 text-sm">
              <span className="min-w-0 truncate text-text">
                {layer.skuName} <span className="text-muted font-mono tabular-nums text-[12px]">({layer.unitHeight}″)</span>
              </span>
              <LayerCountInput value={layer.count} onCommit={(n) => p.onSetLayerCount(li, n)} label={`${layer.skuName} count`} />
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted mb-3">Fewer pieces go back to unassigned; more draw from what&apos;s unassigned.</p>
        <button type="button" onClick={p.onBack} className={ACTION_BTN}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div>
      {heading}
      {p.detail && (
        <div className="hidden xl:block mb-3">
          <ColumnDetailPanel selected={p.detail} dims={p.detailDims} options={p.options} />
        </div>
      )}
      <div className="space-y-2">
        {selection.kind === "trailer" ? (
          <>
            <button type="button" onClick={p.onMove} className={ACTION_BTN}>
              <ArrowLeftRight className="w-4 h-4 shrink-0" aria-hidden="true" />
              Move or swap this stack
            </button>
            <button type="button" onClick={p.onStack} className={ACTION_BTN}>
              <Layers className="w-4 h-4 shrink-0" aria-hidden="true" />
              Stack it onto another stack
            </button>
            <button type="button" onClick={p.onOpenTake} className={ACTION_BTN}>
              <ArrowUpFromLine className="w-4 h-4 shrink-0" aria-hidden="true" />
              Take pieces off the top…
            </button>
            {column.layers.length > 1 && top && (
              <button type="button" onClick={p.onMoveTopOff} className={ACTION_BTN}>
                <ArrowUpFromLine className="w-4 h-4 shrink-0" aria-hidden="true" />
                Move just the top-off ({top.unitHeight}″×{top.count})
              </button>
            )}
            <button type="button" onClick={p.onSendToHolding} className={ACTION_BTN}>
              <PackageMinus className="w-4 h-4 shrink-0" aria-hidden="true" />
              Send to holding
            </button>
            <button type="button" onClick={p.onCounts} className={ACTION_BTN}>
              <ListOrdered className="w-4 h-4 shrink-0" aria-hidden="true" />
              Change counts
            </button>
            <button type="button" onClick={p.onRemove} className={`${ACTION_BTN} text-[var(--danger-ink)] hover:bg-[color-mix(in_srgb,var(--danger-bg)_8%,transparent)]`}>
              <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              Remove from the load
            </button>
            <button type="button" onClick={p.onDeleteRow} className={`${ACTION_BTN} text-[var(--danger-ink)] hover:bg-[color-mix(in_srgb,var(--danger-bg)_8%,transparent)]`}>
              <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              Delete this row (its stacks go to holding)
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={p.onPlace} className={ACTION_BTN}>
              <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
              Place as a new stack
            </button>
            <button type="button" onClick={p.onStack} className={ACTION_BTN}>
              <Layers className="w-4 h-4 shrink-0" aria-hidden="true" />
              Stack it onto a stack
            </button>
            <button type="button" onClick={p.onOpenTake} className={ACTION_BTN}>
              <ArrowUpFromLine className="w-4 h-4 shrink-0" aria-hidden="true" />
              Take pieces off the top…
            </button>
          </>
        )}
        <button type="button" onClick={p.onCancel} className={ACTION_BTN}>
          <X className="w-4 h-4 shrink-0" aria-hidden="true" />
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- Add pieces: the job's SKUs or the parts library, into holding ---

interface AddPiecesModalProps {
  skus: PackSku[];
  onAdd: (sku: PackSku, count: number) => void;
  onClose: () => void;
}

/** lb-ui-11's job/library picker, now feeding addToHolding. Fetches the parts library once per
 * open and leaves out ids already in `skus` (a part known to this job is offered once, under "This
 * job"). A failed fetch degrades to an empty library list — the job's own SKUs stay usable. */
function AddPiecesModal({ skus, onAdd, onClose }: AddPiecesModalProps) {
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

  return (
    <Modal isOpen onClose={onClose} title="Add pieces" size="lg">
      <p className="text-sm text-muted mb-3">The pieces go to holding first. Then tap a green spot to place them.</p>
      <AddPieceForm
        skus={skus}
        libraryParts={libraryParts}
        buttonLabel="Add to holding"
        onSubmit={(skuId, count) => {
          const sku = skus.find((s) => s.id === skuId);
          if (sku) onAdd(sku, count);
        }}
        onSubmitFromLibrary={onAdd}
      />
    </Modal>
  );
}

interface AddPieceFormProps {
  skus: PackSku[];
  libraryParts: PackSku[];
  buttonLabel: string;
  onSubmit: (skuId: string, count: number) => void;
  onSubmitFromLibrary: (sku: PackSku, count: number) => void;
}

/** SKU + count picker over two sources: the job's own SKUs, or the parts library (/api/load-
 * builder-skus — the same universe a job pull matches against). */
function AddPieceForm({ skus, libraryParts, buttonLabel, onSubmit, onSubmitFromLibrary }: AddPieceFormProps) {
  const hasJobSkus = skus.length > 0;
  const hasLibraryParts = libraryParts.length > 0;
  const [source, setSource] = useState<"job" | "library">(hasJobSkus ? "job" : "library");
  const [skuId, setSkuId] = useState(skus[0]?.id ?? "");
  const [libraryId, setLibraryId] = useState(libraryParts[0]?.id ?? "");
  const [count, setCount] = useState("1");

  // Keep selections valid as the underlying lists change (the library list arrives after mount).
  useEffect(() => {
    if (!skus.some((s) => s.id === skuId)) setSkuId(skus[0]?.id ?? "");
  }, [skus, skuId]);
  useEffect(() => {
    if (!libraryParts.some((s) => s.id === libraryId)) setLibraryId(libraryParts[0]?.id ?? "");
  }, [libraryParts, libraryId]);

  if (!hasJobSkus && !hasLibraryParts) {
    return <p className="text-sm text-muted">No SKUs available to add from.</p>;
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
    <div className="space-y-3">
      {hasJobSkus && hasLibraryParts && (
        <div className="flex gap-2" role="group" aria-label="Where the pieces come from">
          {(["job", "library"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              aria-pressed={effectiveSource === s}
              className={[
                "min-h-[44px] px-3 rounded-lg text-[14px] font-medium border cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                effectiveSource === s ? "border-[var(--primary-bg)] bg-[var(--primary-bg)] text-[var(--primary-text)]" : "border-[var(--border)] text-text hover:bg-[var(--ghost-bg)]",
              ].join(" ")}
            >
              {s === "job" ? "This job's SKUs" : "Parts library"}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[13px] font-medium text-muted min-w-0 flex-1">
          SKU
          <select
            value={effectiveSource === "job" ? skuId : libraryId}
            onChange={(e) => (effectiveSource === "job" ? setSkuId(e.target.value) : setLibraryId(e.target.value))}
            className="block w-full mt-1 h-11 pl-2 pr-1 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-[16px] cursor-pointer"
          >
            {(effectiveSource === "job" ? skus : libraryParts).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[13px] font-medium text-muted">
          Count
          <input
            type="number"
            min={1}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="block mt-1 h-11 w-24 px-2 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-[16px] font-mono tabular-nums"
          />
        </label>
        <button
          type="button"
          onClick={submit}
          className="min-h-[44px] px-4 rounded-lg text-[14px] font-semibold bg-[var(--primary-bg)] text-[var(--primary-text)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

interface LayerCountInputProps {
  value: number;
  label: string;
  onCommit: (next: number) => void;
}

/** A free-typed count field (legacy's load-builder.html:2462) that commits on blur/Enter rather than
 * on every keystroke — typing "25" is one undo step, not two. 0 removes the layer. */
function LayerCountInput({ value, label, onCommit }: LayerCountInputProps) {
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
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="h-11 w-20 px-2 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-[16px] font-mono tabular-nums"
    />
  );
}
