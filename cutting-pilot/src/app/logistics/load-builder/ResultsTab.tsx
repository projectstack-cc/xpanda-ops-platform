"use client";
// src/app/logistics/load-builder/ResultsTab.tsx
// lbr-05: the Results tab, laid out per the approved mockup ("Load Builder v2 Mockup"), top to bottom:
//   1. action row — Re-pack, Customize, Generate BOLs (primary), Save/Update, Load saved. Printing
//      stays per trailer (each card's header): there is no multi-trailer print to call.
//   2. KPI tiles (the shared MetricTile) — Trucks, Stacks, Top-offs, Floor used.
//   3. the consolidation note + pure-plan toggle (PackOptions.consolidate).
//   4. one card per trailer (TrailerDiagram with a legacy-style title/subtitle, print in headerAction).
//   5. side column (below the diagrams under xl) — ColumnDetailPanel, Pieces, Warnings, Carried.
// lbr-09: at xl the trailer cards sit in TrailerScrollBox (about two trailers tall) and the side
// column is sticky, so the tools stay in view while scrolling through trucks.
// Edit mode swaps 4+5 for the existing drag CustomizeEditor, unchanged (lbr-07 replaces it).
// lb-ui-13: each card header carries a BOL # input (legacy `data-trailer-inv` parity). Values + the
// auto-fill rule live in LoadPlanView / lib/bolNumberFill.ts; the trailer's own number goes to its
// loading-diagram print (legacy printed the per-trailer number) and seeds the BOL modal.
// Presentational: everything here is derived from props; nothing is fetched.
import { useMemo, type ReactNode } from "react";
import { FileText, FolderOpen, Pencil, RotateCcw, Save } from "lucide-react";
import MetricTile from "@/components/dashboard/MetricTile";
import TrailerDiagram from "@/components/logistics/TrailerDiagram";
import TrailerScrollBox from "@/components/logistics/TrailerScrollBox";
import ColumnDetailPanel, { type SelectedColumnDetail } from "@/components/logistics/ColumnDetailPanel";
import LoadingDiagramPrintButton from "@/components/logistics/LoadingDiagramPrintButton";
import type { CartLine, Dimensions, PackOptions, PackPlan, PackSku, PackTrailer } from "@/lib/packEngine";
import { thicknessColor, thicknessLabel } from "@/lib/thicknessPalette";
import CustomizeEditor from "./CustomizeEditor";
import { BTN_GHOST, BTN_OUTLINE, BTN_PRIMARY, CARD, NO_BOL_REASON, NO_SAVE_REASON, plural, trailerBadge } from "./loadBuilderUi";

export interface ResultsSelection {
  trailerIndex: number;
  rowIndex: number;
  columnIndex: number;
}

interface ResultsTabProps {
  hasSource: boolean;
  plan: PackPlan;
  dims: Dimensions;
  packOptions: PackOptions;
  trailerTypeKey: string;
  runnerHeight: number;
  mode: "view" | "edit";
  isEdited: boolean;
  effectiveCart: CartLine[];
  effectiveSkus: PackSku[];
  invoiceNumber: string;
  /** lb-ui-13: per-trailer BOL #s (index = trailer) and the edit handler (auto-fill applied upstream). */
  bolNumbers: string[];
  onBolNumberChange: (trailerIndex: number, value: string) => void;

  selected: ResultsSelection | null;
  selectedDetail: SelectedColumnDetail | null;
  onSelect: (sel: ResultsSelection) => void;

  consolidate: boolean;
  onConsolidateChange: (v: boolean) => void;

  onRepack: () => void;
  onCustomize: () => void;
  onGenerateBols: () => void;
  onSave: () => void;
  onLoadSaved: () => void;
  isUpdate: boolean;
  /** lbr-06: logistics.load-builder edit / logistics.bol edit — the buttons disable with a reason. */
  canSave: boolean;
  canGenerateBol: boolean;
  onGoToLoad: () => void;

  editorKey: string;
  onApplyEdit: (plan: PackPlan, cart: CartLine[], skus: PackSku[]) => void;
  onDiscardEdit: () => void;
}

const r0 = (n: number) => Math.round(n);

/** "636″×98″×109″" */
function dimsLabel(d: Dimensions): string {
  return `${r0(d.length)}″×${r0(d.width)}″×${r0(d.height)}″`;
}

