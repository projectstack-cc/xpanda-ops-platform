"use client";
// src/components/board/OrderDetailModal.tsx
// P439 — restored read-only modal. The P439 broader /v2/api/board/:id GET still returns the
// `shifts` and `processes` arrays on the job (for the OrderEditModal to consume), but this
// modal ignores them — its surface is the read-only shipping / line items / cut-list /
// packing-slip viewer. Opens from the "View" button in /v2/board and from a click on the
// schedule desk's order cell.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import Modal from "@/components/Modal";
import PdfViewer from "@/components/PdfViewer";
import { buildCutListPdf, type CutListLineItem } from "@/lib/cutList";

interface DetailJob {
  id: string;
  customer: string | null;
  invoice_number: string | null;
  status: string;
  ship_date: string | null;
  carrier: string | null;
  ship_to_company: string | null;
  ship_to_attention: string | null;
  ship_to_street: string | null;
  ship_to_street2: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  has_packing_slip: boolean;
}

interface DetailResponse {
  ok: boolean;
  error?: string;
  job?: DetailJob;
  line_items?: CutListLineItem[];
}

interface OrderDetailModalProps {
  jobId: string | null;
  onClose: () => void;
}

type CutListDoc = { src: string; filename: string } | null;

export default function OrderDetailModal({ jobId, onClose }: OrderDetailModalProps) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [slipOpen, setSlipOpen] = useState(false);
  const [cutListOpen, setCutListOpen] = useState(false);
  const [cutListLoading, setCutListLoading] = useState(false);
  const [cutListDoc, setCutListDoc] = useState<CutListDoc>(null);
  const [cutListError, setCutListError] = useState<string | null>(null);
  const cutListBlobUrlRef = useRef<string | null>(null);

  // Reset per job-context change (opening a different order, or closing) — mirrors legacy
  // clearForm()-on-openModal(): revoke any previous cut-list blob and collapse both viewers so
  // the next order starts clean. Deliberately keyed on `jobId` alone (not `data`) so a later
  // refetch of the same job can't silently revoke a blob URL out from under a cut list the user
  // is actively viewing.
  useEffect(() => {
    if (cutListBlobUrlRef.current) {
      try { URL.revokeObjectURL(cutListBlobUrlRef.current); } catch {}
      cutListBlobUrlRef.current = null;
    }
    setCutListError(null);
    setCutListDoc(null);
    setCutListOpen(false);
    setSlipOpen(false);

    if (!jobId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setData(null);
    fetch(`/v2/api/board/${jobId}`)
      .then((res) => res.json())
      .then((json: DetailResponse) => {
        if (cancelled) return;
        setData(json);
      })
      .catch(() => {
        if (!cancelled) setData({ ok: false, error: "Network error — couldn't reach the server." });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  // Toggles the cut-list section open/closed; builds the PDF lazily on first open only (mirrors
  // legacy's `{ once: true }` load-on-first-click), so re-toggling never rebuilds or re-touches
  // the packing-slip viewer's own state.
  async function handleToggleCutList() {
    const opening = !cutListOpen;
    setCutListOpen(opening);
    if (!opening || cutListDoc || !data?.job) return;
    setCutListLoading(true);
    setCutListError(null);
    try {
      const pdfBytes = await buildCutListPdf({ ...data.job, line_items: data.line_items ?? [] });
      const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
      if (cutListBlobUrlRef.current) {
        try { URL.revokeObjectURL(cutListBlobUrlRef.current); } catch {}
      }
      const url = URL.createObjectURL(blob);
      cutListBlobUrlRef.current = url;
      setCutListDoc({ src: url, filename: `cut-list-${data.job.invoice_number || data.job.id}.pdf` });
    } catch (e) {
      console.error("Cut list PDF failed:", e);
      setCutListError("Couldn't generate the cut list. Please try again.");
    } finally {
      setCutListLoading(false);
    }
  }

  const job = data?.job;
  const slipDoc = job?.has_packing_slip
    ? { src: `/api/jobs/${job.id}/packing-slip`, filename: `packing-slip-${job.id}.pdf` }
    : null;

  return (
    <Modal isOpen={!!jobId} onClose={onClose} title={job ? job.customer || "Order detail" : "Order detail"} size="xl">
      {loading && <p className="text-sm text-muted py-4">Loading order…</p>}

      {!loading && data && !data.ok && (
        <p className="text-sm text-[var(--warn-text)] py-4">{data.error || "Couldn't load this order."}</p>
      )}

      {!loading && job && (
        <div className="space-y-4 max-h-[75vh] overflow-y-auto -mx-2 px-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>{job.invoice_number ? `INV# ${job.invoice_number}` : "No INV#"}</span>
            {job.ship_to_city && (
              <span>
                {job.ship_to_city}
                {job.ship_to_state ? `, ${job.ship_to_state}` : ""}
              </span>
            )}
            {job.ship_date && <span>Ship {job.ship_date}</span>}
          </div>

          {(job.ship_to_company || job.ship_to_street || job.ship_to_city || job.carrier) && (
            <div className="rounded-lg border border-[var(--card-border)] p-3 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">Shipping</div>
              <div className="text-text leading-snug">
                {job.ship_to_company && <div className="font-medium">{job.ship_to_company}</div>}
                {job.ship_to_attention && <div className="text-muted">{job.ship_to_attention}</div>}
                {job.ship_to_street && <div>{job.ship_to_street}</div>}
                {job.ship_to_street2 && <div>{job.ship_to_street2}</div>}
                {(job.ship_to_city || job.ship_to_state || job.ship_to_zip) && (
                  <div>
                    {job.ship_to_city}
                    {job.ship_to_state ? `, ${job.ship_to_state}` : ""}
                    {job.ship_to_zip ? ` ${job.ship_to_zip}` : ""}
                  </div>
                )}
              </div>
              {job.carrier && (
                <div className="mt-2 text-muted">
                  <span className="text-xs font-semibold uppercase tracking-wide">Carrier</span> {job.carrier}
                </div>
              )}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-[var(--card-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-xs font-semibold text-muted">
                  <th className="px-3 py-2">Part #</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2">Dimensions</th>
                  <th className="px-3 py-2">Density</th>
                </tr>
              </thead>
              <tbody>
                {(data?.line_items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-sm text-muted">
                      No line items.
                    </td>
                  </tr>
                )}
                {(data?.line_items ?? []).map((li, i) => (
                  <tr key={i} className="border-b border-[var(--line)] last:border-0">
                    <td className="px-3 py-2 font-medium text-text">{li.part_number || "Foam"}</td>
                    <td className="px-3 py-2 text-muted">{li.description || "—"}</td>
                    <td className="px-3 py-2 text-right text-muted tabular-nums">{li.quantity ?? 0}</td>
                    <td className="px-3 py-2 text-muted">{li.dimensions || "—"}</td>
                    <td className="px-3 py-2 text-muted">{li.density || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Packing Slip — independent dropdown-link viewer, own PdfViewer instance/state */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setSlipOpen((v) => !v)}
              disabled={!slipDoc}
              className="flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-[var(--link)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              aria-expanded={slipOpen}
            >
              {slipOpen ? (
                <ChevronDown size={16} className="shrink-0" aria-hidden="true" />
              ) : (
                <ChevronRight size={16} className="shrink-0" aria-hidden="true" />
              )}
              Packing Slip
            </button>
            {!slipDoc && <p className="text-sm text-muted">No packing slip attached.</p>}
            {slipOpen && slipDoc && (
              <PdfViewer src={slipDoc.src} filename={slipDoc.filename} title="Packing slip" />
            )}
          </div>

          {/* Cut List — independent dropdown-link viewer, own PdfViewer instance/state; builds
              lazily on first open and never touches the packing-slip viewer above. */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleToggleCutList}
              disabled={cutListLoading}
              className="flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-[var(--link)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              aria-expanded={cutListOpen}
            >
              {cutListOpen ? (
                <ChevronDown size={16} className="shrink-0" aria-hidden="true" />
              ) : (
                <ChevronRight size={16} className="shrink-0" aria-hidden="true" />
              )}
              {cutListLoading ? "Generating Cut List…" : "Cut List"}
            </button>
            {cutListOpen && cutListDoc && (
              <PdfViewer src={cutListDoc.src} filename={cutListDoc.filename} title="Cut list" />
            )}
            {cutListError && <p className="text-sm text-[var(--warn-text)]">{cutListError}</p>}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)]"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
