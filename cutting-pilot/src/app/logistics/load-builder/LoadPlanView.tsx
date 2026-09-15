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
//
// lb-ui-03 Step 0: all three shipped fixtures pack onto a single trailer (confirmed live —
// pack()'d each against TRAILER_53FT: INV_4202 trailers=1, INV_4356 trailers=1, INV_4347
// trailers=1), so dissolve has no cross-trailer receiver to work against out of the box. Added a
// dev-only quantity multiplier (x1-x4) that repeats the fixture's cart lines before pack() runs —
// the cheapest way to reach a multi-trailer scenario in the browser without a new real dataset, and
// the same technique the dissolve eligibility research behind this prompt used (scaled multiples of
// the real orders). Debug/demo aid only — gated out of production the same way the self-check table
// below already is.
//
// lb-ui-05: adds a "Pull from Job" source alongside the three fixtures — a real order's line items
// matched against the live SKU library (JobPullModal.tsx / jobPull.ts), replacing `fixture` in the
// same seam pack() already consumes. `pulledSource` is additive and in-memory only (same "no
// persistence yet" scope every lb-ui-NN prompt so far has had — lb-ui-04 is what saves this).
// Deliberately reads `?job_id=` via `window.location.search` in a useEffect rather than
// `useSearchParams` — the latter can force page.tsx into a <Suspense> boundary to satisfy
// `cf-build`, and page.tsx is outside this prompt's file fence.
//
// lb-ui-06: exposes two engine options the UI never surfaced — trailer type (all 5
// `TRAILER_TYPES` presets, was hardcoded to "53ft Standard") and runner height (0/3/4in, wired to
// `PackOptions.runnerHeight`). Design Read: building this as inline option controls for a
// logistics planner on desktop, dense + industrial, plain `<select>`s beside the existing fixture
// picker — matches this codebase's own established control (DockBoard.tsx's bay/sort selects),
// not a new pattern. Step 0 confirmed two of legacy's four trailer-option controls have no engine
// equivalent: `downsize`/`autoDownsize`/`forceSize`/`variant` are all zero matches in
// `packEngine.ts` — auto-downsize and Force Sizes are out of scope (new engine work, not UI
// wiring). `PackOptions.isFlatbed` is declared but grep-confirmed never read anywhere in the
// engine — reserved, not implemented; not wired to anything here.
//
// lb-ui-08: each trailer diagram in view mode now carries a "Print / Export" action
// (LoadingDiagramPrintButton, via TrailerDiagram's existing headerAction slot — same seam
// CustomizeEditor.tsx already uses for Edit…/Dissolve…) that builds a standalone per-trailer PDF.
// fixture.invoiceNumber is free to pass here (already in scope for the fixture-picker button
// labels); CustomizeEditor's edit-mode button omits it rather than threading a new prop through
// CustomizeEditorProps for one cosmetic field.
//
// lb-ui-09: adds a "Generate BOLs" entry point beside "Customize load" (view mode only, per Step
// 0's own finding — a mid-edit plan isn't applied yet, and CustomizeEditor has no job/invoice data
// in scope anyway, the same asymmetry BACKLOG.md already notes for lb-ui-08's Print/Export). Opens
// BolGenerateModal.tsx's new PackPlanSource-driven path against the EFFECTIVE plan (`plan` below —
// editedPlan when one exists, else the auto-pack) so a manually-customized load's BOLs match what's
// actually on screen. `bolPackPlanSource` is memoized so re-renders triggered by the modal's own
// internal state don't recreate the object and re-trigger its data-loading effect.
import { useEffect, useMemo, useState } from "react";
import { Truck, FileText } from "lucide-react";
import { pack, planMetrics, TRAILER_TYPES, DEFAULT_PACK_OPTIONS, type PackPlan, type PackOptions } from "@/lib/packEngine";
import { runPackEngineSelfCheck } from "@/lib/packEngine.selfcheck";
import { LOAD_BUILDER_FIXTURES, type LoadBuilderFixture } from "@/lib/loadBuilderFixtures";
import PlanMetricsStrip from "@/components/logistics/PlanMetricsStrip";
import TrailerDiagram from "@/components/logistics/TrailerDiagram";
import ColumnDetailPanel, { type SelectedColumnDetail } from "@/components/logistics/ColumnDetailPanel";
import JobPullModal, { type PulledLoadSource } from "@/components/logistics/JobPullModal";
import LoadingDiagramPrintButton from "@/components/logistics/LoadingDiagramPrintButton";
import BolGenerateModal, { type PackPlanSource } from "@/components/logistics/BolGenerateModal";
import CustomizeEditor from "./CustomizeEditor";

