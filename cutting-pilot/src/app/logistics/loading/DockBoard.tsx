"use client";
// src/app/logistics/loading/DockBoard.tsx
// Design read: building this as the interactive dock loading board for loading-team operators
// and managers on a floor tablet, cockpit-dense, bays-as-columns + status queues -- an
// operational port of logistics/loading.html's Overview mode, not a redesign (kanban/master-
// detail would fight the real bay-assignment data model the same way it does in the legacy
// board's own design notes).
//
// Client component: fetches board data (GET /v2/api/loading-bays + /v2/api/loading-assignments)
// and refetches after every mutation (recompute, don't replay -- same rule as unit 2's dashboard
// and the v2 cutting boards).
//
// Parity notes / remaining gap (full detail in CHANGELOG.md; see PXXX-a/-b/-c entries):
//   Team View, search/sort/collapse, the Shipping Info modal, touch drag-and-drop, the
//   "+ Pull Job" flow, and the photo gallery lightbox are all shipped -- ported from
//   logistics/loading.html across PXXX-a/-b/-c.
//   Legacy's `?shipment=` notification deep link IS ported (quickwin-05): resolved via
//   `GET /v2/api/shipments?id=` -> job_id (+ load_number when present) -> loading assignment,
//   same chain as legacy. `?assignment=` deep-linking (scroll + highlight, no modal auto-open --
//   a deliberate deviation from legacy's auto-opened Shipping Info modal) IS ported too.
// The This Week / Show All toggle IS kept (not decorative -- without it Delivered/Awaiting grow
// unbounded at any real data volume).
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import PlatformHeader from "@/components/PlatformHeader";
import DockAssignmentCard from "@/components/loading/DockAssignmentCard";
import AssignBayModal from "@/components/loading/AssignBayModal";
import LoadedChecklistModal from "@/components/loading/LoadedChecklistModal";
import ShippingInfoModal from "@/components/loading/ShippingInfoModal";
import PullJobModal from "@/components/loading/PullJobModal";
import PhotoGalleryModal from "@/components/loading/PhotoGalleryModal";
import BolViewerModal from "@/components/logistics/BolViewerModal";
import TeamView from "./TeamView";
import { sortAssignments, type LdSortOrder } from "@/components/loading/sortAssignments";
import { inCurrentWeek, type CardActionHandlers, type DockAssignment, type DockBay } from "@/components/loading/dockTypes";

// Byte-exact match to logistics/loading.html's LD_COLLAPSE_KEY so an operator's section-collapse
// state survives the legacy->v2 cutover.
const LD_COLLAPSE_KEY = "ld_section_collapsed_v1";

interface DockBoardProps {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

const BAY_ACTIVE_STATUSES = ["not_started", "loading", "loaded"];

export default function DockBoard({ userName, isAdmin, permissions }: DockBoardProps) {
  const canManage = isAdmin || permissions?.["logistics.loading.manage"]?.edit === true;

  const [bays, setBays] = useState<DockBay[]>([]);
  const [assignments, setAssignments] = useState<DockAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOrder, setSortOrder] = useState<LdSortOrder>("inv_asc");
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<"overview" | "team">("overview");
  const [selectedBayId, setSelectedBayId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const [bayModalTarget, setBayModalTarget] = useState<DockAssignment | null>(null);
  const [checklistTarget, setChecklistTarget] = useState<DockAssignment | null>(null);
  const [viewerTarget, setViewerTarget] = useState<{ jobId: string; loadNumber: number | null } | null>(null);
  const [shippingInfoTarget, setShippingInfoTarget] = useState<DockAssignment | null>(null);
  const [pullJobOpen, setPullJobOpen] = useState(false);
  const [photoGalleryJobId, setPhotoGalleryJobId] = useState<string | null>(null);
  const jobCacheRef = useRef<Map<string, any>>(new Map());

  const searchParams = useSearchParams();

  const load = useCallback(async (opts?: { includeArchived?: boolean }) => {
    try {
      const [baysRes, assignRes] = await Promise.all([
        fetch("/v2/api/loading-bays").then((r) => r.json()),
        fetch("/v2/api/loading-assignments" + (opts?.includeArchived ? "?include_archived=1" : "")).then((r) =>
          r.json()
        ),
      ]);
      if (!baysRes.ok || !assignRes.ok) {
        setLoadError(baysRes.error || assignRes.error || "Couldn't load the loading board.");
        return;
      }
      setLoadError(null);
      setBays(baysRes.bays ?? []);
      setAssignments(assignRes.assignments ?? []);
    } catch {
      setLoadError("Network error — couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // A notification deep link needs aged-off (delivered/archived) rows present too, matching
    // legacy's loadDashboard({includeArchived:true}) on the deep-link path.
    const hasDeepLink = !!(searchParams.get("assignment") || searchParams.get("shipment"));
    load({ includeArchived: hasDeepLink });
    // Mount-only: this must run exactly once against the page's initial URL, matching legacy's
    // one-shot initWhenReady. Re-running on every searchParams/load identity change would refetch
    // needlessly and could re-trigger the deep-link resolve effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Section-collapse persistence: read once on mount (never during render, and wrapped in
  // try/catch exactly like legacy's loadCollapseState).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LD_COLLAPSE_KEY);
      if (raw) setCollapsedSections(JSON.parse(raw));
    } catch {
      // ignore -- sections just default to expanded
    }
  }, []);

  function toggleSection(key: string) {
    setCollapsedSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(LD_COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        // best-effort persistence only
      }
      return next;
    });
  }

