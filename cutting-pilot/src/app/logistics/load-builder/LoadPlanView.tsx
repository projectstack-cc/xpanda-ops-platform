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
//
// lbr-05: this file now holds state and handlers only; the page is three presentational tabs —
// LoadBuilderTabs (Load · Parts · Results, ?tab= in the URL beside job_id, the lbr-04 status chip),
// LoadTab, PartsTab (the shared parts library inline — replaces the PartsLibraryPanel modal) and
// ResultsTab (the mockup's Results layout). All three panels stay mounted and are hidden with the
// `hidden` attribute, so switching tabs never drops an in-progress customize session. New state:
// `consolidate` (the pure-plan toggle → PackOptions.consolidate, saved in the snapshot). The lb-ui-03
// dev-only qty multiplier is removed entirely (state and control): the job pull gives real
// multi-trailer loads now, so the fixture cart feeds pack() as-is.
//
// lbr-08: the load list. The Load tab's parts picker and list card edit the cart pack() consumes —
// one source of truth, no mirror state: an order load's list IS `pulledSource.cart` (+ `.skus` for
// added parts; `orderCart` keeps the pull's original), a no-order load's list is `manualSource`
// (snapshot kind "manual"). Precedence everywhere is pulled > manual > fixture, and every switch
// clears the other two. Every list edit goes through requestListChange, which asks first when a
// customized layout would be discarded (and for Clear / Reset to order), then writes back to
// whichever source is live; the plan re-derives from the new list.
import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { pack, TRAILER_TYPES, DEFAULT_PACK_OPTIONS, type PackPlan, type PackOptions, type CartLine, type PackSku } from "@/lib/packEngine";
import { runPackEngineSelfCheck } from "@/lib/packEngine.selfcheck";
import { LOAD_BUILDER_FIXTURES, type LoadBuilderFixture } from "@/lib/loadBuilderFixtures";
import { type SelectedColumnDetail } from "@/components/logistics/ColumnDetailPanel";
import JobPullModal, { type PulledLoadSource } from "@/components/logistics/JobPullModal";
import BolGenerateModal, { type PackPlanSource } from "@/components/logistics/BolGenerateModal";
import SaveLoadModal from "@/components/logistics/SaveLoadModal";
import LoadPickerModal from "@/components/logistics/LoadPickerModal";
import { buildSnapshot, defaultSaveName, deserializeSnapshot, type ManualLoadSource, type OrderLoadSource, type SavedLoadRecord, type SavedLoadSnapshot } from "@/lib/savedLoad";
import { fetchLibrarySkus, LibraryFetchError } from "@/lib/jobPull";
import type { LibraryState } from "./LoadPicker";
import { addLine, clear as clearList, diffFromOrder, setQty as setLineQty, step as stepLine, withSku } from "@/lib/loadList";
import { useOrderLoadPersistence, findSavedForJob } from "@/components/logistics/useOrderLoadPersistence";
import LoadBuilderTabs, { isLoadBuilderTab, type LoadBuilderTab } from "./LoadBuilderTabs";
import LoadTab from "./LoadTab";
import PartsTab from "./PartsTab";
import ResultsTab from "./ResultsTab";
import type { LoadBuilderAccess } from "./loadBuilderUi";

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

// lbr-08: a no-order load's label, and the lbr-04 hook's `customer` for it (default save name
// "Manual load — {date ET}").
const MANUAL_LABEL = "Manual load";
const MANUAL_ID = "__manual__";
const CUSTOMIZED_WARNING = "This load has a customized layout. Changing the load list will re-pack it and discard those changes.";

/** A confirm-before-acting request (Clear, Reset to order, Re-pull, or any list change that would
 * discard a customized layout). */
interface PendingConfirm {
  title: string;
  body: string[];
  confirmLabel: string;
  run: () => void;
}

