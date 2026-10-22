"use client";
// src/components/board/LabelChecklistModal.tsx
// jb-12 — generic "SKU checklist → PdfViewer" label modal for the v2 board, extracted unchanged in
// behaviour from jb-04's DiversiTechLabelsModal. Callers (DiversiTechLabelsModal,
// CoreCoverLabelsModal) are thin wrappers that supply row text, the PDF builder and the filename.
import { useEffect, useRef, useState, type ReactNode } from "react";
import Modal from "@/components/Modal";
import PdfViewer from "@/components/PdfViewer";

export interface LabelChecklistModalProps<T> {
  isOpen: boolean;
  onClose: () => void;
  items: T[];
  /** Checklist row text before " — Qty: n". */
  rowLabel: (item: T, index: number) => string;
  rowQty: (item: T) => number;
  /** Optional inline warning per row (e.g. "Size or density couldn't be read"). Row stays checkable. */
  rowWarning?: (item: T, index: number) => string | null;
  /** Build the PDF for the current selection (selected[i] ⇔ items[i] checked). */
  buildPdf: (selected: boolean[]) => Promise<Uint8Array>;
  /** Map a build failure to a user message; default "Couldn't generate the labels. Please try again." */
  errorMessage?: (e: unknown) => string;
  filename: string;
  /** Modal title in the viewer step and the PdfViewer title (e.g. "DiversiTech labels"). */
  viewerTitle: string;
  /** jb-13: extra control rendered at the right of each row, OUTSIDE the <label> so typing in it never toggles the checkbox. */
  rowExtra?: (item: T, index: number) => ReactNode;
  /** jb-13: rendered between the Select All/None links and the list (e.g. a "set all" control). */
  headerExtra?: ReactNode;
  /** jb-13: given the current selection, return a reason to block printing (shown as the error, Print disabled) or null; and an optional footer summary (e.g. "Prints 9 labels"). */
  printStatus?: (selected: boolean[]) => { blocked: string | null; summary?: string };
}

type LabelsDoc = { src: string; filename: string } | null;

const DEFAULT_ERROR = "Couldn't generate the labels. Please try again.";

export default function LabelChecklistModal<T>({
  isOpen,
  onClose,
  items,
  rowLabel,
  rowQty,
  rowWarning,
  buildPdf,
  errorMessage,
  filename,
  viewerTitle,
  rowExtra,
  headerExtra,
  printStatus,
}: LabelChecklistModalProps<T>) {
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
    if (isOpen) setChecked(items.map(() => true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Unmount safety net — never leak a blob URL.
  useEffect(() => () => revokeBlob(), []);

  function setAll(value: boolean) {
    setChecked(items.map(() => value));
  }

  const currentSelected = items.map((_, i) => !!checked[i]);
  const status = printStatus ? printStatus(currentSelected) : null;
  const blocked = status?.blocked ?? null;

  async function handlePrint() {
    setError(null);
    const selected = items.map((_, i) => !!checked[i]);
    if (!selected.some(Boolean)) {
      setError("Select at least one SKU.");
      return;
    }
    if (blocked) return;
    setGenerating(true);
    try {
      const pdfBytes = await buildPdf(selected);
      const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
      revokeBlob();
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setDoc({ src: url, filename });
    } catch (e) {
      console.error("Labels PDF failed:", e);
      setError(errorMessage ? errorMessage(e) : DEFAULT_ERROR);
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
    <Modal isOpen={isOpen} onClose={onClose} title={doc ? viewerTitle : "Select labels to print"} size={doc ? "xl" : "md"}>
      {items.length === 0 ? (
        <>
          <p className="text-sm text-muted">This order has no line items to print labels for.</p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={ghostBtn}>Close</button>
          </div>
        </>
      ) : doc ? (
        <>
          <PdfViewer src={doc.src} filename={doc.filename} title={viewerTitle} />
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
          {headerExtra}
          <div className="rounded-lg border border-[var(--card-border)] divide-y divide-[var(--line)]">
            {items.map((item, i) => {
              const warning = rowWarning ? rowWarning(item, i) : null;
              const row = (
                <label
                  key={rowExtra ? undefined : i}
                  className={`flex items-center gap-3 min-h-[44px] ${rowExtra ? "flex-1 min-w-0" : "px-3"} text-sm text-text cursor-pointer`}
                >
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
                    {rowLabel(item, i)} — Qty:{" "}
                    <span className="font-mono tabular-nums">{rowQty(item)}</span>
                    {warning && <span className="block text-xs text-[var(--warn-text)]">{warning}</span>}
                  </span>
                </label>
              );
              if (!rowExtra) return row;
              return (
                <div key={i} className="flex items-center gap-3 min-h-[44px] px-3">
                  {row}
                  {rowExtra(item, i)}
                </div>
              );
            })}
          </div>
          {(error || blocked) && <p className="text-sm text-[var(--warn-text)]">{error || blocked}</p>}
          <div className="flex items-center justify-end gap-2">
            {status?.summary && <span className="text-sm text-muted">{status.summary}</span>}
            <button type="button" onClick={onClose} className={ghostBtn}>Cancel</button>
            <button type="button" onClick={handlePrint} disabled={generating || !!blocked} className={primaryBtn}>
              {generating ? "Generating labels…" : "Print labels"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
