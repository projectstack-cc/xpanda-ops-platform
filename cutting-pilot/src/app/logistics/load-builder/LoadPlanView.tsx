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
//
// lbr-04: loads save to the order. All of the logic lives in useOrderLoadPersistence (reused by
// lbr-05's new UI); this file only wires it: ?job_id= reopens the order's saved load (same restore
// path as the picker, restoreSavedLoad below) or falls back to the pull; generating BOLs from an
// order-built load auto-saves it to the order; every save goes through the hook's persist() (at
// most one saved load per order); a status chip; and the "Save this load before leaving?" modal.
import { useEffect, useMemo, useState } from "react";
import { Truck, FileText, Package, Save, FolderOpen } from "lucide-react";
import Modal from "@/components/Modal";
import { pack, planMetrics, TRAILER_TYPES, DEFAULT_PACK_OPTIONS, type PackPlan, type PackOptions, type CartLine, type PackSku } from "@/lib/packEngine";
import { runPackEngineSelfCheck } from "@/lib/packEngine.selfcheck";
import { LOAD_BUILDER_FIXTURES, type LoadBuilderFixture } from "@/lib/loadBuilderFixtures";
import PlanMetricsStrip from "@/components/logistics/PlanMetricsStrip";
import TrailerDiagram from "@/components/logistics/TrailerDiagram";
import ColumnDetailPanel, { type SelectedColumnDetail } from "@/components/logistics/ColumnDetailPanel";
import JobPullModal, { type PulledLoadSource } from "@/components/logistics/JobPullModal";
import LoadingDiagramPrintButton from "@/components/logistics/LoadingDiagramPrintButton";
import BolGenerateModal, { type PackPlanSource } from "@/components/logistics/BolGenerateModal";
import PartsLibraryPanel from "@/components/logistics/PartsLibraryPanel";
import SaveLoadModal from "@/components/logistics/SaveLoadModal";
import LoadPickerModal from "@/components/logistics/LoadPickerModal";
import { buildSnapshot, defaultSaveName, deserializeSnapshot, type SavedLoadRecord, type SavedLoadSnapshot } from "@/lib/savedLoad";
import { useOrderLoadPersistence, findSavedForJob } from "@/components/logistics/useOrderLoadPersistence";
import CustomizeEditor from "./CustomizeEditor";

// lb-ui-06: shipped runner-height values, confirmed against legacy's own dropdown
// (logistics/load-builder.html:1462 — `[0, 3, 4].forEach(rh => ...)`), not invented here.
const RUNNER_HEIGHT_OPTIONS = [0, 3, 4] as const;
const TRAILER_TYPE_KEYS = Object.keys(TRAILER_TYPES);
const DEFAULT_TRAILER_TYPE = "53ft Standard";

function footprintKey(l: number, w: number): string {
  return `${Math.min(l, w)}x${Math.max(l, w)}`;
}

// 2026-09-16: the fixture picker (INV_4202/4356/4347 — three real orders bundled for dev/QA, see
// loadBuilderFixtures.ts's own header) used to be the default landing state and an always-visible
// header control. Steve: those shouldn't be in a production-facing view now that Job Pull covers
// testing with real jobs. loadBuilderFixtures.ts itself is untouched (packEngine.selfcheck.ts's dev
// panel and savedLoad.ts's "fixture"-kind backward compat for pre-existing saved rows both still
// need it) -- only this file's picker UI and its default-selected state are removed. EMPTY_FIXTURE
// is the new default: an empty cart/skus pair pack() handles the same as any other (0 trailers),
// giving a clean "nothing selected" state instead of silently showing a real-looking invoice.
const EMPTY_FIXTURE: LoadBuilderFixture = { id: "__none__", invoiceNumber: "", customer: "", label: "No load selected", cart: [], skus: [] };

