"use client";
// src/app/logistics/load-builder/LoadPlanView.tsx
// Design read: building this as an office planning tool for logistics staff on a desktop, dense +
// industrial, master-detail — a fixture picker + trailer diagram(s) on the left, the selected
// column's rationale + plan-level warnings/balance on the right. Desktop-first (Decision, locked):
// this is not floor tablet tooling, do not compromise density for a 7" portrait viewport.
//
// lb-ui-01: read-only. Runs pack() on a fixture and renders the resulting PackPlan — no editing,
// no dragging, no persistence, no BOL. Customize lands in lb-ui-02, dissolve in -03, saved loads
// in -04. No API routes, no D1: the fixture data is bundled (loadBuilderFixtures.ts), and pack()
// is a pure, synchronous, dependency-free function — there is nothing here to fetch or await.
//
// lb-ui-02: adds a view/edit mode toggle. Edit mode swaps this file's own read-only panel (trailer
// diagrams + detail panel + warnings/balance) for CustomizeEditor, which owns its own state
// entirely — `fixtureId`/`selected` below are unchanged and still only used by view mode. Apply
// hands back a finished PackPlan held in `editedPlan` (in memory only — no persistence, per scope);
// switching fixtures clears it and returns to view mode. No API routes, no D1, no new dependency.
import { useMemo, useState } from "react";
import { pack, planMetrics, TRAILER_TYPES, DEFAULT_PACK_OPTIONS, type PackPlan } from "@/lib/packEngine";
import { runPackEngineSelfCheck } from "@/lib/packEngine.selfcheck";
import { LOAD_BUILDER_FIXTURES } from "@/lib/loadBuilderFixtures";
import PlanMetricsStrip from "@/components/logistics/PlanMetricsStrip";
import TrailerDiagram from "@/components/logistics/TrailerDiagram";
import ColumnDetailPanel, { type SelectedColumnDetail } from "@/components/logistics/ColumnDetailPanel";
import CustomizeEditor from "./CustomizeEditor";

const TRAILER_53FT = TRAILER_TYPES["53ft Standard"];

function footprintKey(l: number, w: number): string {
  return `${Math.min(l, w)}x${Math.max(l, w)}`;
}

interface SelectedRef {
  trailerIndex: number;
  rowIndex: number;
  columnIndex: number;
}

