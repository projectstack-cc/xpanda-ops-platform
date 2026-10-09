"use client";
// src/components/logistics/BolViewerModal.tsx
// Replaces legacy's viewBolForJob (logistics/index.html:978-1027). Renders the same combined
// packet Generate produces — original -> driver -> customer passes — via PdfViewer.
//
// Bug 1 fix (frozen trailer number): legacy renders the stored row's `trailer_no` verbatim,
// which is empty whenever the dock assigns a trailer AFTER the BOL was generated. This modal
// re-enriches every load's trailer live from GET /v2/api/loading-assignments?job_id= on every
// open, overriding the stored value for display. A null-load_number BOL (legacy/manual, always
// single-load) falls back to the job's sole assignment — mirrors api/carrier/route.ts's same
// join shape — so legacy rows enrich too, not only newly-generated ones.
//
// Bug 2 fix (stale lock state): lock state is computed from a FRESH fetch of this job's
// shipment row on every open (never from a list already sitting in a parent's state), so a
// status change that happened after the dashboard's last poll is reflected immediately.
//
// Side effect of the Bug 1 fix worth naming: `onEdit` is handed the live-enriched `bols` (trailer
// number overwritten from the dock assignment), and BolEditorModal's PUT sends the full row back
// -- so any edit-and-save on a BOL also heals its stored `trailer_no` to the current dock value.
// Legacy has no equivalent (it edits the frozen stored value in place); this is a deliberate,
// desirable improvement, not a bug, but it is new behavior worth calling out.
//
// BOL-history delete: a per-BOL list with a two-step arm/confirm delete (PartsLibraryPanel.tsx's
// own pattern, not window.confirm()), gated on `canManageLoading` -- mirrors legacy's single-BOL
// DELETE gate (admin OR logistics.loading.manage edit). Only ShipmentDashboard.tsx passes
// `canManageLoading`; DockBoard.tsx's read-only call (`viewOnly`) never does, so the list stays
// hidden there regardless. `historyBols` is deliberately a SEPARATE state from `bols` -- `bols` is
// sometimes narrowed to one load via `loadNumber` for the PDF preview, but the history list always
// needs the job's full BOL set. `onDeleted` is a NEW, additive callback (not a widened `onClose`)
// so DockBoard.tsx's call site, which never deletes, needs no change.
//
// lgx-review-01: optional `reviewMode` restores legacy's post-generate review step
// (bol-compose.js reviewRecords/rrShow). ShipmentDashboard opens the viewer in review mode right
// after BolGenerateModal saves: title becomes "Review BOL", the BOL-history delete list is hidden,
// and a footer offers "Make Changes" (same onEdit path as the Edit BOL button) and "Approve"
// (onApprove -> close + parent refresh). The BOLs are already persisted at this point, so Make
// Changes is the normal BolEditorModal PUT -- no separate pre-save path.
import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Trash2 } from "lucide-react";
import Modal from "@/components/Modal";
import PdfViewer from "@/components/PdfViewer";
import { buildCombinedBolPdf } from "@/lib/bolDomGlue";
import type { BolRecord } from "@/lib/bolShared";
import type { LoadingAssignmentForJob } from "./types";
import { isBolLocked } from "@/lib/logistics/bolLock";


interface BolViewerModalProps {
  jobId: string | null;
  onClose: () => void;
  onEdit: (bols: BolRecord[], jobId: string, index: number) => void;
  // Loading v2 unit 3b reuse: legacy's viewBolForJob(jobId, loadNumber) shows only the ONE
  // load's BOL, not the job's combined packet. When set, filter to that load before building
  // the PDF (falls back to the job's sole BOL when load_number is null/unmatched, same rule
  // BolGenerateModal/legacy use for legacy single-load BOLs predating the load_number field).
  loadNumber?: number | null;
  // Loading v2 unit 3b reuse: the dock dashboard's View BOL is read-only (§Locked scope) --
  // hides the Edit button regardless of lock state. Unit 2's shipment dashboard omits this
  // (defaults to false) and keeps its existing edit affordance.
  viewOnly?: boolean;
  /** Shows the BOL-history delete list when true. Only ShipmentDashboard.tsx passes this. */
  canManageLoading?: boolean;
  /** Called after a successful BOL delete so the parent dashboard can refetch (bol_count/
   * bol_number would otherwise go stale). Additive -- does not replace onClose. */
  onDeleted?: () => void;
  /** lgx-review-01: post-generate review step. Changes the title, hides BOL history, and shows a
   * Make Changes / Approve footer. Only ShipmentDashboard.tsx passes this. */
  reviewMode?: boolean;
  /** lgx-review-01: Approve in review mode. Falls back to onClose when omitted. */
  onApprove?: () => void;
}