// lbr-04: "Oct 12, 3:42 PM ET" — saved-load timestamps are read on the dock in Eastern time.
function formatEt(iso: string, withDate: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const s = d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    ...(withDate ? { month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
  return `${s} ET`;
}

const LEAVE_BUTTON = "w-full px-4 min-h-[44px] rounded-lg text-sm font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-50 disabled:cursor-not-allowed";

interface SelectedRef {
  trailerIndex: number;
  rowIndex: number;
  columnIndex: number;
}

export default function LoadPlanView() {
  const [fixtureId, setFixtureId] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedRef | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [editedPlan, setEditedPlan] = useState<PackPlan | null>(null);
  // lb-ui-11: the FINAL state.cart/state.skus a completed edit session ended with — only diverge
  // from scaledCart/fixture.skus when the session added a parts-library SKU (see
  // CustomizeEditorProps.onApply's own comment). Reset alongside editedPlan at every "start fresh"
  // point below (source switch, dims/runner change) — but NOT on discard, which only abandons an
  // in-progress edit session and correctly leaves the last Apply's result (editedPlan and these)
  // exactly as they were — so a stale library addition from a PREVIOUS load never leaks into a new
  // one, while a discarded in-progress edit doesn't lose the load's actual prior state.
  const [editedCart, setEditedCart] = useState<CartLine[] | null>(null);
  const [editedSkus, setEditedSkus] = useState<PackSku[] | null>(null);
  // lb-ui-03 Step 0 dev aid — see file header. Always 1 in production (the control that changes it
  // is gated out of the bundle's runtime behavior below), so this has no effect on the shipped UI.
  const [multiplier, setMultiplier] = useState(1);

  // lb-ui-06: trailer type / runner height — engine options that existed before this prompt but had
  // no UI control. Defaults match today's shipped behavior exactly (53ft Standard, no runner).
  const [trailerTypeKey, setTrailerTypeKey] = useState(DEFAULT_TRAILER_TYPE);
  const [runnerHeight, setRunnerHeight] = useState(0);
  // lb-ui-12: matches legacy's own default (load-builder.html: `autoDownsize: true`) — this is a
  // UI-level default, NOT packEngine.ts's DEFAULT_PACK_OPTIONS.autoDownsize (which stays false so
  // every other caller of pack() — selfchecks, a saved load regenerating via editedPlan: null —
  // doesn't change behavior just because this field exists). This toggle is what actually opts a
  // v2 load into the feature.
  const [autoDownsize, setAutoDownsize] = useState(true);

  // lb-ui-05: pulled-job source, deep-link state, and the dismissible pull banner.
  const [pulledSource, setPulledSource] = useState<PulledLoadSource | null>(null);
  const [showJobPull, setShowJobPull] = useState(false);
  const [deepLinkJobId, setDeepLinkJobId] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // lb-ui-09: "Generate BOLs" trigger — nullable-object convention BolGenerateModal's own jobId
  // prop already uses, not a bare boolean, so the effect that builds it stays keyed off real data.
  const [genBolOpen, setGenBolOpen] = useState(false);

  // lb-ui-10: "Parts library" trigger. Independent of plan/mode state -- managing the shared parts
  // catalog doesn't touch the current trailer plan, so (unlike Pull from job / fixture switching)
  // this isn't disabled in edit mode.
  const [partsLibraryOpen, setPartsLibraryOpen] = useState(false);

  // lb-ui-04: saved loads. currentSavedLoadId/Name track "this is the saved load you loaded or last
  // saved" -- set on a successful Save (create) or Load, cleared only on a genuine source switch
  // (handlePullConfirm/handlePickerLoad below), NOT on trailer-type/runner/edit changes to the
  // same load -- so tweak-then-Save-again defaults to updating the same row, not creating a
  // duplicate. currentSavedLoadName prefills the save modal on update: legacy's own prompt() shows
  // BLANK on update (load-builder.html:2808), which silently renames the save to the auto-generated
  // default the moment someone re-saves without retyping -- a real rough edge, not something worth
  // porting faithfully. Prefilling the current name instead means leaving it unchanged keeps it
  // unchanged, a deliberate, disclosed improvement (see CHANGELOG).
  const [currentSavedLoadId, setCurrentSavedLoadId] = useState<string | null>(null);
  const [currentSavedLoadName, setCurrentSavedLoadName] = useState<string | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [pickerModalOpen, setPickerModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // lbr-04: set when ?job_id= reopened the order's saved load (its updated_at, for the banner).
  const [reopenedAt, setReopenedAt] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const hasSource = !!pulledSource || !!fixtureId;
  const fixture: LoadBuilderFixture = pulledSource ?? (fixtureId ? (LOAD_BUILDER_FIXTURES.find((f) => f.id === fixtureId) ?? EMPTY_FIXTURE) : EMPTY_FIXTURE);
  const scaledCart = useMemo(
    () => (multiplier === 1 ? fixture.cart : fixture.cart.map((c) => ({ ...c, qty: c.qty * multiplier }))),
    [fixture, multiplier]
  );
  // lb-ui-11: once an edit session has Applied, these are what everything downstream of the plan
  // should treat as "the load's actual cart/SKU set" — scaledCart/fixture.skus describe only the
  // ORIGINAL source, unaware of any parts-library SKU a completed edit session introduced.
  const effectiveCart = editedCart ?? scaledCart;
  const effectiveSkus = editedSkus ?? fixture.skus;

  const dims = useMemo(() => TRAILER_TYPES[trailerTypeKey] ?? TRAILER_TYPES[DEFAULT_TRAILER_TYPE], [trailerTypeKey]);
  // trailerTypeLabel (lb-ui-12): stamped onto every trailer pack() builds (PackTrailer.type) so a
  // downsized last trailer's type reads "26ft Box Truck" while every other trailer still correctly
  // reads the primary type — see PackOptions.trailerTypeLabel's own comment.
  const packOptions: PackOptions = useMemo(
    () => ({ ...DEFAULT_PACK_OPTIONS, runnerHeight, autoDownsize, trailerTypeLabel: trailerTypeKey }),
    [runnerHeight, autoDownsize, trailerTypeKey]
  );

  const packedPlan = useMemo(() => pack(scaledCart, fixture.skus, dims, packOptions), [scaledCart, fixture, dims, packOptions]);
  const plan = editedPlan ?? packedPlan;
  const metrics = useMemo(() => planMetrics(plan, packOptions), [plan, packOptions]);
  const mixedTrailerTypes = useMemo(
    () => plan.trailers.some((t) => t.dims.length !== dims.length || t.dims.width !== dims.width || t.dims.height !== dims.height),
    [plan, dims]
  );

  // lbr-04: the load as it would be saved right now (null when there's nothing to save) — the
  // hook's dirty check compares this against the last saved/loaded snapshot.
  const currentSnapshot: SavedLoadSnapshot | null = useMemo(
    () =>
      hasSource && plan.trailers.length > 0
        ? buildSnapshot({ fixtureId: fixtureId ?? EMPTY_FIXTURE.id, pulledSource, trailerTypeKey, runnerHeight, editedPlan, editedCart, editedSkus, autoDownsize })
        : null,
    [hasSource, plan.trailers.length, fixtureId, pulledSource, trailerTypeKey, runnerHeight, editedPlan, editedCart, editedSkus, autoDownsize]
  );
  const persistence = useOrderLoadPersistence({
    jobId: pulledSource?.jobId ?? null,
    customer: fixture.customer,
    currentSnapshot,
    currentSavedLoadId,
    currentSavedLoadName,
    setCurrentSavedLoadId,
    setCurrentSavedLoadName,
  });
  const { markSaved } = persistence;
  const orderLabel = pulledSource ? (pulledSource.invoiceNumber ? `INV ${pulledSource.invoiceNumber}` : pulledSource.customer) : "";

  // lbr-04: ?job_id= reopens that order's saved load (same restore path as the picker) when it has
  // a v2-loadable one; otherwise — none, a legacy-format row, or the lookup failed — it opens the
  // job pull exactly as before.
  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get("job_id");
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      try {
        const record = await findSavedForJob(jobId);
        const restored = record ? deserializeSnapshot(record.state_json) : null;
        if (!cancelled && record && restored?.ok) {
          restoreSavedLoad(record, restored.snapshot);
          markSaved(restored.snapshot, record.updated_at);
          setReopenedAt(record.updated_at);
          return;
        }
      } catch {
        // fall through to the pull
      }
      if (cancelled) return;
      setDeepLinkJobId(jobId);
      setShowJobPull(true);
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only deep link, as before; restoreSavedLoad/markSaved are stable for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (toast?.kind !== "success") return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function autoSaveAfterBol() {
    const label = orderLabel;
    const ok = await persistence.saveToOrder();
    setToast(ok ? { kind: "success", message: `BOL generated — load saved to order ${label}` } : { kind: "error", message: "BOL generated, but the load couldn't be saved to the order." });
  }

  // lb-ui-09: only recreated when the actual data changes (or the modal opens/closes) — plan/dims/
  // effectiveSkus are already stable refs from the memos/state above, so this doesn't recreate on
  // every LoadPlanView render, which would otherwise re-trigger BolGenerateModal's data-load effect.
  const bolPackPlanSource: PackPlanSource | null = useMemo(
    () => (genBolOpen ? { plan, dims, skus: effectiveSkus, jobId: pulledSource?.jobId ?? null, runnerHeight } : null),
    [genBolOpen, plan, dims, effectiveSkus, pulledSource, runnerHeight]
  );

  // Describe the ORIGINAL source (fixture/job pull), deliberately not effectiveCart/effectiveSkus —
  // these are the header's "N pieces, M footprints" summary of what was pulled in, not a live
  // recount of the current edited state.
  const pieceCount = useMemo(() => scaledCart.reduce((s, c) => s + c.qty, 0), [scaledCart]);
  const footprintCount = useMemo(
    () => new Set(fixture.skus.map((s) => footprintKey(s.length, s.width))).size,
    [fixture]
  );
  const skuNameById = useMemo(() => new Map(effectiveSkus.map((s) => [s.id, s.name])), [effectiveSkus]);

  function handlePullConfirm(source: PulledLoadSource) {
    setPulledSource(source);
    setSelected(null);
    setEditedPlan(null);
    setEditedCart(null);
    setEditedSkus(null);
    setMode("view");
    setMultiplier(1);
    setBannerDismissed(false);
    setShowJobPull(false);
    setDeepLinkJobId(null);
    setCurrentSavedLoadId(null);
    setCurrentSavedLoadName(null);
    setReopenedAt(null);
    window.history.replaceState(null, "", `?job_id=${encodeURIComponent(source.jobId)}`);
  }

  // lbr-04: the manual save goes through the hook's persist() too, so a save for an order that
  // already has a saved load updates that row (at most one per order) and the chip reads Saved.
  // The snapshot (fixtureId ?? EMPTY_FIXTURE.id included) is currentSnapshot above — Save is
  // disabled whenever that is null (no source / no trailers).
  async function handleSaveConfirm(name: string) {
    setSaving(true);
    setSaveError(null);
    const result = await persistence.persist(name);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setSaveModalOpen(false);
    // A custom build's "save before leaving" goes through this named save; leave once it lands.
    if (persistence.pendingHref) persistence.navigatePending();
  }

  function handlePickerLoad(record: SavedLoadRecord, snapshot: SavedLoadSnapshot) {
    restoreSavedLoad(record, snapshot);
    setReopenedAt(null);
    markSaved(snapshot, record.updated_at);
    setPickerModalOpen(false);
  }

  // Shared by the picker and lbr-04's ?job_id= reopen: restores a saved load's source, engine
  // settings and edited plan, and makes it the current saved load.
  function restoreSavedLoad(record: SavedLoadRecord, snapshot: SavedLoadSnapshot) {
    if (snapshot.source.kind === "pulled") {
      setPulledSource(snapshot.source.pulledSource);
      window.history.replaceState(null, "", `?job_id=${encodeURIComponent(snapshot.source.pulledSource.jobId)}`);
    } else {
      setPulledSource(null);
      setFixtureId(snapshot.source.fixtureId);
      if (new URLSearchParams(window.location.search).has("job_id")) {
        window.history.replaceState(null, "", window.location.pathname);
      }
    }
    setTrailerTypeKey(snapshot.trailerTypeKey);
    setRunnerHeight(snapshot.runnerHeight);
    // Deliberately overwrites the toggle even for a pre-lb-ui-12 row (snapshot.autoDownsize
    // undefined -> deserializeSnapshot's own `false` fallback), same as trailerTypeKey/runnerHeight
    // above: a Load restores the SESSION-LEVEL engine settings the saved plan was actually built
    // with, not just the plan object, so the toggle visibly reads what regenerating this load with
    // editedPlan: null would actually produce. The alternative (leave the live toggle alone when
    // the field is absent) avoids that one flip but means an old row can silently regenerate WITH
    // downsizing under a toggle the planner left on from a previous load — a bigger surprise than
    // the toggle itself changing, and inconsistent with how the two older engine settings behave.
    setAutoDownsize(snapshot.autoDownsize ?? false);
    setEditedPlan(snapshot.editedPlan);
    // Only restore editedCart/editedSkus alongside a non-null editedPlan -- these two describe
    // divergence FROM the frozen source that a materialized plan already accounts for; restoring
    // them next to a null editedPlan would claim library-part demand for a plan that's about to be
    // regenerated fresh from scaledCart/fixture.skus (no knowledge of that SKU), an immediate
    // conservation violation on entering edit mode. buildSnapshot can't produce that pair today, but
    // nothing enforces it against a hand-edited or future-format row, so guard here too.
    setEditedCart(snapshot.editedPlan ? snapshot.editedCart ?? null : null);
    setEditedSkus(snapshot.editedPlan ? snapshot.editedSkus ?? null : null);
    setSelected(null);
    setMode("view");
    setMultiplier(1);
    setBannerDismissed(false);
    setShowJobPull(false);
    setDeepLinkJobId(null);
    setCurrentSavedLoadId(record.id);
    setCurrentSavedLoadName(record.name);
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
    setEditedCart(null);
    setEditedSkus(null);
    setMode("view");
  }

  function handleRunnerHeightChange(rh: number) {
    setRunnerHeight(rh);
    setSelected(null);
    setEditedPlan(null);
    setEditedCart(null);
    setEditedSkus(null);
    setMode("view");
  }

  // lb-ui-12: same reset contract as trailer type / runner height above — the previous auto-pack's
  // trailers (and any manual edit built on them) no longer reflect the toggle's new value.
  function handleAutoDownsizeChange(value: boolean) {
    setAutoDownsize(value);
    setSelected(null);
    setEditedPlan(null);
    setEditedCart(null);
    setEditedSkus(null);
    setMode("view");
  }

  function handleApplyEdit(appliedPlan: PackPlan, cart: CartLine[], skus: PackSku[]) {
    setEditedPlan(appliedPlan);
    setEditedCart(cart);
    setEditedSkus(skus);
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
            {hasSource && (
              <>
                <span>{pieceCount} pieces</span>
                <span>{footprintCount} footprints</span>
              </>
            )}
            <span>
              {trailerTypeKey} trailer{runnerHeight > 0 ? ` · ${runnerHeight}" runners` : ""}
            </span>
            {editedPlan && <span className="text-[var(--brand)] font-sans font-semibold">edited</span>}
            {currentSavedLoadName && (
              <span className="font-sans">
                saved as <span className="font-semibold text-text">{currentSavedLoadName}</span>
              </span>
            )}
            {persistence.status !== "none" && (
              <span
                role="status"
                className={[
                  "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium font-sans whitespace-nowrap border",
                  persistence.status === "saved"
                    ? "bg-[var(--loaded-bg)] text-[var(--loaded-text)] border-[var(--loaded-border)]"
                    : persistence.status === "saving"
                      ? "border-[var(--border)] text-muted"
                      : "bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]",
                ].join(" ")}
              >
                {persistence.status === "saved"
                  ? `${pulledSource ? "Saved to order" : "Saved"}${persistence.savedAt ? ` · ${formatEt(persistence.savedAt, false)}` : ""}`
                  : persistence.status === "saving"
                    ? "Saving…"
                    : persistence.status === "error"
                      ? "Unsaved changes · save failed"
                      : "Unsaved changes"}
              </span>
            )}
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
          <div className="flex items-center gap-1.5" role="group" aria-label="Auto-downsize last trailer">
            <span className="text-[13px] font-medium text-muted">Downsize</span>
            {([true, false] as const).map((v) => {
              const active = autoDownsize === v;
              return (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => handleAutoDownsizeChange(v)}
                  disabled={mode === "edit"}
                  aria-pressed={active}
                  className={[
                    "min-h-[36px] px-2.5 rounded-lg text-[13px] font-medium cursor-pointer transition-colors border",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                    "disabled:opacity-40 disabled:cursor-not-allowed",
                    active
                      ? "border-[var(--brand)] text-[var(--brand)] font-semibold"
                      : "border-[var(--border)] text-muted hover:text-text hover:bg-[var(--ghost-bg)]",
                  ].join(" ")}
                >
                  {v ? "ON" : "OFF"}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setShowJobPull(true)}
            disabled={mode === "edit"}
            className="px-3 py-1.5 rounded-lg text-[13px] font-semibold min-h-[36px] cursor-pointer transition-colors border border-[var(--brand)] text-[var(--brand)] hover:bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            <Truck size={15} aria-hidden="true" /> Pull from job
          </button>
          <button
            type="button"
            onClick={() => setPartsLibraryOpen(true)}
            className="px-3 py-1.5 rounded-lg text-[13px] font-semibold min-h-[36px] cursor-pointer transition-colors border border-[var(--border)] text-muted hover:text-text hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] inline-flex items-center gap-1.5"
          >
            <Package size={15} aria-hidden="true" /> Parts library
          </button>
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
              <button
                type="button"
                onClick={() => {
                  setSaveError(null);
                  setSaveModalOpen(true);
                }}
                disabled={plan.trailers.length === 0}
                className="px-3 py-1.5 rounded-lg text-[13px] font-semibold min-h-[36px] cursor-pointer transition-colors border border-[var(--brand)] text-[var(--brand)] hover:bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                <Save size={15} aria-hidden="true" /> {currentSavedLoadId ? "Update save" : "Save load"}
              </button>
              <button
                type="button"
                onClick={() => setPickerModalOpen(true)}
                className="px-3 py-1.5 rounded-lg text-[13px] font-semibold min-h-[36px] cursor-pointer transition-colors border border-[var(--border)] text-muted hover:text-text hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] inline-flex items-center gap-1.5"
              >
                <FolderOpen size={15} aria-hidden="true" /> Load saved
              </button>
            </>
          )}
        </div>
      </div>

      {/* lbr-04: reopened-from-order banner — informational and dismissible, like the pull banner. */}
      {reopenedAt && pulledSource && (
        <div className="rounded-xl border border-[var(--loaded-border)] bg-[var(--loaded-bg)] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-[var(--loaded-text)]">
            Opened this order&apos;s saved load (saved {formatEt(reopenedAt, true)}).{" "}
            <button
              type="button"
              onClick={() => {
                setDeepLinkJobId(pulledSource.jobId);
                setShowJobPull(true);
              }}
              className="font-semibold underline cursor-pointer min-h-[32px]"
            >
              Re-pull from order
            </button>
          </div>
          <button
            type="button"
            onClick={() => setReopenedAt(null)}
            className="shrink-0 text-xs font-semibold text-[var(--loaded-text)] cursor-pointer min-h-[32px] px-2"
          >
            Dismiss
          </button>
        </div>
      )}

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

      {!hasSource ? (
        <div className="rounded-xl border border-[var(--card-border)] bg-surface p-10 text-center space-y-3">
          <Truck size={28} className="mx-auto text-muted" aria-hidden="true" />
          <p className="text-sm text-muted max-w-sm mx-auto">
            Pull a job to build a load — its line items are matched against the parts library automatically.
          </p>
          <button
            type="button"
            onClick={() => setShowJobPull(true)}
            className="px-3 py-1.5 rounded-lg text-[13px] font-semibold min-h-[36px] cursor-pointer transition-colors border border-[var(--brand)] text-[var(--brand)] hover:bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] inline-flex items-center gap-1.5"
          >
            <Truck size={15} aria-hidden="true" /> Pull from job
          </button>
        </div>
      ) : (
        <>
          {/* 2. Metrics strip */}
          <PlanMetricsStrip metrics={metrics} dims={dims} mixedTrailerTypes={mixedTrailerTypes} />

          {mode === "edit" ? (
            <CustomizeEditor
              key={pulledSource ? pulledSource.id : fixtureId}
              plan={plan}
              dims={dims}
              options={packOptions}
              cart={effectiveCart}
              skus={effectiveSkus}
              onApply={handleApplyEdit}
              onDiscard={handleDiscardEdit}
            />
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
              {/* 3. Trailer diagram(s) */}
              <div className="space-y-4">
                {plan.trailers.length === 0 ? (
                  <div className="rounded-xl border border-[var(--card-border)] bg-surface p-6 text-sm text-muted">
                    Nothing placed — every piece is in the balance below.
                  </div>
                ) : (
                  plan.trailers.map((trailer, trailerIndex) => (
                    <TrailerDiagram
                      key={trailerIndex}
                      trailer={trailer}
                      dims={trailer.dims}
                      trailerIndex={trailerIndex}
                      typeBadge={trailer.type && trailer.type !== trailerTypeKey ? `Auto-downsized · ${trailer.type}` : undefined}
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
                          dims={trailer.dims}
                          skus={effectiveSkus}
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
                <ColumnDetailPanel selected={selectedDetail} dims={selected ? (plan.trailers[selected.trailerIndex]?.dims ?? dims) : dims} options={packOptions} />

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
        </>
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

      <BolGenerateModal
        jobId={null}
        packPlanSource={bolPackPlanSource}
        onClose={(generated) => {
          setGenBolOpen(false);
          // lbr-04: generating BOLs from an order-built load saves it to the order. Never blocks or
          // undoes the BOL — a failed save only raises a Retry toast.
          if (generated && pulledSource) void autoSaveAfterBol();
        }}
      />

      <PartsLibraryPanel isOpen={partsLibraryOpen} onClose={() => setPartsLibraryOpen(false)} />

      <SaveLoadModal
        isOpen={saveModalOpen}
        defaultName={currentSavedLoadName ?? defaultSaveName(fixture.customer)}
        isUpdate={!!currentSavedLoadId}
        saving={saving}
        error={saveError}
        onClose={() => setSaveModalOpen(false)}
        onSave={handleSaveConfirm}
      />

      <LoadPickerModal isOpen={pickerModalOpen} onClose={() => setPickerModalOpen(false)} onLoad={handlePickerLoad} />

      {/* lbr-04: "save before leaving?" for in-app link clicks (tab close/reload falls back to the
          browser's own prompt). Hidden while the named-save modal it hands off to is open. */}
      <Modal isOpen={!!persistence.pendingHref && !saveModalOpen} onClose={persistence.cancelLeave} title="Save this load before leaving?">
        <p className="text-sm text-text">
          This load hasn&apos;t been saved to {pulledSource ? `order ${orderLabel}` : "an order"}. If you leave now you&apos;ll have to build it again.
        </p>
        {persistence.error && <p className="text-sm text-[var(--danger-bg)]">{persistence.error}</p>}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              if (persistence.needsNamedSave) {
                setSaveError(null);
                setSaveModalOpen(true);
              } else {
                void persistence.confirmLeave("save");
              }
            }}
            disabled={persistence.saving}
            className={`${LEAVE_BUTTON} bg-[var(--brand)] text-white hover:opacity-90`}
          >
            {persistence.saving ? "Saving…" : persistence.needsNamedSave ? "Save and leave" : "Save to order and leave"}
          </button>
          <button
            type="button"
            onClick={() => void persistence.confirmLeave("discard")}
            disabled={persistence.saving}
            className={`${LEAVE_BUTTON} border border-[var(--danger-bg)] text-[var(--danger-bg)] hover:bg-[color-mix(in_srgb,var(--danger-bg)_8%,transparent)]`}
          >
            Leave without saving
          </button>
          <button type="button" onClick={persistence.cancelLeave} className={`${LEAVE_BUTTON} border border-[var(--border)] text-muted hover:text-text hover:bg-[var(--ghost-bg)]`}>
            Keep working
          </button>
        </div>
      </Modal>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={[
            "fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded text-sm font-medium flex items-center gap-3",
            toast.kind === "success" ? "pointer-events-none bg-[var(--success-bg)] text-[var(--success-text)]" : "bg-[var(--danger-bg)] text-[var(--danger-text)]",
          ].join(" ")}
        >
          {toast.message}
          {toast.kind === "error" && (
            <>
              <button
                type="button"
                onClick={() => {
                  setToast(null);
                  void autoSaveAfterBol();
                }}
                className="font-semibold underline cursor-pointer min-h-[32px]"
              >
                Retry
              </button>
              <button type="button" onClick={() => setToast(null)} className="font-semibold cursor-pointer min-h-[32px]" aria-label="Dismiss">
                ×
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
