"use client";
// src/components/board/OrderDetailModal.tsx
// Order-detail modal for a production-board row: line items, embedded packing slip (legacy
// R2/base64-backed PDF, same host, no new v2 endpoint), and a "Print cut list" button reusing
// the prompt-328/329 generator ported to src/lib/cutList.ts.
import { useEffect, useRef, useState } from "react";
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

type ViewerDoc = { src: string; filename: string; kind: "slip" | "cutlist" } | null;

export default function OrderDetailModal({ jobId, onClose }: OrderDetailModalProps) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [viewerDoc, setViewerDoc] = useState<ViewerDoc>(null);
  const [cutListError, setCutListError] = useState<string | null>(null);
  const cutListBlobUrlRef = useRef<string | null>(null);

  // Reset per job-context change (opening a different order, or closing) — mirrors legacy
  // clearForm()-on-openModal(): revoke any previous cut-list blob and default the shared viewer
  // back to the packing slip once the new job's data resolves. Deliberately keyed on `jobId`
  // alone (not `data`) so a later refetch of the same job can't silently revoke a blob URL out
  // from under a cut list the user is actively viewing.
  useEffect(() => {
    if (cutListBlobUrlRef.current) {
      try { URL.revokeObjectURL(cutListBlobUrlRef.current); } catch {}
      cutListBlobUrlRef.current = null;
    }
    setCutListError(null);
    setViewerDoc(null);

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
        if (json.ok && json.job) {
          setViewerDoc(
            json.job.has_packing_slip
              ? { src: `/api/jobs/${json.job.id}/packing-slip`, filename: `packing-slip-${json.job.id}.pdf`, kind: "slip" }
              : null
          );
        }
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

  async function handlePrintCutList() {
    if (!data?.job) return;
    setPrinting(true);
    setCutListError(null);
    try {
      const pdfBytes = await buildCutListPdf({ ...data.job, line_items: data.line_items ?? [] });
      const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
      if (cutListBlobUrlRef.current) {
        try { URL.revokeObjectURL(cutListBlobUrlRef.current); } catch {}
      }
      const url = URL.createObjectURL(blob);
      cutListBlobUrlRef.current = url;
      setViewerDoc({ src: url, filename: `cut-list-${data.job.invoice_number || data.job.id}.pdf`, kind: "cutlist" });
    } catch (e) {
      console.error("Cut list PDF failed:", e);
      setCutListError("Couldn't generate the cut list. Please try again.");
    } finally {
      setPrinting(false);
    }
  }

  const job = data?.job;

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

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-text">
              {viewerDoc?.kind === "cutlist" ? "Cut list" : "Packing slip"}
            </h3>
            {viewerDoc ? (
              <PdfViewer
                src={viewerDoc.src}
                filename={viewerDoc.filename}
                title={viewerDoc.kind === "cutlist" ? "Cut list" : "Packing slip"}
              />
            ) : (
              <p className="text-sm text-muted">No packing slip attached.</p>
            )}
            {cutListError && (
              <p className="text-sm text-[var(--warn-text)]">{cutListError}</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)]"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handlePrintCutList}
              disabled={printing}
              className="min-h-[44px] px-4 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {printing ? "Printing…" : "Print cut list"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