export default function LoadPlanView() {
  const [fixtureId, setFixtureId] = useState(LOAD_BUILDER_FIXTURES[0].id);
  const [selected, setSelected] = useState<SelectedRef | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [editedPlan, setEditedPlan] = useState<PackPlan | null>(null);

  const fixture = LOAD_BUILDER_FIXTURES.find((f) => f.id === fixtureId) ?? LOAD_BUILDER_FIXTURES[0];

  const packedPlan = useMemo(() => pack(fixture.cart, fixture.skus, TRAILER_53FT), [fixture]);
  const plan = editedPlan ?? packedPlan;
  const metrics = useMemo(() => planMetrics(plan, TRAILER_53FT, DEFAULT_PACK_OPTIONS), [plan]);

  const pieceCount = useMemo(() => fixture.cart.reduce((s, c) => s + c.qty, 0), [fixture]);
  const footprintCount = useMemo(
    () => new Set(fixture.skus.map((s) => footprintKey(s.length, s.width))).size,
    [fixture]
  );
  const skuNameById = useMemo(() => new Map(fixture.skus.map((s) => [s.id, s.name])), [fixture]);

  function handleFixtureChange(id: string) {
    setFixtureId(id);
    setSelected(null);
    setEditedPlan(null);
    setMode("view");
  }

  function handleApplyEdit(appliedPlan: PackPlan) {
    setEditedPlan(appliedPlan);
    setSelected(null);
    setMode("view");
  }

  function handleDiscardEdit() {
    setMode("view");
  }

  const selectedDetail: SelectedColumnDetail | null = useMemo(() => {
    if (!selected) return null;
    const column = plan.trailers[selected.trailerIndex]?.rows[selected.rowIndex]?.columns[selected.columnIndex];
    if (!column) return null;
    return { ...selected, column };
  }, [selected, plan]);

  // Dev-only self-check surface: pure, synchronous, no network — safe to compute on every render
  // of a dev build. Guarded out of the bundle's runtime behavior (not the bundle itself) in
  // production, matching the console-log convention BlocksApp.tsx already uses for the other
  // .selfcheck.ts consumers, extended here to a rendered pass/fail table per this prompt's spec.
  const selfCheck = process.env.NODE_ENV !== "production" ? runPackEngineSelfCheck() : null;

  return (
    <div className="flex-1 w-full max-w-screen-2xl mx-auto px-4 py-6 space-y-4">
      {/* 1. Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">{fixture.label}</h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-muted font-mono tabular-nums">
            <span>{pieceCount} pieces</span>
            <span>{footprintCount} footprints</span>
            <span>53ft Standard trailer</span>
            {editedPlan && <span className="text-[var(--brand)] font-sans font-semibold">edited</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5" role="group" aria-label="Fixture picker">
            {LOAD_BUILDER_FIXTURES.map((f) => {
              const active = f.id === fixtureId;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => handleFixtureChange(f.id)}
                  disabled={mode === "edit"}
                  aria-pressed={active}
                  className={[
                    "px-3 py-1.5 rounded-lg text-[13px] font-medium min-h-[36px] cursor-pointer transition-colors border",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                    "disabled:opacity-40 disabled:cursor-not-allowed",
                    active
                      ? "border-[var(--brand)] text-[var(--brand)] bg-transparent font-semibold"
                      : "border-[var(--border)] text-muted hover:text-text hover:bg-[var(--ghost-bg)]",
                  ].join(" ")}
                >
                  {f.invoiceNumber}
                </button>
              );
            })}
          </div>
          {mode === "view" && (
            <button
              type="button"
              onClick={() => setMode("edit")}
              className="px-3 py-1.5 rounded-lg text-[13px] font-semibold min-h-[36px] cursor-pointer transition-colors border border-[var(--brand)] text-[var(--brand)] hover:bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              Customize load
            </button>
          )}
        </div>
      </div>

      {/* 2. Metrics strip */}
      <PlanMetricsStrip metrics={metrics} dims={TRAILER_53FT} />

      {mode === "edit" ? (
        <CustomizeEditor
          key={fixtureId}
          plan={plan}
          dims={TRAILER_53FT}
          options={DEFAULT_PACK_OPTIONS}
          cart={fixture.cart}
          skus={fixture.skus}
          onApply={handleApplyEdit}
          onDiscard={handleDiscardEdit}
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
          {/* 3. Trailer diagram(s) */}
          <div className="space-y-4">
            {plan.trailers.length === 0 ? (
              <div className="rounded-xl border border-[var(--card-border)] bg-surface p-6 text-sm text-muted">
                This fixture placed nothing — every piece is in the balance below.
              </div>
            ) : (
              plan.trailers.map((trailer, trailerIndex) => (
                <TrailerDiagram
                  key={trailerIndex}
                  trailer={trailer}
                  dims={TRAILER_53FT}
                  trailerIndex={trailerIndex}
                  selectedColumn={
                    selected && selected.trailerIndex === trailerIndex
                      ? { rowIndex: selected.rowIndex, columnIndex: selected.columnIndex }
                      : null
                  }
                  onSelectColumn={(rowIndex, columnIndex) => setSelected({ trailerIndex, rowIndex, columnIndex })}
                />
              ))
            )}
          </div>

          {/* 4. Detail panel + warnings + balance */}
          <div className="space-y-4">
            <ColumnDetailPanel selected={selectedDetail} dims={TRAILER_53FT} options={DEFAULT_PACK_OPTIONS} />

            <div className="rounded-xl border border-[var(--card-border)] bg-surface p-4">
              <h3 className="text-sm font-semibold text-text mb-2">Warnings</h3>
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
            </div>

            <div className="rounded-xl border border-[var(--card-border)] bg-surface p-4">
              <h3 className="text-sm font-semibold text-text mb-2">Carried to next trailer</h3>
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
            </div>
          </div>
        </div>
      )}

      {selfCheck && (
        <details className="rounded-xl border border-[var(--card-border)] bg-surface p-4">
          <summary className="text-sm font-semibold text-text cursor-pointer select-none">
            Engine self-check (dev only) — {selfCheck.results.filter((r) => r.pass).length}/{selfCheck.results.length} passing
            {!selfCheck.pass && <span className="text-[var(--danger-bg)]"> — FAILURES PRESENT</span>}
          </summary>
          <div className="mt-3 max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {selfCheck.results.map((r, i) => (
                  <tr key={i} className="border-b border-[var(--line)] last:border-b-0">
                    <td className={["py-1 pr-3 font-semibold w-14", r.pass ? "text-[var(--success-bg)]" : "text-[var(--danger-bg)]"].join(" ")}>
                      {r.pass ? "PASS" : "FAIL"}
                    </td>
                    <td className="py-1 text-text">{r.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