// lb-ui-06: shipped runner-height values, confirmed against legacy's own dropdown
// (logistics/load-builder.html:1462 — `[0, 3, 4].forEach(rh => ...)`), not invented here.
const RUNNER_HEIGHT_OPTIONS = [0, 3, 4] as const;
const TRAILER_TYPE_KEYS = Object.keys(TRAILER_TYPES);
const DEFAULT_TRAILER_TYPE = "53ft Standard";

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
  // lb-ui-03 Step 0 dev aid — see file header. Always 1 in production (the control that changes it
  // is gated out of the bundle's runtime behavior below), so this has no effect on the shipped UI.
  const [multiplier, setMultiplier] = useState(1);

  // lb-ui-06: trailer type / runner height — engine options that existed before this prompt but had
  // no UI control. Defaults match today's shipped behavior exactly (53ft Standard, no runner).
  const [trailerTypeKey, setTrailerTypeKey] = useState(DEFAULT_TRAILER_TYPE);
  const [runnerHeight, setRunnerHeight] = useState(0);

  // lb-ui-05: pulled-job source, deep-link state, and the dismissible pull banner.
  const [pulledSource, setPulledSource] = useState<PulledLoadSource | null>(null);
  const [showJobPull, setShowJobPull] = useState(false);
  const [deepLinkJobId, setDeepLinkJobId] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // lb-ui-09: "Generate BOLs" trigger — nullable-object convention BolGenerateModal's own jobId
  // prop already uses, not a bare boolean, so the effect that builds it stays keyed off real data.
  const [genBolOpen, setGenBolOpen] = useState(false);

  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get("job_id");
    if (jobId) {
      setDeepLinkJobId(jobId);
      setShowJobPull(true);
    }
  }, []);

  const fixture: LoadBuilderFixture = pulledSource ?? (LOAD_BUILDER_FIXTURES.find((f) => f.id === fixtureId) ?? LOAD_BUILDER_FIXTURES[0]);
  const scaledCart = useMemo(
    () => (multiplier === 1 ? fixture.cart : fixture.cart.map((c) => ({ ...c, qty: c.qty * multiplier }))),
    [fixture, multiplier]
  );

  const dims = useMemo(() => TRAILER_TYPES[trailerTypeKey] ?? TRAILER_TYPES[DEFAULT_TRAILER_TYPE], [trailerTypeKey]);
  const packOptions: PackOptions = useMemo(() => ({ ...DEFAULT_PACK_OPTIONS, runnerHeight }), [runnerHeight]);

  const packedPlan = useMemo(() => pack(scaledCart, fixture.skus, dims, packOptions), [scaledCart, fixture, dims, packOptions]);
  const plan = editedPlan ?? packedPlan;
  const metrics = useMemo(() => planMetrics(plan, dims, packOptions), [plan, dims, packOptions]);

  // lb-ui-09: only recreated when the actual data changes (or the modal opens/closes) — plan/dims/
  // fixture.skus are already stable refs from the memos/state above, so this doesn't recreate on
  // every LoadPlanView render, which would otherwise re-trigger BolGenerateModal's data-load effect.
  const bolPackPlanSource: PackPlanSource | null = useMemo(
    () => (genBolOpen ? { plan, dims, skus: fixture.skus, jobId: pulledSource?.jobId ?? null, runnerHeight } : null),
    [genBolOpen, plan, dims, fixture, pulledSource, runnerHeight]
  );

  const pieceCount = useMemo(() => scaledCart.reduce((s, c) => s + c.qty, 0), [scaledCart]);
  const footprintCount = useMemo(
    () => new Set(fixture.skus.map((s) => footprintKey(s.length, s.width))).size,
    [fixture]
  );
  const skuNameById = useMemo(() => new Map(fixture.skus.map((s) => [s.id, s.name])), [fixture]);

  function handleFixtureChange(id: string) {
    setFixtureId(id);
    setPulledSource(null);
    setSelected(null);
    setEditedPlan(null);
    setMode("view");
    setMultiplier(1);
    // advisor (pre-commit review): drop a stale ?job_id= so a reload doesn't re-open the pull modal
    // for a job the planner deliberately navigated away from.
    if (new URLSearchParams(window.location.search).has("job_id")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  function handlePullConfirm(source: PulledLoadSource) {
    setPulledSource(source);
    setSelected(null);
    setEditedPlan(null);
    setMode("view");
    setMultiplier(1);
    setBannerDismissed(false);
    setShowJobPull(false);
    setDeepLinkJobId(null);
    window.history.replaceState(null, "", `?job_id=${encodeURIComponent(source.jobId)}`);
  }

  function handleJobPullClose() {
    setShowJobPull(false);
    setDeepLinkJobId(null);
  }

  // lb-ui-06: changing either option invalidates any in-progress manual edit (the edited plan's
  // columns were built for the previous dims/effective-height) — same reset legacy performs on
  // both dropdowns (`state.manualRowsByTrailer = {}; state.editorTrailer = null`,
  // load-builder.html:1452/1461).
  function handleTrailerTypeChange(key: string) {
    setTrailerTypeKey(key);
    setSelected(null);
    setEditedPlan(null);
    setMode("view");
  }

  function handleRunnerHeightChange(rh: number) {
    setRunnerHeight(rh);
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
            <span>
              {trailerTypeKey} trailer{runnerHeight > 0 ? ` · ${runnerHeight}" runners` : ""}
            </span>
            {editedPlan && <span className="text-[var(--brand)] font-sans font-semibold">edited</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
            Trailer
            <select
              value={trailerTypeKey}
              onChange={(e) => handleTrailerTypeChange(e.target.value)}
              disabled={mode === "edit"}
              aria-label="Trailer type"
              className="h-9 pl-2 pr-1 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-text text-[13px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              {TRAILER_TYPE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
            Runners
            <select
              value={runnerHeight}
              onChange={(e) => handleRunnerHeightChange(Number(e.target.value))}
              disabled={mode === "edit"}
              aria-label="Runner height"
              className="h-9 pl-2 pr-1 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-text text-[13px] font-medium font-mono tabular-nums cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              {RUNNER_HEIGHT_OPTIONS.map((rh) => (
                <option key={rh} value={rh}>
                  {rh === 0 ? "None" : `${rh}"`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setShowJobPull(true)}
            disabled={mode === "edit"}
            className="px-3 py-1.5 rounded-lg text-[13px] font-semibold min-h-[36px] cursor-pointer transition-colors border border-[var(--brand)] text-[var(--brand)] hover:bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            <Truck size={15} aria-hidden="true" /> Pull from job
          </button>
          <div className="flex gap-1.5" role="group" aria-label="Fixture picker">
            {LOAD_BUILDER_FIXTURES.map((f) => {
              const active = !pulledSource && f.id === fixtureId;
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
          {process.env.NODE_ENV !== "production" && (
            <div className="flex gap-1 items-center" role="group" aria-label="Dev-only fixture quantity multiplier">
              <span className="text-[11px] text-muted mr-0.5">qty ×</span>
              {[1, 2, 3, 4].map((n) => {
                const active = multiplier === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setMultiplier(n)}
                    disabled={mode === "edit"}
                    aria-pressed={active}
                    className={[
                      "min-w-[28px] h-[28px] rounded-md text-[12px] font-mono tabular-nums cursor-pointer transition-colors border",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                      "disabled:opacity-40 disabled:cursor-not-allowed",
                      active
                        ? "border-[var(--brand)] text-[var(--brand)] font-semibold"
                        : "border-[var(--border)] text-muted hover:text-text hover:bg-[var(--ghost-bg)]",
                    ].join(" ")}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          )}
          {mode === "view" && (
            <>
              <button
                type="button"
                onClick={() => setMode("edit")}
                className="px-3 py-1.5 rounded-lg text-[13px] font-semibold min-h-[36px] cursor-pointer transition-colors border border-[var(--brand)] text-[var(--brand)] hover:bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                Customize load
              </button>
              <button
                type="button"
                onClick={() => setGenBolOpen(true)}
                disabled={plan.trailers.length === 0}
                className="px-3 py-1.5 rounded-lg text-[13px] font-semibold min-h-[36px] cursor-pointer transition-colors border border-[var(--brand)] text-[var(--brand)] hover:bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                <FileText size={15} aria-hidden="true" /> Generate BOLs
              </button>
            </>
          )}
        </div>
      </div>

      {/* Pull banner — informational, not blocking (Design Decision): dismissible, doesn't gate
          anything downstream. Piece count reflects the matched cart that actually feeds pack();
          unmatched items are named, never silently dropped or auto-created. */}
      {pulledSource && !bannerDismissed && (
        <div className="rounded-xl border border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_6%,transparent)] px-4 py-3 flex items-start justify-between gap-3">
          <div className="text-sm text-text">
            <span className="font-semibold">Pulled from job:</span> {pulledSource.customer}
            {pulledSource.invoiceNumber && <span className="font-mono tabular-nums"> · INV# {pulledSource.invoiceNumber}</span>}
            <span className="font-mono tabular-nums"> · {pulledSource.cart.reduce((s, c) => s + c.qty, 0)} pieces matched</span>
            {pulledSource.unmatchedCount > 0 && (
              <div className="mt-1 text-[var(--warn-text)]">
                {pulledSource.unmatchedCount} line item{pulledSource.unmatchedCount === 1 ? "" : "s"} have no matching SKU in the parts
                library: {pulledSource.unmatchedDescriptions.join(", ")}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            className="shrink-0 text-xs font-semibold text-muted hover:text-text cursor-pointer min-h-[32px] px-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 2. Metrics strip */}
      <PlanMetricsStrip metrics={metrics} dims={dims} />

      {mode === "edit" ? (
        <CustomizeEditor
          key={pulledSource ? pulledSource.id : fixtureId}
          plan={plan}
          dims={dims}
          options={packOptions}
          cart={scaledCart}
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
                  dims={dims}
                  trailerIndex={trailerIndex}
                  selectedColumn={
                    selected && selected.trailerIndex === trailerIndex
                      ? { rowIndex: selected.rowIndex, columnIndex: selected.columnIndex }
                      : null
                  }
                  onSelectColumn={(rowIndex, columnIndex) => setSelected({ trailerIndex, rowIndex, columnIndex })}
                  headerAction={
                    <LoadingDiagramPrintButton
                      trailer={trailer}
                      trailerIndex={trailerIndex}
                      dims={dims}
                      skus={fixture.skus}
                      runnerHeight={runnerHeight}
                      warnings={plan.warnings}
                      invoiceNumber={fixture.invoiceNumber}
                    />
                  }
                />
              ))
            )}
          </div>

          {/* 4. Detail panel + warnings + balance */}
          <div className="space-y-4">
            <ColumnDetailPanel selected={selectedDetail} dims={dims} options={packOptions} />

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

      {showJobPull && (
        <JobPullModal initialJobId={deepLinkJobId ?? undefined} onClose={handleJobPullClose} onConfirm={handlePullConfirm} />
      )}

      <BolGenerateModal jobId={null} packPlanSource={bolPackPlanSource} onClose={() => setGenBolOpen(false)} />
    </div>
  );
}