function trailerSubtitle(t: PackTrailer, runnerHeight: number): string {
  const pct = t.dims.length > 0 ? r0((t.usedLength / t.dims.length) * 100) : 0;
  const left = Math.max(0, r0(t.dims.length - t.usedLength));
  const mixed = t.rows.reduce((s, row) => s + row.columns.filter((c) => c.layers.length > 1).length, 0);
  return `${pct}% length · ${plural(mixed, "mixed stack", "mixed stacks")} · ${left}″ left · ${runnerHeight > 0 ? `${runnerHeight}″ runners` : "no runners"}`;
}

interface PiecesRow {
  thickness: number;
  placed: number;
  ordered: number;
  stacks: number;
}

/** Per-thickness placed/ordered/stacks. A SKU's thickness is the height it was placed at (its first
 * placed layer), else its catalog height — so placed and ordered always key the same way. */
function piecesByThickness(plan: PackPlan, cart: CartLine[], skus: PackSku[]): PiecesRow[] {
  const skuThickness = new Map<string, number>();
  const rows = new Map<number, PiecesRow>();
  const rowFor = (t: number) => {
    let r = rows.get(t);
    if (!r) {
      r = { thickness: t, placed: 0, ordered: 0, stacks: 0 };
      rows.set(t, r);
    }
    return r;
  };
  for (const trailer of plan.trailers) {
    for (const row of trailer.rows) {
      for (const column of row.columns) {
        // Stacks that hold this size (base or top-off) — so a size used only as top-offs never reads 0.
        const sizes = new Set(column.layers.map((l) => l.unitHeight));
        sizes.forEach((t) => (rowFor(t).stacks += 1));
        for (const layer of column.layers) {
          if (!skuThickness.has(layer.skuId)) skuThickness.set(layer.skuId, layer.unitHeight);
          rowFor(layer.unitHeight).placed += layer.count;
        }
      }
    }
  }
  const skuById = new Map(skus.map((s) => [s.id, s]));
  for (const line of cart) {
    const t = skuThickness.get(line.skuId) ?? skuById.get(line.skuId)?.height;
    if (t === undefined) continue;
    rowFor(t).ordered += line.qty;
  }
  return Array.from(rows.values()).sort((a, b) => b.thickness - a.thickness);
}

function Swatch({ thickness }: { thickness: number }) {
  const c = thicknessColor(thickness);
  return (
    <span
      aria-hidden="true"
      className="inline-block w-5 h-5 rounded-sm border border-[var(--border)] shrink-0"
      style={{
        background: c.hatched ? `repeating-linear-gradient(45deg, ${c.bg} 0 4px, ${c.fg}55 4px 5px)` : c.bg,
      }}
    />
  );
}

function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={CARD}>
      <h3 className="text-sm font-semibold text-text mb-2">{title}</h3>
      {children}
    </section>
  );
}

