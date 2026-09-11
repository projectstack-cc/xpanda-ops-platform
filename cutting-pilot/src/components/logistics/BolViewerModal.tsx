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
import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import Modal from "@/components/Modal";
import PdfViewer from "@/components/PdfViewer";
import { buildCombinedBolPdf } from "@/lib/bolDomGlue";
import type { BolRecord } from "@/lib/bolShared";
import type { LoadingAssignmentForJob } from "./types";

const BOL_LOCKED_STATUSES = ["in_transit", "delivered", "archived", "cancelled"];

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
}

export default function BolViewerModal({ jobId, onClose, onEdit, loadNumber = null, viewOnly = false }: BolViewerModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [bols, setBols] = useState<BolRecord[]>([]);
  const [locked, setLocked] = useState(false);
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
    setLocked(false);
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

        const shipRow = shipJson.ok && Array.isArray(shipJson.data) ? shipJson.data[0] : null;
        setLocked(!!(shipRow && BOL_LOCKED_STATUSES.includes(String(shipRow.status))));

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
  }, [jobId, loadNumber]);

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

  return (
    <Modal isOpen={!!jobId} onClose={onClose} title="Bill of Lading" size="xl">
      {loading && <p className="text-sm text-muted py-6 text-center">Building BOL preview…</p>}

      {error && !loading && (
        <p className="text-sm text-[var(--danger-text)] py-6 text-center">{error}</p>
      )}

      {!loading && !error && src && (
        <div className="space-y-3">
          {!locked && !viewOnly && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => jobId && onEdit(bols, jobId, 0)}
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
          <PdfViewer src={src} filename={`BOL_${bols[0]?.bol_number || jobId}.pdf`} title="Bill of Lading" height={560} />
        </div>
      )}
    </Modal>
  );
}
