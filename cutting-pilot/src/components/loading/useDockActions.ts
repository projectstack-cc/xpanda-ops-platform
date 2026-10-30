"use client";
// src/components/loading/useDockActions.ts
// dock-07: every dock-board mutation handler + the modal-target state they drive, extracted
// verbatim from app/logistics/loading/DockBoard.tsx so Overview, Team View and the Bay Pair
// tablet view (dock-08) share one implementation. The host renders the modals via
// DockModalHost, passing the `modals` object returned here.
import { useRef, useState } from "react";
import type { CardActionHandlers, DockAssignment } from "./dockTypes";

interface UseDockActionsArgs {
  assignments: DockAssignment[];
  load: () => unknown;
  canManage: boolean;
  canEditLoading: boolean;
}

export interface DockModalsState {
  bayModalTarget: DockAssignment | null;
  setBayModalTarget: (a: DockAssignment | null) => void;
  confirmAssignBay: (bayId: string) => Promise<void>;
  checklistTarget: DockAssignment | null;
  setChecklistTarget: (a: DockAssignment | null) => void;
  viewerTarget: { jobId: string; loadNumber: number | null } | null;
  setViewerTarget: (t: { jobId: string; loadNumber: number | null } | null) => void;
  shippingInfoTarget: DockAssignment | null;
  setShippingInfoTarget: (a: DockAssignment | null) => void;
  jobCache: Map<string, any>;
  pullJobOpen: boolean;
  setPullJobOpen: (open: boolean) => void;
  photoGalleryJobId: string | null;
  setPhotoGalleryJobId: (jobId: string | null) => void;
  photoAddTarget: { assignmentId: string; jobId: string } | null;
  setPhotoAddTarget: (t: { assignmentId: string; jobId: string } | null) => void;
}

export interface DockActions {
  cardHandlers: CardActionHandlers;
  actionError: string | null;
  moveAssignmentToTarget: (assignmentId: string, targetId: string) => Promise<void>;
  openPullJob: () => void;
  anyModalOpen: boolean;
  modals: DockModalsState;
}

export function useDockActions({ assignments, load, canManage, canEditLoading }: UseDockActionsArgs): DockActions {
  const [actionError, setActionError] = useState<string | null>(null);
  const [bayModalTarget, setBayModalTarget] = useState<DockAssignment | null>(null);
  const [checklistTarget, setChecklistTarget] = useState<DockAssignment | null>(null);
  const [viewerTarget, setViewerTarget] = useState<{ jobId: string; loadNumber: number | null } | null>(null);
  const [shippingInfoTarget, setShippingInfoTarget] = useState<DockAssignment | null>(null);
  const [pullJobOpen, setPullJobOpen] = useState(false);
  const [photoGalleryJobId, setPhotoGalleryJobId] = useState<string | null>(null);
  const [photoAddTarget, setPhotoAddTarget] = useState<{ assignmentId: string; jobId: string } | null>(null);
  const jobCacheRef = useRef<Map<string, any>>(new Map());

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

  // dock-13: also offered on bay cards (not_started / loading / loaded), worded by status.
  async function handleSendBackToQueue(a: DockAssignment) {
    const message =
      a.loading_status === "delivered"
        ? "Send this delivered load back to the awaiting queue?"
        : a.loading_status === "not_started"
          ? `Send this load back to the awaiting queue?${a.bay_number != null ? ` It will leave Bay ${a.bay_number}.` : ""}`
          : "This load has already started loading. Send it back to the awaiting queue? Its loading progress will be cleared.";
    if (!window.confirm(message)) return;
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

  function handleShowShippingInfo(a: DockAssignment) {
    setShippingInfoTarget(a);
  }

  function handleShowPhotos(a: DockAssignment) {
    setPhotoGalleryJobId(a.job_id);
    setPhotoAddTarget(canEditLoading && a.loading_status === "loaded" ? { assignmentId: a.id, jobId: a.job_id } : null);
  }

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
    canAddPhotos: canEditLoading,
  };

  const anyModalOpen =
    bayModalTarget !== null ||
    checklistTarget !== null ||
    viewerTarget !== null ||
    shippingInfoTarget !== null ||
    pullJobOpen ||
    photoGalleryJobId !== null;

  return {
    cardHandlers,
    actionError,
    moveAssignmentToTarget,
    openPullJob: () => setPullJobOpen(true),
    anyModalOpen,
    modals: {
      bayModalTarget,
      setBayModalTarget,
      confirmAssignBay,
      checklistTarget,
      setChecklistTarget,
      viewerTarget,
      setViewerTarget,
      shippingInfoTarget,
      setShippingInfoTarget,
      jobCache: jobCacheRef.current,
      pullJobOpen,
      setPullJobOpen,
      photoGalleryJobId,
      setPhotoGalleryJobId,
      photoAddTarget,
      setPhotoAddTarget,
    },
  };
}