export default function ResultsTab(p: ResultsTabProps) {
  const { plan } = p;
  const trucks = plan.trailers.length;
  const consolidation = plan.consolidation;

  const stats = useMemo(() => {
    let stacks = 0;
    let topOffs = 0;
    let rows = 0;
    let maxAcross = 0;
    let used = 0;
    let cap = 0;
    for (const t of plan.trailers) {
      used += t.usedLength;
      cap += t.dims.length;
      rows += t.rows.length;
      for (const row of t.rows) {
        stacks += row.columns.length;
        maxAcross = Math.max(maxAcross, row.columns.length);
        topOffs += row.columns.filter((c) => c.layers.length > 1).length;
      }
    }
    return { stacks, topOffs, rows, maxAcross, used: r0(used), cap: r0(cap), left: Math.max(0, r0(cap - used)) };
  }, [plan]);

  const pieces = useMemo(() => piecesByThickness(plan, p.effectiveCart, p.effectiveSkus), [plan, p.effectiveCart, p.effectiveSkus]);
  const skuNameById = useMemo(() => new Map(p.effectiveSkus.map((s) => [s.id, s.name])), [p.effectiveSkus]);
  const balancePieces = plan.balance.reduce((s, b) => s + b.remaining, 0);

  if (!p.hasSource) {
    return (
      <div className={`${CARD} text-center space-y-3 py-10`}>
        <p className="text-sm text-muted max-w-sm mx-auto">No load yet. Pull an order on the Load tab, then Calculate.</p>
        <button type="button" onClick={p.onGoToLoad} className={BTN_OUTLINE}>
          Go to Load
        </button>
      </div>
    );
  }

  const topOffCaption = consolidation?.applied
    ? `fewest possible for ${plural(trucks, "truck", "trucks")}`
    : stats.topOffs === 0
      ? "pure stacks only"
      : "mixed by hand";

  return (
    <div className="space-y-4">
      {/* 1. Action row (view mode — the editor has its own Apply / Discard) */}
      {p.mode === "view" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={p.onRepack} disabled={!p.isEdited} title={p.isEdited ? "Discard edits and re-run the auto-pack" : "No edits to discard"} className={BTN_GHOST}>
            <RotateCcw size={16} aria-hidden="true" /> Re-pack
          </button>
          <button type="button" onClick={p.onCustomize} disabled={trucks === 0} className={BTN_OUTLINE}>
            <Pencil size={16} aria-hidden="true" /> Customize
          </button>
          <button
            type="button"
            onClick={p.onGenerateBols}
            disabled={trucks === 0 || !p.canGenerateBol}
            title={p.canGenerateBol ? undefined : NO_BOL_REASON}
            className={BTN_PRIMARY}
          >
            <FileText size={16} aria-hidden="true" /> Generate BOLs
          </button>
          <button type="button" onClick={p.onSave} disabled={trucks === 0 || !p.canSave} title={p.canSave ? undefined : NO_SAVE_REASON} className={BTN_GHOST}>
            <Save size={16} aria-hidden="true" /> {p.isUpdate ? "Update save" : "Save load"}
          </button>
          <button type="button" onClick={p.onLoadSaved} className={BTN_GHOST}>
            <FolderOpen size={16} aria-hidden="true" /> Load saved
          </button>
          {(!p.canGenerateBol || !p.canSave) && (
            <p className="w-full text-xs text-muted">
              {[!p.canGenerateBol ? NO_BOL_REASON : null, !p.canSave ? NO_SAVE_REASON : null].filter(Boolean).join(" ")}
            </p>
          )}
        </div>
      )}

      {/* 2. KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" role="group" aria-label="Load summary">
        <MetricTile label="Trucks" value={trucks} caption={p.trailerTypeKey} />
        <MetricTile
          label="Stacks"
          value={stats.stacks}
          caption={trucks === 1 ? `${stats.rows} rows × ${stats.maxAcross} across` : `${stats.rows} rows on ${trucks} trucks`}
        />
        <MetricTile label="Top-offs" value={stats.topOffs} caption={topOffCaption} />
        <MetricTile
          label="Floor used"
          value={stats.used}
          unit={`″ of ${stats.cap}″`}
          caption={trucks > 1 ? `${stats.left}″ left across ${trucks} trucks` : `${stats.left}″ left`}
        />
      </div>

      {/* 3. Consolidation note + pure-plan toggle */}
      {p.mode === "view" && (consolidation?.applied || !p.consolidate) && (
        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--surface-2)] px-4 py-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-text py-2">
            {p.consolidate ? consolidation?.note : "Showing the pure plan — every stack is a single size, no top-offs."}
          </p>
          <button type="button" onClick={() => p.onConsolidateChange(!p.consolidate)} className={BTN_OUTLINE}>
            {p.consolidate ? `Show pure plan (${plural(consolidation?.pureTrailers ?? trucks, "truck", "trucks")})` : "Back to fewest trucks"}
          </button>
        </div>
      )}

      {p.mode === "edit" ? (
        <CustomizeEditor
          key={p.editorKey}
          plan={plan}
          dims={p.dims}
          options={p.packOptions}
          cart={p.effectiveCart}
          skus={p.effectiveSkus}
          onApply={p.onApplyEdit}
          onDiscard={p.onDiscardEdit}
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
          {/* 4. One card per trailer */}
          {trucks === 0 ? (
            <div className={`${CARD} text-sm text-muted`}>Nothing placed — every piece is in the balance.</div>
          ) : (
            <TrailerScrollBox count={trucks}>
              {plan.trailers.map((trailer, trailerIndex) => (
                <TrailerDiagram
                  key={trailerIndex}
                  trailer={trailer}
                  dims={trailer.dims}
                  trailerIndex={trailerIndex}
                  title={`Trailer ${trailerIndex + 1} · ${trailer.type ?? p.trailerTypeKey} · ${dimsLabel(trailer.dims)}`}
                  subtitle={trailerSubtitle(trailer, p.runnerHeight)}
                  typeBadge={trailerBadge(trailer, p.trailerTypeKey)}
                  selectedColumn={p.selected && p.selected.trailerIndex === trailerIndex ? { rowIndex: p.selected.rowIndex, columnIndex: p.selected.columnIndex } : null}
                  onSelectColumn={(rowIndex, columnIndex) => p.onSelect({ trailerIndex, rowIndex, columnIndex })}
                  headerAction={
                    // Floor-grade 44px target for the shared print button (its own 28px sizing is kept
                    // for the drag editor, which lbr-07 replaces) — sized from here, not by editing it.
                    <div className="flex flex-wrap items-center gap-2 [&_button]:min-h-[44px] [&_button]:px-3.5 [&_button]:text-sm">
                      <input
                        type="text"
                        inputMode="text"
                        aria-label={`Trailer ${trailerIndex + 1} BOL #`}
                        placeholder="BOL #"
                        value={p.bolNumbers[trailerIndex] ?? ""}
                        onChange={(e) => p.onBolNumberChange(trailerIndex, e.target.value)}
                        className="w-32 min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm font-mono tabular-nums px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                      />
                      <LoadingDiagramPrintButton
                        trailer={trailer}
                        trailerIndex={trailerIndex}
                        dims={trailer.dims}
                        skus={p.effectiveSkus}
                        runnerHeight={p.runnerHeight}
                        warnings={plan.warnings}
                        invoiceNumber={p.bolNumbers[trailerIndex] || p.invoiceNumber}
                      />
                    </div>
                  }
                />
              ))}
            </TrailerScrollBox>
          )}

          {/* 5. Side column — sticky at xl (the page header doesn't stick, so top-4 is the offset) */}
          <div className="space-y-4 min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
            <ColumnDetailPanel
              selected={p.selectedDetail}
              dims={p.selected ? (plan.trailers[p.selected.trailerIndex]?.dims ?? p.dims) : p.dims}
              options={p.packOptions}
            />

            <SideCard title="Pieces">
              {pieces.length === 0 ? (
                <p className="text-sm text-muted">No pieces in this load.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted text-left">
                      <th className="font-medium pb-1" scope="col">
                        Size
                      </th>
                      <th className="font-medium pb-1 text-right" scope="col">
                        Placed / ordered
                      </th>
                      <th className="font-medium pb-1 text-right" scope="col">
                        Stacks
                      </th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums text-text">
                    {pieces.map((r) => (
                      <tr key={r.thickness} className="border-t border-[var(--line)]">
                        <td className="py-1.5">
                          <span className="inline-flex items-center gap-2">
                            <Swatch thickness={r.thickness} />
                            {thicknessLabel(r.thickness)}
                          </span>
                        </td>
                        <td className={["py-1.5 text-right", r.placed < r.ordered ? "text-[var(--warn-text)] font-semibold" : ""].join(" ")}>
                          {r.placed} / {r.ordered}
                        </td>
                        <td className="py-1.5 text-right">{r.stacks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className={["mt-2 text-sm font-medium", balancePieces === 0 ? "text-text" : "text-[var(--warn-text)]"].join(" ")}>
                {balancePieces === 0
                  ? `All pieces placed on ${plural(trucks, "truck", "trucks")}`
                  : `${plural(balancePieces, "piece", "pieces")} not placed: ${plan.balance.map((b) => `${b.remaining} × ${skuNameById.get(b.skuId) ?? b.skuId}`).join(", ")}`}
              </p>
            </SideCard>

            <SideCard title="Warnings">
              {plan.warnings.length === 0 ? (
                <p className="text-sm text-muted">No warnings for this plan.</p>
              ) : (
                <ul className="space-y-1.5 text-sm text-[var(--warn-text)]">
                  {plan.warnings.map((w, i) => (
                    <li key={i} className="rounded-md bg-[var(--warn-bg)] border border-[var(--warn-border)] px-2.5 py-1.5">
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </SideCard>

            <SideCard title="Carried to next trailer">
              {plan.balance.length === 0 ? (
                <p className="text-sm text-muted">Nothing carried forward — the full order placed.</p>
              ) : (
                <ul className="space-y-1 text-sm font-mono tabular-nums text-text">
                  {plan.balance.map((b) => (
                    <li key={b.skuId}>
                      {b.remaining} × {skuNameById.get(b.skuId) ?? b.skuId}
                    </li>
                  ))}
                </ul>
              )}
            </SideCard>
          </div>
        </div>
      )}
    </div>
  );
}
