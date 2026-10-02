"use client";
// src/components/logistics/ToLoadSheetButton.tsx
// tls-01: "To-load sheet" toolbar button on /v2/logistics. Opens a modal with a 1st / 2nd shift toggle and
// a "Printed on" date (defaults to today ET); Build fetches GET /v2/api/shipments/to-load-sheet, builds the
// PDF client-side (lib/logistics/toLoadSheetPdf.ts) and shows it in the shared Modal + PdfViewer. Same
// state / blob-revoke / portal pattern as LoadingSheetButton.tsx. Fetch is aborted after 30s so the modal
// never spins forever.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardList } from "lucide-react";
import Modal from "@/components/Modal";
import PdfViewer from "@/components/PdfViewer";
import { buildToLoadSheetPdf } from "@/lib/logistics/toLoadSheetPdf";
import type { Shift, ToLoadSheet } from "@/lib/logistics/toLoadSheet";

const FETCH_TIMEOUT_MS = 30_000;

function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

const segmentClass = (active: boolean) =>
  `inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-4 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
    active
      ? "bg-[var(--surface)] text-text shadow-sm border border-[var(--border)]"
      : "text-muted hover:text-text border border-transparent"
  }`;

export default function ToLoadSheetButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [shift, setShift] = useState<Shift>(1);
  const [date, setDate] = useState<string>(todayET);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<{ src: string; filename: string } | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const revoke = () => {
    if (blobUrlRef.current) {
      try { URL.revokeObjectURL(blobUrlRef.current); } catch {}
      blobUrlRef.current = null;
    }
  };

  useEffect(() => revoke, []);

  const title = "To-load sheet";

  function handleOpen() {
    revoke();
    setPdfDoc(null);
    setError(null);
    setDate(todayET());
    setIsOpen(true);
  }

  async function handleBuild() {
    revoke();
    setPdfDoc(null);
    setError(null);
    setLoading(true);
    const reqShift = shift;
    const reqDate = date;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(
        `/v2/api/shipments/to-load-sheet?shift=${reqShift}&date=${encodeURIComponent(reqDate)}`,
        { credentials: "same-origin", signal: ctrl.signal }
      );
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        const msg = body?.error || `HTTP ${res.status}`;
        throw new Error(body?.detail && body.detail !== msg ? `${msg} (${body.detail})` : msg);
      }
      const sheet = body.sheet as ToLoadSheet;
      const bytes = await buildToLoadSheetPdf(sheet, String(body.printed_at_et || ""));
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      blobUrlRef.current = url;
      setPdfDoc({ src: url, filename: `to-load-${reqShift === 1 ? "1st" : "2nd"}-shift-${reqDate}.pdf` });
    } catch (e: any) {
      console.error("To-load sheet failed:", e);
      setError(
        e?.name === "AbortError"
          ? "The server took too long to respond. Try again."
          : `Couldn't build the to-load sheet: ${e?.message || e}`
      );
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  function handleClose() {
    setIsOpen(false);
    revoke();
    setPdfDoc(null);
  }

  const modal = (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} size="xl">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="inline-flex gap-1 rounded-lg border border-[var(--border)] p-0.5 bg-[var(--ghost-bg)]" role="group" aria-label="Shift">
          {([1, 2] as Shift[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={shift === s}
              onClick={() => setShift(s)}
              className={segmentClass(shift === s)}
            >
              {s === 1 ? "1st shift" : "2nd shift"}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Printed on
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-[44px] px-2 text-sm rounded-lg border border-[var(--border)] bg-surface text-text focus:outline-hidden focus:border-[var(--brand)] cursor-pointer"
          />
        </label>
        <button
          type="button"
          onClick={handleBuild}
          disabled={loading || !date}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold text-text hover:bg-[var(--ghost-bg)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          <ClipboardList size={16} aria-hidden="true" className="text-muted" />
          {loading ? "Building…" : "Build"}
        </button>
      </div>
      {loading && <p className="text-sm text-muted">Building to-load sheet…</p>}
      {!loading && error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}
      {!loading && !error && pdfDoc && (
        <PdfViewer src={pdfDoc.src} filename={pdfDoc.filename} title={title} />
      )}
    </Modal>
  );

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        title="Print the 1st / 2nd shift to-load sheet"
      >
        <ClipboardList size={14} aria-hidden="true" className="text-muted" />
        To-load sheet
      </button>
      {isOpen && typeof document !== "undefined" ? createPortal(modal, document.body) : null}
    </>
  );
}