export default function BolViewerModal({
  jobId,
  onClose,
  onEdit,
  loadNumber = null,
  viewOnly = false,
  canManageLoading = false,
  onDeleted,
  reviewMode = false,
  onApprove,
}: BolViewerModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [bols, setBols] = useState<BolRecord[]>([]);
  const [historyBols, setHistoryBols] = useState<BolRecord[]>([]);
  const [locked, setLocked] = useState(false);
  // bol-lock-01: displayed BOLs whose load has not shipped (per-load lock, see bolLock.ts).
  const [editableBols, setEditableBols] = useState<BolRecord[]>([]);
  const [lockedLoads, setLockedLoads] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirmDeleteBolId, setConfirmDeleteBolId] = useState<string | null>(null);
  const [deletingBolId, setDeletingBolId] = useState<string | null>(null);
  const [deleteFenced, setDeleteFenced] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (blobUrlRef.current) {
      try {
        URL.revokeObjectURL(blobUrlRef.current);
      } catch {
        // already revoked
      }
      blobUrlRef.current = null;
    }
    setSrc(null);
    setError(null);
    setBols([]);
    setHistoryBols([]);
    setLocked(false);
    setEditableBols([]);
    setLockedLoads([]);
    setConfirmDeleteBolId(null);
    setDeletingBolId(null);
    setDeleteFenced(false);
    setDeleteError(null);
    if (!jobId) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const [bolsJson, laJson, shipJson] = await Promise.all([
          fetch(`/v2/api/bols?job_id=${encodeURIComponent(jobId)}`).then((r) => r.json()),
          fetch(`/v2/api/loading-assignments?job_id=${encodeURIComponent(jobId)}`).then((r) => r.json()),
          fetch(`/v2/api/shipments?job_id=${encodeURIComponent(jobId)}`).then((r) => r.json()),
        ]);
        if (cancelled) return;

        if (!bolsJson.ok || !Array.isArray(bolsJson.bols) || bolsJson.bols.length === 0) {
          setError("No BOL found for this job.");
          return;
        }

        // Dedupe to the latest BOL per load_number (regenerations can leave stale rows); a null
        // load_number keys under 0 and is still included, same rule as legacy.
        const byLoad = new Map<number, BolRecord>();
        for (const b of bolsJson.bols as BolRecord[]) {
          const ln = b.load_number != null ? Number(b.load_number) : 0;
          const prev = byLoad.get(ln);
          if (!prev || String(b.created_at || "") > String(prev.created_at || "")) byLoad.set(ln, b);
        }
        const sorted = Array.from(byLoad.keys())
          .sort((a, b) => a - b)
          .map((k) => byLoad.get(k)!);

        const assignments: LoadingAssignmentForJob[] = laJson.ok && Array.isArray(laJson.assignments) ? laJson.assignments : [];
        const trailerByLoad = new Map<number, string>();
        for (const a of assignments) {
          if (a.load_number != null && a.trailer_number) trailerByLoad.set(Number(a.load_number), a.trailer_number);
        }
        const soleAssignmentTrailer = assignments.length === 1 ? assignments[0].trailer_number : null;

        const enrichedAll = sorted.map((b) => {
          const ln = b.load_number != null ? Number(b.load_number) : null;
          const live = ln != null ? trailerByLoad.get(ln) : (soleAssignmentTrailer ?? undefined);
          return live ? { ...b, trailer_no: live } : b;
        });

        // Filter to a single load when requested (dock dashboard's per-load View BOL). Mirrors
        // legacy's viewBolForJob(jobId, loadNumber) fallback exactly: exact load_number match,
        // else the job's sole BOL (a legacy/manual BOL predating load_number), else no match.
        let enriched = enrichedAll;
        if (loadNumber != null) {
          const exact = enrichedAll.filter((b) => Number(b.load_number) === Number(loadNumber));
          if (exact.length) {
            enriched = exact;
          } else if (enrichedAll.length === 1) {
            enriched = enrichedAll;
          } else {
            setError("No BOL found for this load.");
            return;
          }
        }
        setBols(enriched);
        setHistoryBols(enrichedAll);

        const shipRow = shipJson.ok && Array.isArray(shipJson.data) ? shipJson.data[0] : null;
        // bol-lock-01: lock per load, not per job. Same rule as the PUT (bolLock.ts).
        const statusByLoad = new Map<number, string | null>();
        for (const a of assignments) {
          if (a.load_number == null || a.loading_status === "archived") continue;
          statusByLoad.set(Number(a.load_number), a.loading_status ?? null);
        }
        const shipStatus = shipRow ? String(shipRow.status) : null;
        const bolIsLocked = (b: BolRecord) => {
          const ln = b.load_number != null && String(b.load_number) !== "" ? Number(b.load_number) : null;
          return isBolLocked({
            loadNumber: ln,
            assignmentStatus: ln != null ? statusByLoad.get(ln) : null,
            shipmentStatus: shipStatus,
          });
        };
        const editable = enriched.filter((b) => !bolIsLocked(b));
        setEditableBols(editable);
        setLockedLoads(enriched.filter(bolIsLocked).map((b, i) => String(b.load_number ?? i + 1)));
        setLocked(editable.length === 0);

        const bytes = await buildCombinedBolPdf(enriched);
        if (cancelled) return;
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
        blobUrlRef.current = url;
        setSrc(url);
      } catch {
        if (!cancelled) setError("Could not load the BOL.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId, loadNumber, refreshKey]);

  // Revoke on unmount too, not just on job-context change.
  useEffect(
    () => () => {
      if (blobUrlRef.current) {
        try {
          URL.revokeObjectURL(blobUrlRef.current);
        } catch {
          // already revoked
        }
      }
    },
    []
  );

  async function handleDeleteBol(bolId: string) {
    setDeleteError(null);
    setDeleteFenced(false);
    setDeletingBolId(bolId);
    try {
      const res = await fetch(`/v2/api/bols/${encodeURIComponent(bolId)}`, { method: "DELETE" });
      const data = await res.json();

      if (res.status === 501) {
        setDeleteFenced(true);
        setConfirmDeleteBolId(null);
        return;
      }
      if (!res.ok || !data.ok) {
        setDeleteError(data.detail || data.error || `HTTP ${res.status}`);
        return;
      }

      setConfirmDeleteBolId(null);
      onDeleted?.();
      setRefreshKey((k) => k + 1);
    } catch {
      setDeleteError("Network error — could not delete.");
    } finally {
      setDeletingBolId(null);
    }
  }

  return (
    <Modal isOpen={!!jobId} onClose={onClose} title={reviewMode ? "Review BOL" : "Bill of Lading"} size="xl">
      {loading && <p className="text-sm text-muted py-6 text-center">Building BOL preview…</p>}

      {error && !loading && (
        <p className="text-sm text-[var(--danger-text)] py-6 text-center">{error}</p>
      )}

      {!loading && !error && src && (
        <div className="space-y-3">
          {!viewOnly && !reviewMode && canManageLoading && historyBols.length > 0 && (
            <div className="rounded-md border border-[var(--border)] bg-[var(--ghost-bg)] p-3 space-y-2">
              <div className="text-xs font-semibold text-muted uppercase tracking-wider">BOL History</div>
              {deleteFenced && (
                <p className="text-xs text-[var(--warn-text)]">
                  Deleting is disabled in the v2 preview phase.
                </p>
              )}
              {deleteError && <p className="text-xs text-[var(--danger-text)]">{deleteError}</p>}
              <div className="space-y-1.5">
                {historyBols.map((b) => {
                  const bolId = String(b.id);
                  const isConfirming = confirmDeleteBolId === bolId;
                  const isDeleting = deletingBolId === bolId;
                  return (
                    <div key={bolId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-text truncate">
                        {b.load_number != null ? `Load ${b.load_number} — ` : ""}
                        BOL {b.bol_number || bolId}
                        {b.date ? ` · ${b.date}` : ""}
                        {b.carrier_name ? ` · ${b.carrier_name}` : ""}
                      </span>
                      {isConfirming ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleDeleteBol(bolId)}
                            disabled={isDeleting}
                            className="px-2 py-1 rounded-md text-xs font-semibold bg-[var(--danger-bg)] text-white cursor-pointer disabled:opacity-50"
                          >
                            {isDeleting ? "Deleting…" : "Confirm"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteBolId(null)}
                            disabled={isDeleting}
                            className="px-2 py-1 rounded-md text-xs font-semibold border border-[var(--border)] text-text cursor-pointer disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteBolId(bolId)}
                          className="p-1.5 rounded-md text-[var(--danger-text)] hover:bg-[color-mix(in_srgb,var(--danger-bg)_10%,transparent)] cursor-pointer shrink-0"
                          aria-label={`Delete BOL ${b.bol_number || bolId}`}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {editableBols.length > 0 && !viewOnly && !reviewMode && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => jobId && onEdit(editableBols, jobId, 0)}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-md border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-text cursor-pointer hover:bg-[var(--ghost-bg)]"
              >
                <Pencil size={14} aria-hidden="true" />
                Edit BOL
              </button>
            </div>
          )}
          {locked && (
            <p className="text-xs text-muted">This load has shipped — the BOL is read-only.</p>
          )}
          {!locked && lockedLoads.length > 0 && (
            <p className="text-xs text-muted">
              Loads {lockedLoads.join(", ")} have shipped — their BOLs are read-only. Edit applies to the remaining loads.
            </p>
          )}
          <PdfViewer src={src} filename={`BOL_${bols[0]?.bol_number || jobId}.pdf`} title="Bill of Lading" height={560} />
          {reviewMode && (
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
              {editableBols.length > 0 && !viewOnly && (
                <button
                  type="button"
                  onClick={() => jobId && onEdit(editableBols, jobId, 0)}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold text-text cursor-pointer hover:bg-[var(--ghost-bg)]"
                >
                  <Pencil size={15} aria-hidden="true" />
                  Make Changes
                </button>
              )}
              <button
                type="button"
                onClick={() => (onApprove ? onApprove() : onClose())}
                className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-md bg-[var(--brand)] text-sm font-semibold text-white cursor-pointer hover:opacity-90"
              >
                <Check size={15} aria-hidden="true" />
                Approve
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