  // Notification deep link (?assignment=/?shipment=): resolve once the first load has settled.
  // Legacy opens the Shipping Info modal directly; this ports scroll-into-view + a timed
  // highlight instead (documented -b deviation). ?shipment= is resolved via
  // GET /v2/api/shipments?id= (quickwin-05) and then focused the same way.
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (loading || deepLinkHandledRef.current) return;
    deepLinkHandledRef.current = true;

    const assignmentParam = searchParams.get("assignment");
    const shipmentParam = searchParams.get("shipment");
    if (!assignmentParam && !shipmentParam) return;

    const focusAssignment = (id: string) => {
      const target = assignments.find((a) => a.id === id);
      if (target?.bay_id && view === "team") setSelectedBayId(target.bay_id);
      // The target row is very often outside the This Week filter (a notification deep link
      // typically points at an aged-off delivered load) -- without this, the highlight/scroll
      // below silently no-ops because the card never renders. Same intent as the
      // include_archived=1 fetch flag above.
      setShowAll(true);
      setHighlightedId(id);
      setTimeout(() => {
        document
          .querySelector(`[data-assignment-id="${id}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
      setTimeout(() => setHighlightedId(null), 2500);
    };

    if (assignmentParam && assignments.some((a) => a.id === assignmentParam)) {
      focusAssignment(assignmentParam);
    }
    if (!assignmentParam && shipmentParam) {
      (async () => {
        try {
          const res = await fetch(`/v2/api/shipments?id=${encodeURIComponent(shipmentParam)}`);
          const body = await res.json();
          const ship: any = res.ok && body?.ok && Array.isArray(body.data) ? body.data[0] : null;
          if (!ship?.job_id) return;
          // Prefer an exact load match when the shipment carries load_number (legacy parity).
          const match =
            (ship.load_number != null &&
              assignments.find((a) => a.job_id === ship.job_id && String(a.load_number) === String(ship.load_number))) ||
            assignments.find((a) => a.job_id === ship.job_id);
          if (match) focusAssignment(match.id);
        } catch {
          // unresolved -> land on the dashboard silently (legacy parity)
        }
      })();
    }
    // If unresolved (record truly gone, or a shipment with no matching load), land on the
    // dashboard with no error toast -- matches legacy.

    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("assignment");
      url.searchParams.delete("shipment");
      window.history.replaceState(null, "", url.pathname + url.search);
    } catch {
      // best-effort URL cleanup only
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Responsive default view, computed once on mount (never re-applied after a manual toggle --
  // this effect only ever runs once, on the empty-deps mount). Must run in an effect, not during
  // render, so SSR/CSR hydration never desyncs on window.matchMedia.
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setView("team");
  }, []);

  // Switching INTO Team View via the toolbar toggle always lands on the bay list (screen 1),
  // matching legacy's setLdView('bay') -- drillIntoBay/backToBayList are separate actions from
  // the toggle itself.
  function handleSetView(next: "overview" | "team") {
    setView(next);
    if (next === "team") setSelectedBayId(null);
  }

  async function putAssignment(id: string, body: Record<string, unknown>): Promise<boolean> {
    setActionError(null);
    try {
      const res = await fetch("/v2/api/loading-assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setActionError(json.error || "That update failed.");
        return false;
      }
      return true;
    } catch {
      setActionError("Network error — couldn't reach the server.");
      return false;
    }
  }

  async function handleAdvance(a: DockAssignment, next: string) {
    if (next === "loaded") {
      setChecklistTarget(a);
      return;
    }
    if (await putAssignment(a.id, { loading_status: next })) load();
  }

  function handleAssignBay(a: DockAssignment) {
    setBayModalTarget(a);
  }

  async function confirmAssignBay(bayId: string) {
    if (!bayModalTarget) return;
    if (await putAssignment(bayModalTarget.id, { bay_id: bayId, loading_status: "not_started" })) {
      setBayModalTarget(null);
      load();
    }
  }

  async function handleMoveToYard(a: DockAssignment) {
    if (await putAssignment(a.id, { location: "yard", bay_id: null })) load();
  }

  async function handleRevertToBay(a: DockAssignment) {
    if (!window.confirm("Move this trailer back to its bay?")) return;
    if (await putAssignment(a.id, { loading_status: "loaded", location: "bay" })) load();
  }

  async function handleRevertYardToBay(a: DockAssignment) {
    if (!window.confirm("Move this trailer back to the bay queue?")) return;
    if (await putAssignment(a.id, { location: "bay", bay_id: null, loading_status: "awaiting" })) load();
  }

  async function handleSendBackToQueue(a: DockAssignment) {
    if (!window.confirm("Send this delivered load back to the awaiting queue?")) return;
    if (await putAssignment(a.id, { location: "bay", bay_id: null, loading_status: "awaiting" })) load();
  }

  async function handleArchive(a: DockAssignment) {
    if (await putAssignment(a.id, { loading_status: "archived" })) load();
  }

  async function handleTrailerChange(a: DockAssignment, value: string) {
    // Refetch either way: on success to reflect the saved value everywhere it's rendered, on
    // failure to discard the optimistic input and show the real last-saved value.
    await putAssignment(a.id, { trailer_number: value });
    load();
  }

  function handleViewBol(a: DockAssignment) {
    setViewerTarget({ jobId: a.job_id, loadNumber: a.load_number });
  }

  function cardDraggable(a: DockAssignment): boolean {
    // Terminal statuses are never draggable
    if (["in_transit", "delivered", "archived"].includes(a.loading_status)) return false;
    // Yard cards use their explicit "Move back to bay" button instead
    if (a.location === "yard") return false;
    // Awaiting cards can only be dragged by managers (assigns to bay)
    if (a.loading_status === "awaiting" && !canManage) return false;
    return true;
  }

  function handleDragStart(a: DockAssignment, e: React.DragEvent) {
    e.dataTransfer.setData("text/plain", a.id);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(a.id);
  }

  function handleDragEnd() {
    setDraggingId(null);
    setDragOverTarget(null);
  }

  function handleDragOver(targetId: string, e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTarget(targetId);
  }

  // Shared by the native (mouse) drop handler and the touch-drag effect below -- both resolve to
  // the same PUT, matching legacy's onBayDrop/onQueueDrop bodies exactly.
  async function moveAssignmentToTarget(assignmentId: string, targetId: string) {
    const a = assignments.find((x) => x.id === assignmentId);
    if (!a) return;

    if (targetId === "awaiting") {
      // Drop to awaiting queue — unassign bay
      if (a.loading_status === "awaiting" && !a.bay_id) return; // already there
      if (await putAssignment(a.id, { bay_id: null, loading_status: "awaiting" })) load();
    } else {
      // Drop to a bay
      if (a.bay_id === targetId && a.loading_status !== "awaiting") return; // already in this bay
      const body: Record<string, unknown> = { bay_id: targetId };
      if (a.loading_status === "awaiting") body.loading_status = "not_started";
      if (await putAssignment(a.id, body)) load();
    }
  }

  async function handleDrop(targetId: string, e: React.DragEvent) {
    e.preventDefault();
    setDraggingId(null);
    setDragOverTarget(null);
    const assignmentId = e.dataTransfer.getData("text/plain");
    if (!assignmentId) return;
    await moveAssignmentToTarget(assignmentId, targetId);
  }

  function handleShowShippingInfo(a: DockAssignment) {
    setShippingInfoTarget(a);
  }

  function handleShowPhotos(a: DockAssignment) {
    setPhotoGalleryJobId(a.job_id);
  }

  // --- Touch drag for Overview (PXXX-b) -----------------------------------------------------
  // HTML5 drag-and-drop (used above for mouse) has no touch equivalent, so this ports legacy's
  // initTouchDragForOverview + document-level touchmove/touchend by hand: a floating clone
  // follows the finger, elementFromPoint finds the bay column / awaiting queue under it, and
  // touchend reuses moveAssignmentToTarget -- the same PUT the mouse path uses. Team View stays
  // drag-free (legacy has no drag there either). Re-subscribed whenever `assignments`/`canManage`
  // change so the closures below never go stale.
  const touchDragIdRef = useRef<string | null>(null);
  const touchDragElRef = useRef<HTMLElement | null>(null);
  const touchCloneRef = useRef<HTMLElement | null>(null);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const touchMovedRef = useRef(false);

  function handleCardTouchStart(a: DockAssignment, e: React.TouchEvent) {
    if (view !== "overview") return;
    if (!cardDraggable(a)) return;
    if (e.touches.length !== 1) return;
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    touchDragIdRef.current = a.id;
    touchDragElRef.current = e.currentTarget as HTMLElement;
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    touchMovedRef.current = false;
  }

  useEffect(() => {
    function onTouchMove(e: TouchEvent) {
      const dragEl = touchDragElRef.current;
      const dragId = touchDragIdRef.current;
      if (!dragEl || !dragId) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartRef.current.x;
      const dy = touch.clientY - touchStartRef.current.y;
      if (!touchMovedRef.current && Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      touchMovedRef.current = true;

      if (!touchCloneRef.current) {
        const clone = dragEl.cloneNode(true) as HTMLElement;
        clone.style.cssText = `position:fixed;z-index:10001;pointer-events:none;width:${dragEl.offsetWidth}px;opacity:0.85;box-shadow:0 8px 24px rgba(0,0,0,0.2);transform:rotate(2deg);`;
        document.body.appendChild(clone);
        touchCloneRef.current = clone;
        dragEl.style.opacity = "0.3";
        setDraggingId(dragId);
      }
      const clone = touchCloneRef.current;
      clone.style.left = `${touch.clientX - dragEl.offsetWidth / 2}px`;
      clone.style.top = `${touch.clientY - 20}px`;

      const elUnder = document.elementFromPoint(touch.clientX, touch.clientY);
      const bayCol = elUnder?.closest("[data-bay-drop-id]") as HTMLElement | null;
      const queueZone = canManage ? (elUnder?.closest("[data-queue-drop]") as HTMLElement | null) : null;
      setDragOverTarget(bayCol?.dataset.bayDropId ?? (queueZone ? "awaiting" : null));
    }

    async function onTouchEnd() {
      const dragId = touchDragIdRef.current;
      const dragEl = touchDragElRef.current;
      const moved = touchMovedRef.current;
      const target = dragOverTarget;

      if (touchCloneRef.current) {
        touchCloneRef.current.remove();
        touchCloneRef.current = null;
      }
      if (dragEl) dragEl.style.opacity = "1";
      touchDragIdRef.current = null;
      touchDragElRef.current = null;
      touchMovedRef.current = false;
      setDraggingId(null);
      setDragOverTarget(null);

      if (dragId && moved && target) {
        await moveAssignmentToTarget(dragId, target);
      }
    }

    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd);
    return () => {
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [assignments, canManage, dragOverTarget]);
  // --------------------------------------------------------------------------------------------

  function matchesSearch(a: DockAssignment): boolean {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return [a.invoice_number, a.customer, a.po_number].some((v) => String(v || "").toLowerCase().includes(q));
  }

  // Port of legacy's ldOverviewSet: a non-empty search bypasses the This Week filter entirely.
  // This working set feeds Team View as well (PXXX-b's own spec, deliberately deviating from
  // legacy, where Team View reads unfiltered allAssignments -- see CHANGELOG.md).
  const searching = searchTerm.trim().length > 0;
  const set = assignments.filter((a) => {
    if (!matchesSearch(a)) return false;
    if (searching) return true;
    if (showAll) return true;
    return inCurrentWeek(a.ship_date);
  });

  const awaiting = sortAssignments(
    set.filter((a) => a.loading_status === "awaiting"),
    sortOrder
  );
  const yard = sortAssignments(
    set.filter(
      (a) => a.location === "yard" && a.loading_status !== "in_transit" && a.loading_status !== "delivered"
    ),
    sortOrder
  );
  const transit = sortAssignments(
    set.filter((a) => a.loading_status === "in_transit"),
    sortOrder
  );
  const delivered = sortAssignments(
    set.filter((a) => a.loading_status === "delivered"),
    sortOrder
  );

  const cardHandlers: CardActionHandlers = {
    canManage,
    onAdvance: handleAdvance,
    onAssignBay: handleAssignBay,
    onMoveToYard: handleMoveToYard,
    onRevertToBay: handleRevertToBay,
    onRevertYardToBay: handleRevertYardToBay,
    onSendBackToQueue: handleSendBackToQueue,
    onArchive: handleArchive,
    onTrailerChange: handleTrailerChange,
    onViewBol: handleViewBol,
    onShowShippingInfo: handleShowShippingInfo,
    onShowPhotos: handleShowPhotos,
  };

  function renderCard(a: DockAssignment, extraProps?: { showArchive?: boolean }) {
    const isDraggableCard = cardDraggable(a);
    return (
      <DockAssignmentCard
        key={a.id}
        a={a}
        {...cardHandlers}
        {...extraProps}
        isDragging={draggingId === a.id}
        draggable={isDraggableCard}
        highlighted={highlightedId === a.id}
        onCardDragStart={(e) => handleDragStart(a, e)}
        onCardDragEnd={handleDragEnd}
        onCardTouchStart={isDraggableCard ? (e) => handleCardTouchStart(a, e) : undefined}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <PlatformHeader
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        title="Loading dashboard · v2"
        currentPath="/v2/logistics/loading"
      />

      <div className="flex-1 w-full max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-xl font-semibold text-text">Loading dashboard</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-md border border-[var(--input-border)] overflow-hidden">
              <button
                type="button"
                onClick={() => handleSetView("overview")}
                className="h-8 px-3.5 text-xs font-semibold cursor-pointer transition-colors"
                style={
                  view === "overview"
                    ? { background: "var(--accent)", color: "var(--bg)" }
                    : { background: "var(--surface)", color: "var(--muted)" }
                }
              >
                Overview
              </button>
              <button
                type="button"
                onClick={() => handleSetView("team")}
                className="h-8 px-3.5 text-xs font-semibold cursor-pointer transition-colors"
                style={
                  view === "team"
                    ? { background: "var(--accent)", color: "var(--bg)" }
                    : { background: "var(--surface)", color: "var(--muted)" }
                }
              >
                Loading Team View
              </button>
            </div>
            {view === "team" && selectedBayId !== null && (
              <select
                value={selectedBayId}
                onChange={(e) => setSelectedBayId(e.target.value)}
                className="h-8 px-2.5 rounded-md border border-[var(--input-border)] bg-[var(--card-bg)] text-text text-xs"
              >
                {bays.map((b) => (
                  <option key={b.id} value={b.id}>
                    Bay {b.bay_number}
                  </option>
                ))}
              </select>
            )}
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="INV#, customer, or PO"
              autoComplete="off"
              className="h-8 px-2.5 rounded-md border border-[var(--input-border)] bg-[var(--card-bg)] text-text text-xs"
              style={{ minWidth: 180 }}
            />
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="h-8 px-3 rounded-md border border-[var(--input-border)] bg-[var(--card-bg)] text-text text-xs font-semibold cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
            >
              {showAll ? "Show all" : "This week"}
            </button>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as LdSortOrder)}
              className="h-8 px-2.5 rounded-md border border-[var(--input-border)] bg-[var(--card-bg)] text-text text-xs cursor-pointer"
            >
              <option value="inv_asc">INV# ↑</option>
              <option value="inv_desc">INV# ↓</option>
              <option value="date_asc">Date added</option>
            </select>
            {canManage && (
              <button
                type="button"
                onClick={() => setPullJobOpen(true)}
                className="min-h-[44px] px-3.5 rounded-md bg-[var(--primary-bg)] text-[var(--primary-text)] text-xs font-semibold cursor-pointer hover:opacity-90 transition-opacity"
              >
                + Pull Job
              </button>
            )}
          </div>
        </div>

        {loadError && (
          <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3">
            {loadError}
            <button type="button" onClick={() => load()} className="ml-3 underline cursor-pointer">
              Retry
            </button>
          </div>
        )}
        {actionError && (
          <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3">
            {actionError}
          </div>
        )}

        {loading && !loadError && <p className="text-sm text-muted">Loading dock board…</p>}

        {!loading && !loadError && view === "team" && (
          <TeamView
            bays={bays}
            assignments={set}
            sortOrder={sortOrder}
            selectedBayId={selectedBayId}
            onSelectBay={setSelectedBayId}
            cardHandlers={cardHandlers}
            highlightedId={highlightedId}
          />
        )}

        {!loading && !loadError && view === "overview" && (
          <>
            <section className="space-y-2">
              <h2
                onClick={() => toggleSection("awaiting")}
                className="text-xs font-semibold uppercase tracking-wide text-muted cursor-pointer select-none flex items-center gap-2"
              >
                <span aria-hidden="true">{collapsedSections.awaiting ? "▸" : "▾"}</span>
                Awaiting trailer assignment
              </h2>
              {!collapsedSections.awaiting && (
                <div
                  data-queue-drop="true"
                  className={`space-y-2 rounded-xl p-2 transition-colors ${
                    draggingId && canManage
                      ? dragOverTarget === "awaiting"
                        ? "border-2 border-dashed border-[var(--primary-bg)] bg-[var(--primary-bg)]/5"
                        : "border-2 border-dashed border-[var(--line)]"
                      : "border-2 border-transparent"
                  }`}
                  onDragOver={draggingId && canManage ? (e) => handleDragOver("awaiting", e) : undefined}
                  onDragLeave={draggingId && canManage ? () => setDragOverTarget(null) : undefined}
                  onDrop={draggingId && canManage ? (e) => handleDrop("awaiting", e) : undefined}
                >
                  {awaiting.length === 0 ? (
                    <p className="text-sm text-text-faint italic px-1">Nothing waiting on a bay.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {awaiting.map((a) => (
                        <div key={a.id} className="w-[230px] max-w-full shrink-0">
                          {renderCard(a)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted px-2">Bays</h2>
              {bays.length === 0 ? (
                <p className="text-sm text-text-faint italic px-3">No bays configured.</p>
              ) : (
                <div className="overflow-x-auto pb-2 px-2">
                  <div className="grid grid-cols-1 md:grid-cols-6 gap-3 min-w-0 md:min-w-[1320px]">
                    {bays.map((bay) => {
                      const bayAssignments = sortAssignments(
                        set.filter((a) => a.bay_id === bay.id && BAY_ACTIVE_STATUSES.includes(a.loading_status)),
                        sortOrder
                      );
                      const isDragOver = dragOverTarget === bay.id;
                      return (
                        <div
                          key={bay.id}
                          data-bay-drop-id={bay.id}
                          className={`rounded-xl border flex flex-col min-w-0 transition-colors ${
                            draggingId
                              ? isDragOver
                                ? "border-2 border-dashed border-[var(--primary-bg)] bg-[var(--primary-bg)]/5"
                                : "border-2 border-dashed border-[var(--line)] bg-[var(--surface-2)]/50"
                              : "border-[var(--line)] bg-[var(--surface-2)]"
                          }`}
                          onDragOver={draggingId ? (e) => handleDragOver(bay.id, e) : undefined}
                          onDragLeave={draggingId ? () => setDragOverTarget(null) : undefined}
                          onDrop={draggingId ? (e) => handleDrop(bay.id, e) : undefined}
                        >
                          <div className="p-2 border-b border-[var(--line)] text-center font-bold text-sm text-text">
                            Bay {bay.bay_number}
                          </div>
                          <div className="p-2 space-y-1.5 min-h-[150px]">
                            {bayAssignments.length === 0 ? (
                              <p className="text-xs text-text-faint italic text-center py-6">Empty</p>
                            ) : (
                              bayAssignments.map((a) => (
                                <div key={a.id}>{renderCard(a)}</div>
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-2 px-2">
              <h2
                onClick={() => toggleSection("yard")}
                className="text-xs font-semibold uppercase tracking-wide text-muted cursor-pointer select-none flex items-center gap-2"
              >
                <span aria-hidden="true">{collapsedSections.yard ? "▸" : "▾"}</span>
                Yard
              </h2>
              {!collapsedSections.yard &&
                (yard.length === 0 ? (
                  <p className="text-sm text-text-faint italic px-1">No trailers in the yard.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {yard.map((a) => (
                      <div key={a.id} className="w-[230px] max-w-full shrink-0">
                        {renderCard(a)}
                      </div>
                    ))}
                  </div>
                ))}
            </section>

            <section className="space-y-2 px-2">
              <h2
                onClick={() => toggleSection("transit")}
                className="text-xs font-semibold uppercase tracking-wide text-muted cursor-pointer select-none flex items-center gap-2"
              >
                <span aria-hidden="true">{collapsedSections.transit ? "▸" : "▾"}</span>
                In transit
              </h2>
              {!collapsedSections.transit &&
                (transit.length === 0 ? (
                  <p className="text-sm text-text-faint italic px-1">Nothing in transit.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {transit.map((a) => (
                      <div key={a.id} className="w-[230px] max-w-full shrink-0">
                        {renderCard(a)}
                      </div>
                    ))}
                  </div>
                ))}
            </section>

            <section className="space-y-2 px-2">
              <h2
                onClick={() => toggleSection("delivered")}
                className="text-xs font-semibold uppercase tracking-wide text-muted cursor-pointer select-none flex items-center gap-2"
              >
                <span aria-hidden="true">{collapsedSections.delivered ? "▸" : "▾"}</span>
                Delivered
              </h2>
              {!collapsedSections.delivered &&
                (delivered.length === 0 ? (
                  <p className="text-sm text-text-faint italic px-1">Nothing delivered yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {delivered.map((a) => (
                      <div key={a.id} className="w-[230px] max-w-full shrink-0">
                        {renderCard(a, { showArchive: true })}
                      </div>
                    ))}
                  </div>
                ))}
            </section>
          </>
        )}
      </div>

      {bayModalTarget && (
        <AssignBayModal bays={bays} onClose={() => setBayModalTarget(null)} onConfirm={confirmAssignBay} />
      )}

      <LoadedChecklistModal
        assignment={checklistTarget}
        onClose={() => setChecklistTarget(null)}
        onDone={() => {
          setChecklistTarget(null);
          load();
        }}
      />

      <BolViewerModal
        jobId={viewerTarget?.jobId ?? null}
        loadNumber={viewerTarget?.loadNumber ?? null}
        viewOnly
        onClose={() => setViewerTarget(null)}
        onEdit={() => {
          /* view-only on the dock dashboard -- Edit is unreachable (viewOnly hides the button) */
        }}
      />

      <ShippingInfoModal
        assignment={shippingInfoTarget}
        jobCache={jobCacheRef.current}
        onClose={() => setShippingInfoTarget(null)}
      />

      {pullJobOpen && (
        <PullJobModal
          bays={bays}
          assignments={assignments}
          defaultBayId={view === "team" && selectedBayId !== null ? selectedBayId : null}
          onClose={() => setPullJobOpen(false)}
          onDone={() => {
            setPullJobOpen(false);
            load();
          }}
        />
      )}

      <PhotoGalleryModal jobId={photoGalleryJobId} onClose={() => setPhotoGalleryJobId(null)} />
    </div>
  );
}