// lbr-05: merges URL params with replaceState, so ?tab= and ?job_id= never clobber each other
// (null deletes a key).
function replaceUrlParams(updates: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const key of Object.keys(updates)) {
    const v = updates[key];
    if (v === null) url.searchParams.delete(key);
    else url.searchParams.set(key, v);
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

const LEAVE_BUTTON = "w-full px-4 min-h-[44px] rounded-lg text-sm font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-50 disabled:cursor-not-allowed";

interface SelectedRef {
  trailerIndex: number;
  rowIndex: number;
  columnIndex: number;
}

// lbr-06: `access` comes from page.tsx's parsed X-User-Permissions (no re-fetch). A user who can't
// save gets no snapshot handed to the persistence hook, so its status stays "none" — no chip, no
// dirty state, no leave prompt — and generating BOLs never auto-saves for them.
export default function LoadPlanView({ access }: { access: LoadBuilderAccess }) {
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
  // lbr-05: the pure-plan toggle (PackOptions.consolidate). true = lbr-03's default — mix stacks only
  // when it saves a truck; false = pure stacks only. Same reset contract as the settings above.
  const [consolidate, setConsolidate] = useState(true);
  // lbr-05: the explicitly chosen tab (?tab=), or null for the default (Results once there's a load).
  const [tabChoice, setTabChoice] = useState<LoadBuilderTab | null>(null);

  // lb-ui-05: pulled-job source, deep-link state, and the dismissible pull banner.
  const [pulledSource, setPulledSource] = useState<OrderLoadSource | null>(null);
  // lbr-08: the no-order load list (null = none started), the parts library the picker browses, the
  // pending confirm, and a counter that focuses the picker's search box when bumped.
  const [manualSource, setManualSource] = useState<ManualLoadSource | null>(null);
  const [library, setLibrary] = useState<LibraryState>({ status: "loading" });
  const [libraryAttempt, setLibraryAttempt] = useState(0);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [searchFocusKey, setSearchFocusKey] = useState(0);
  const [showJobPull, setShowJobPull] = useState(false);
  const [deepLinkJobId, setDeepLinkJobId] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // lb-ui-09: "Generate BOLs" trigger — nullable-object convention BolGenerateModal's own jobId
  // prop already uses, not a bare boolean, so the effect that builds it stays keyed off real data.
  const [genBolOpen, setGenBolOpen] = useState(false);

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

  // lbr-08: memoized so its identity only changes with manualSource — packedPlan memoizes on `fixture`.
  const manualFixture: LoadBuilderFixture | null = useMemo(
    () => (manualSource ? { id: MANUAL_ID, invoiceNumber: "", customer: MANUAL_LABEL, label: manualSource.label, cart: manualSource.cart, skus: manualSource.skus } : null),
    [manualSource]
  );
  const hasSource = !!pulledSource || (!!manualSource && manualSource.cart.length > 0) || !!fixtureId;
  const fixture: LoadBuilderFixture = pulledSource ?? manualFixture ?? (fixtureId ? (LOAD_BUILDER_FIXTURES.find((f) => f.id === fixtureId) ?? EMPTY_FIXTURE) : EMPTY_FIXTURE);
  // lbr-05: the dev multiplier is gone, so this is just the source's own cart (name kept so the
  // comments below that reference it still read true). lbr-08: this is the load list.
  const scaledCart = fixture.cart;
  const orderDiff = useMemo(() => (pulledSource ? diffFromOrder(pulledSource.orderCart ?? pulledSource.cart, pulledSource.cart) : []), [pulledSource]);
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
    () => ({ ...DEFAULT_PACK_OPTIONS, runnerHeight, autoDownsize, consolidate, trailerTypeLabel: trailerTypeKey }),
    [runnerHeight, autoDownsize, consolidate, trailerTypeKey]
  );

  const packedPlan = useMemo(() => pack(scaledCart, fixture.skus, dims, packOptions), [scaledCart, fixture, dims, packOptions]);
  const plan = editedPlan ?? packedPlan;
  const tab: LoadBuilderTab = tabChoice ?? (hasSource ? "results" : "load");

  // lbr-04: the load as it would be saved right now (null when there's nothing to save) — the
  // hook's dirty check compares this against the last saved/loaded snapshot.
  const currentSnapshot: SavedLoadSnapshot | null = useMemo(
    () =>
      access.canSave && hasSource && plan.trailers.length > 0
        ? buildSnapshot({ fixtureId: fixtureId ?? EMPTY_FIXTURE.id, pulledSource, manualSource, trailerTypeKey, runnerHeight, editedPlan, editedCart, editedSkus, autoDownsize, consolidate })
        : null,
    [access.canSave, hasSource, plan.trailers.length, fixtureId, pulledSource, manualSource, trailerTypeKey, runnerHeight, editedPlan, editedCart, editedSkus, autoDownsize, consolidate]
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
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    if (isLoadBuilderTab(tabParam)) setTabChoice(tabParam);
    const jobId = params.get("job_id");
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

  // lbr-08: the parts library for the Load tab's picker (same endpoint and validation as the pull).
  useEffect(() => {
    let cancelled = false;
    setLibrary({ status: "loading" });
    fetchLibrarySkus()
      .then((skus) => {
        if (!cancelled) setLibrary({ status: "ready", skus });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof LibraryFetchError && (e.status === 401 || e.status === 403)) setLibrary({ status: "denied" });
        else setLibrary({ status: "error", message: e instanceof Error ? e.message : "Couldn't load the parts library." });
      });
    return () => {
      cancelled = true;
    };
  }, [libraryAttempt]);

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

  // Describe the load list (lbr-08: the source's live cart), deliberately not effectiveCart/
  // effectiveSkus — a Customize session's own additions aren't part of the list.
  const pieceCount = useMemo(() => scaledCart.reduce((s, c) => s + c.qty, 0), [scaledCart]);
  const footprintCount = useMemo(() => {
    const inList = new Set(scaledCart.map((c) => c.skuId));
    return new Set(fixture.skus.filter((s) => inList.has(s.id)).map((s) => footprintKey(s.length, s.width))).size;
  }, [fixture, scaledCart]);

  function handleTabChange(next: LoadBuilderTab) {
    setTabChoice(next);
    replaceUrlParams({ tab: next });
  }

  function handlePullConfirm(source: PulledLoadSource) {
    // lbr-08: orderCart is the pull's matched cart, frozen here for the "Changed from the order" note.
    setPulledSource({ ...source, orderCart: source.cart });
    setManualSource(null);
    setFixtureId(null);
    setSelected(null);
    setEditedPlan(null);
    setEditedCart(null);
    setEditedSkus(null);
    setMode("view");
    setBannerDismissed(false);
    setShowJobPull(false);
    setDeepLinkJobId(null);
    setCurrentSavedLoadId(null);
    setCurrentSavedLoadName(null);
    setReopenedAt(null);
    replaceUrlParams({ job_id: source.jobId });
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
      setManualSource(null);
      setFixtureId(null);
      replaceUrlParams({ job_id: snapshot.source.pulledSource.jobId });
    } else if (snapshot.source.kind === "manual") {
      setPulledSource(null);
      setFixtureId(null);
      setManualSource({ label: snapshot.source.label, cart: snapshot.source.cart, skus: snapshot.source.skus });
      replaceUrlParams({ job_id: null });
    } else {
      setPulledSource(null);
      setManualSource(null);
      setFixtureId(snapshot.source.fixtureId);
      replaceUrlParams({ job_id: null });
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
    // lbr-05: a missing value (any pre-lbr-05 row) means true — lbr-03's mix-to-save-a-truck default.
    setConsolidate(snapshot.consolidate ?? true);
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

  // lbr-05: the pure-plan toggle (Load tab settings and the Results note share it) — same reset
  // contract as the other engine settings above.
  function handleConsolidateChange(value: boolean) {
    setConsolidate(value);
    setSelected(null);
    setEditedPlan(null);
    setEditedCart(null);
    setEditedSkus(null);
    setMode("view");
  }

  // lbr-05: Results' Re-pack — discards an applied edit and returns to the auto-pack.
  function handleRepack() {
    setSelected(null);
    setEditedPlan(null);
    setEditedCart(null);
    setEditedSkus(null);
    setMode("view");
  }

  function openSaveModal() {
    setSaveError(null);
    setSaveModalOpen(true);
  }

  // lbr-08: Re-pull resets the load list to a fresh pull (handlePullConfirm), so it asks first when
  // the list has been changed from the order.
  function openRepull() {
    if (!pulledSource) return;
    const jobId = pulledSource.jobId;
    const run = () => {
      setDeepLinkJobId(jobId);
      setShowJobPull(true);
    };
    if (orderDiff.length === 0) {
      run();
      return;
    }
    setPendingConfirm({
      title: "Re-pull from the order?",
      body: ["Re-pulling replaces the load list with the order's current lines. Your changes to the list will be lost."],
      confirmLabel: "Re-pull",
      run,
    });
  }

  // --- lbr-08: load list edits ---

  /** Writes a new load list to whichever source is live (pulled > manual > fixture/none — a fixture
   * row or an empty page becomes a manual load on its first edit), then re-derives the plan. */
  function commitList(nextCart: CartLine[], addedSku?: PackSku) {
    if (pulledSource) {
      // orderCart is set lazily for a pre-lbr-08 row: its cart is still exactly the original pull.
      setPulledSource({ ...pulledSource, orderCart: pulledSource.orderCart ?? pulledSource.cart, cart: nextCart, skus: addedSku ? withSku(pulledSource.skus, addedSku) : pulledSource.skus });
    } else {
      const base = manualSource ?? (fixtureId ? { label: fixture.label, cart: fixture.cart, skus: fixture.skus } : { label: MANUAL_LABEL, cart: [], skus: [] });
      setManualSource({ label: base.label, cart: nextCart, skus: addedSku ? withSku(base.skus, addedSku) : base.skus });
      setFixtureId(null);
      // Stay on the Load tab while building (the default tab flips to Results once there's a load).
      if (tabChoice === null) setTabChoice("load");
    }
    setSelected(null);
    setEditedPlan(null);
    setEditedCart(null);
    setEditedSkus(null);
    setMode("view");
  }

  /** Every list edit comes through here: asks first when a customized layout would be discarded
   * (or when the action has its own confirm), otherwise applies immediately. */
  function requestListChange(nextCart: CartLine[], addedSku?: PackSku, confirm?: Omit<PendingConfirm, "run">) {
    const run = () => commitList(nextCart, addedSku);
    if (!editedPlan && !confirm) {
      run();
      return;
    }
    setPendingConfirm({
      title: confirm?.title ?? "Re-pack this load?",
      body: [...(confirm?.body ?? []), ...(editedPlan ? [CUSTOMIZED_WARNING] : [])],
      confirmLabel: editedPlan ? "Change and re-pack" : (confirm?.confirmLabel ?? "Continue"),
      run,
    });
  }

  function handleAddPart(sku: PackSku) {
    requestListChange(addLine(scaledCart, sku), sku);
  }

  function handleStepPart(sku: PackSku, delta: 1 | -1) {
    requestListChange(stepLine(scaledCart, sku.id, delta), delta === 1 ? sku : undefined);
  }

  function handleSetPartQty(sku: PackSku, qty: number) {
    requestListChange(setLineQty(scaledCart, sku.id, qty), qty > 0 ? sku : undefined);
  }

  function handleClearList() {
    const n = scaledCart.length;
    requestListChange(clearList(scaledCart), undefined, { title: "Clear the load list?", body: [`Clear all ${n} line${n === 1 ? "" : "s"}?`], confirmLabel: "Clear" });
  }

  function handleResetToOrder() {
    if (!pulledSource?.orderCart) return;
    requestListChange(
      pulledSource.orderCart.map((c) => ({ ...c })),
      undefined,
      { title: "Reset to the order?", body: ["Put the load list back to the order's lines? Your changes to the list will be lost."], confirmLabel: "Reset to order" }
    );
  }

  function handleStartManual() {
    setPulledSource(null);
    setFixtureId(null);
    setManualSource({ label: MANUAL_LABEL, cart: [], skus: [] });
    setSelected(null);
    setEditedPlan(null);
    setEditedCart(null);
    setEditedSkus(null);
    setMode("view");
    setCurrentSavedLoadId(null);
    setCurrentSavedLoadName(null);
    setReopenedAt(null);
    replaceUrlParams({ job_id: null });
    handleTabChange("load");
    setSearchFocusKey((k) => k + 1);
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
    <div className="flex-1 w-full max-w-screen-2xl mx-auto px-4 py-6 space-y-4 min-w-0">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Load Builder
          <span className="px-1.5 py-px rounded text-[10px] font-bold tracking-wide bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)]">BETA</span>
        </div>
        <h1 className="text-xl font-semibold text-text">{fixture.label}</h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-muted font-mono tabular-nums">
          {hasSource && (
            <>
              <span>{pieceCount} pieces</span>
              <span>{footprintCount} footprints</span>
            </>
          )}
          <span>
            {trailerTypeKey} trailer{runnerHeight > 0 ? ` · ${runnerHeight}″ runners` : ""}
          </span>
          {editedPlan && <span className="text-[var(--brand)] font-sans font-semibold">edited</span>}
          {currentSavedLoadName && (
            <span className="font-sans">
              saved as <span className="font-semibold text-text">{currentSavedLoadName}</span>
            </span>
          )}
        </div>
      </div>

      <LoadBuilderTabs tab={tab} onChange={handleTabChange} status={persistence.status} savedAt={persistence.savedAt} isOrderLoad={!!pulledSource} />

      <div role="tabpanel" id="lb-panel-load" aria-labelledby="lb-tab-load" hidden={tab !== "load"}>
        <LoadTab
          hasSource={hasSource}
          isManual={!pulledSource && !!manualSource}
          pulledSource={pulledSource}
          sourceLabel={fixture.label}
          pieceCount={pieceCount}
          footprintCount={footprintCount}
          currentSavedLoadName={currentSavedLoadName}
          isUpdate={!!currentSavedLoadId}
          locked={mode === "edit"}
          canSave={plan.trailers.length > 0}
          hasSaveAccess={access.canSave}
          trailerTypeKey={trailerTypeKey}
          trailerTypeKeys={TRAILER_TYPE_KEYS}
          runnerHeight={runnerHeight}
          runnerHeightOptions={RUNNER_HEIGHT_OPTIONS}
          autoDownsize={autoDownsize}
          consolidate={consolidate}
          onTrailerTypeChange={handleTrailerTypeChange}
          onRunnerHeightChange={handleRunnerHeightChange}
          onAutoDownsizeChange={handleAutoDownsizeChange}
          onConsolidateChange={handleConsolidateChange}
          onPull={() => setShowJobPull(true)}
          onRepull={openRepull}
          onLoadSaved={() => setPickerModalOpen(true)}
          onSave={openSaveModal}
          onCalculate={() => handleTabChange("results")}
          onStartManual={handleStartManual}
          dims={dims}
          library={library}
          onRetryLibrary={() => setLibraryAttempt((n) => n + 1)}
          searchFocusKey={searchFocusKey}
          listCart={scaledCart}
          listSkus={fixture.skus}
          orderDiff={orderDiff}
          canEditList={access.canSave}
          onAddPart={handleAddPart}
          onStepPart={handleStepPart}
          onSetPartQty={handleSetPartQty}
          onClearList={handleClearList}
          onResetToOrder={handleResetToOrder}
          reopenedAt={reopenedAt}
          onDismissReopened={() => setReopenedAt(null)}
          bannerDismissed={bannerDismissed}
          onDismissBanner={() => setBannerDismissed(true)}
        />
      </div>

      <div role="tabpanel" id="lb-panel-parts" aria-labelledby="lb-tab-parts" hidden={tab !== "parts"}>
        <PartsTab active={tab === "parts"} canView={access.canViewParts} canEdit={access.canEditParts} />
      </div>

      <div role="tabpanel" id="lb-panel-results" aria-labelledby="lb-tab-results" hidden={tab !== "results"}>
        <ResultsTab
          hasSource={hasSource}
          plan={plan}
          dims={dims}
          packOptions={packOptions}
          trailerTypeKey={trailerTypeKey}
          runnerHeight={runnerHeight}
          mode={mode}
          isEdited={!!editedPlan}
          effectiveCart={effectiveCart}
          effectiveSkus={effectiveSkus}
          invoiceNumber={fixture.invoiceNumber}
          selected={selected}
          selectedDetail={selectedDetail}
          onSelect={setSelected}
          consolidate={consolidate}
          onConsolidateChange={handleConsolidateChange}
          onRepack={handleRepack}
          onCustomize={() => setMode("edit")}
          onGenerateBols={() => setGenBolOpen(true)}
          onSave={openSaveModal}
          onLoadSaved={() => setPickerModalOpen(true)}
          isUpdate={!!currentSavedLoadId}
          canSave={access.canSave}
          canGenerateBol={access.canGenerateBol}
          onGoToLoad={() => handleTabChange("load")}
          editorKey={pulledSource ? pulledSource.id : manualSource ? MANUAL_ID : (fixtureId ?? EMPTY_FIXTURE.id)}
          onApplyEdit={handleApplyEdit}
          onDiscardEdit={handleDiscardEdit}
        />
      </div>

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
          if (generated && pulledSource && access.canSave) void autoSaveAfterBol();
        }}
      />

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

      {/* lbr-08: confirm for Clear / Reset to order / Re-pull, and for any load-list change that
          would discard a customized layout. */}
      <Modal isOpen={!!pendingConfirm} onClose={() => setPendingConfirm(null)} title={pendingConfirm?.title ?? ""}>
        {pendingConfirm?.body.map((line) => (
          <p key={line} className="text-sm text-text">
            {line}
          </p>
        ))}
        <div className="flex flex-col sm:flex-row-reverse gap-2">
          <button
            type="button"
            onClick={() => {
              const run = pendingConfirm?.run;
              setPendingConfirm(null);
              run?.();
            }}
            className={`${LEAVE_BUTTON} sm:w-auto bg-[var(--brand)] text-white hover:opacity-90`}
          >
            {pendingConfirm?.confirmLabel}
          </button>
          <button type="button" onClick={() => setPendingConfirm(null)} className={`${LEAVE_BUTTON} sm:w-auto border border-[var(--border)] text-muted hover:text-text hover:bg-[var(--ghost-bg)]`}>
            Cancel
          </button>
        </div>
      </Modal>

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
