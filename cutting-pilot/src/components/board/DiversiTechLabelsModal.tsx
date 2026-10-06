"use client";
// src/components/board/DiversiTechLabelsModal.tsx
// jb-04 — DiversiTech bag/bundle labels for the v2 board. Mirrors legacy P444's SKU checklist
// (jobs/index.html openDiversiTechPrintModal), then renders the generated PDF in-app via the shared
// PdfViewer instead of legacy's popup-blocker-prone window.open.
import { useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal";
import PdfViewer from "@/components/PdfViewer";
import {
  buildDiversiTechLabelsPdf,
  diversiTechProductLabel,
  type DiversiTechLineItem,
} from "@/lib/diversitechLabels";

interface DiversiTechLabelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: { ship_date: string | null };
  lineItems: DiversiTechLineItem[];
  /** Used for the download filename: diversitech-labels-<fileKey>.pdf (invoice number or job id). */
  fileKey: string;
}

type LabelsDoc = { src: string; filename: string } | null;

export default function DiversiTechLabelsModal({ isOpen, onClose, job, lineItems, fileKey }: DiversiTechLabelsModalProps) {
  const [checked, setChecked] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [doc, setDoc] = useState<LabelsDoc>(null);
  const blobUrlRef = useRef<string | null>(null);

  function revokeBlob() {
    if (blobUrlRef.current) {
      try { URL.revokeObjectURL(blobUrlRef.current); } catch {}
      blobUrlRef.current = null;
    }
  }

  // Every open starts at step 1 with all SKUs checked (legacy re-renders the checklist per open).
  // Closing revokes the blob URL.
  useEffect(() => {
    revokeBlob();
    setDoc(null);
    setError(null);
    setGenerating(false);
    if (isOpen) setChecked(lineItems.map(() => true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Unmount safety net — never leak a blob URL.
  useEffect(() => () => revokeBlob(), []);

  function setAll(value: boolean) {
    setChecked(lineItems.map(() => value));
  }

  async function handlePrint() {
    setError(null);
    const selected = lineItems.filter((_, i) => checked[i]);
    if (!selected.length) {
      setError("Select at least one SKU.");
      return;
    }
    setGenerating(true);
    try {
      const pdfBytes = await buildDiversiTechLabelsPdf(job, selected);
      const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
      revokeBlob();
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setDoc({ src: url, filename: `diversitech-labels-${fileKey}.pdf` });
    } catch (e) {
      console.error("DiversiTech labels PDF failed:", e);
      setError("Couldn't generate the labels. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  // Back to the checklist from the viewer — the old PDF is dropped so a regenerate never leaks it.
  function handleBack() {
    revokeBlob();
    setDoc(null);
    setError(null);
  }

  const linkBtn =
    "min-h-[44px] px-2 text-sm font-semibold text-[var(--link)] underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-md";
  const ghostBtn =
    "min-h-[44px] px-4 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 disabled:cursor-not-allowed";
  const primaryBtn =
    "min-h-[44px] px-4 rounded-md bg-[var(--primary-bg)] text-[var(--primary-text)] text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={doc ? "DiversiTech labels" : "Select labels to print"} size={doc ? "xl" : "md"}>
      {lineItems.length === 0 ? (
        <>
          <p className="text-sm text-muted">This order has no line items to print labels for.</p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={ghostBtn}>Close</button>
          </div>
        </>
      ) : doc ? (
        <>
          <PdfViewer src={doc.src} filename={doc.filename} title="DiversiTech labels" />
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={handleBack} className={ghostBtn}>Back to SKUs</button>
            <button type="button" onClick={onClose} className={ghostBtn}>Close</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">Uncheck any SKUs that don&apos;t need labels printed.</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setAll(true)} className={linkBtn}>Select All</button>
            <button type="button" onClick={() => setAll(false)} className={linkBtn}>Select None</button>
          </div>
          <div className="rounded-lg border border-[var(--card-border)] divide-y divide-[var(--line)]">
            {lineItems.map((li, i) => (
              <label key={i} className="flex items-center gap-3 min-h-[44px] px-3 text-sm text-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!checked[i]}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setChecked((prev) => prev.map((c, j) => (j === i ? v : c)));
                  }}
                  className="w-5 h-5 shrink-0 cursor-pointer"
                />
                <span>
                  {diversiTechProductLabel(li) || "Untitled"} — Qty:{" "}
                  <span className="font-mono tabular-nums">{Number(li.quantity) || 0}</span>
                </span>
              </label>
            ))}
          </div>
          {error && <p className="text-sm text-[var(--warn-text)]">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className={ghostBtn}>Cancel</button>
            <button type="button" onClick={handlePrint} disabled={generating} className={primaryBtn}>
              {generating ? "Generating labels…" : "Print labels"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
