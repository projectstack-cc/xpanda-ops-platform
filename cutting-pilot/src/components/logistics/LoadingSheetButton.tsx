"use client";
// src/components/logistics/LoadingSheetButton.tsx
// lgx-loadsheet-01: one component, two call sites — per order (BolActions row actions) and whole day
// (ShipmentDashboard toolbar, with a date picker defaulting to today ET). Owns its own state: fetch
// GET /v2/api/shipments/loading-sheet, build the PDF client-side (lib/logistics/loadingSheet.ts),
// show it in the shared Modal + PdfViewer. Blob URL revoked on close and on unmount (same pattern
// as OrderDetailModal's cut-list blob ref). The Modal is portaled to document.body because the
// per-order instance renders inside a table cell.
//
// lgx-printed-01: clicking Print/Download in the PdfViewer marks every job in the built PDF printed
// (POST /v2/api/shipments/loading-sheet). Best-effort: a failed mark only warns in the console. The
// order-mode IconAction turns orange (`printed` variant) once printed; day mode calls onPrinted so the
// dashboard refetches its rows.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import IconAction from "./IconAction";
import Modal from "@/components/Modal";
import PdfViewer from "@/components/PdfViewer";
import { buildLoadingSheetPdf, type LoadingSheetOrder } from "@/lib/logistics/loadingSheet";

// lgx-rows-01: the order variant renders as an IconAction (row actions); disabledReason grays it out.
type Props =
  | {
      mode: "order";
      jobId: string;
      disabledReason?: string | null;
      printedAt?: string | null;
      printedBy?: string | null;
      onPrinted?: () => void;
    }
  | { mode: "day"; onPrinted?: () => void };

function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

/** UTC 'YYYY-MM-DD HH:MM:SS' -> "Oct 15, 1:42 PM" in ET. */
function fmtPrinted(ts: string): string {
  const d = new Date(`${ts.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return ts;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export default function LoadingSheetButton(props: Props) {
  const [date, setDate] = useState<string>(todayET);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyDate, setEmptyDate] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<{ src: string; filename: string } | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  // lgx-printed-01: job ids in the currently built PDF; one mark request in flight at a time.
  const printJobIdsRef = useRef<string[]>([]);
  const markingRef = useRef(false);
  const propPrintedAt = props.mode === "order" ? props.printedAt ?? null : null;
  const propPrintedBy = props.mode === "order" ? props.printedBy ?? null : null;
  const [localPrintedAt, setLocalPrintedAt] = useState<string | null>(propPrintedAt);
  const [localPrintedBy, setLocalPrintedBy] = useState<string | null>(propPrintedBy);

  useEffect(() => {
    setLocalPrintedAt(propPrintedAt);
    setLocalPrintedBy(propPrintedBy);
  }, [propPrintedAt, propPrintedBy]);

  const revoke = () => {
    if (blobUrlRef.current) {
      try { URL.revokeObjectURL(blobUrlRef.current); } catch {}
      blobUrlRef.current = null;
    }
  };

  useEffect(() => revoke, []);

  const title = props.mode === "day" ? `Loading sheets — ${date}` : "Loading sheet";

  async function handleOpen() {
    revoke();
    setPdfDoc(null);
    setError(null);
    setEmptyDate(null);
    setIsOpen(true);
    setLoading(true);
    const requestedDate = date;
    try {
      const qs = props.mode === "order"
        ? `job_id=${encodeURIComponent(props.jobId)}`
        : `date=${encodeURIComponent(requestedDate)}`;
      const res = await fetch(`/v2/api/shipments/loading-sheet?${qs}`, { credentials: "same-origin" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
      const orders: LoadingSheetOrder[] = Array.isArray(body.orders) ? body.orders : [];
      if (!orders.length) {
        setEmptyDate(props.mode === "day" ? requestedDate : "");
        return;
      }
      printJobIdsRef.current = props.mode === "order" ? [props.jobId] : orders.map((o) => o.job_id);
      const bytes = await buildLoadingSheetPdf(orders);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      blobUrlRef.current = url;
      const filename = props.mode === "day"
        ? `loading-sheets-${requestedDate}.pdf`
        : `loading-sheet-${orders[0].invoice_number || props.jobId}.pdf`;
      setPdfDoc({ src: url, filename });
    } catch (e) {
      console.error("Loading sheet failed:", e);
      setError("Couldn't build the loading sheet. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function markPrinted() {
    const jobIds = printJobIdsRef.current;
    if (!jobIds.length || markingRef.current) return;
    markingRef.current = true;
    try {
      const res = await fetch("/v2/api/shipments/loading-sheet", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_ids: jobIds }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
      if (props.mode === "order") {
        setLocalPrintedAt(body.printed_at ?? null);
        setLocalPrintedBy(body.printed_by ?? null);
      }
      props.onPrinted?.();
    } catch (e) {
      console.warn("Couldn't mark loading sheet printed:", e);
    } finally {
      markingRef.current = false;
    }
  }

  function handleClose() {
    setIsOpen(false);
    revoke();
    setPdfDoc(null);
  }

  const modal = (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} size="xl">
      {loading && <p className="text-sm text-muted">Building loading sheet…</p>}
      {!loading && error && <p className="text-sm text-[var(--danger-ink)]">{error}</p>}
      {!loading && !error && emptyDate !== null && (
        <p className="text-sm text-muted">
          {props.mode === "day" ? `No outbound orders ship on ${emptyDate}.` : "No outbound shipment found for this order."}
        </p>
      )}
      {!loading && !error && pdfDoc && (
        <PdfViewer src={pdfDoc.src} filename={pdfDoc.filename} title={title} onPrint={markPrinted} onDownload={markPrinted} />
      )}
    </Modal>
  );

  return (
    <>
      {props.mode === "day" && (
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Loading sheets date"
          className="h-9 px-2 text-xs rounded-lg border border-[var(--border)] bg-surface text-text focus:outline-hidden focus:border-[var(--brand)] cursor-pointer"
        />
      )}
      {props.mode === "order" ? (
        <IconAction
          icon={Printer}
          variant={localPrintedAt ? "printed" : "default"}
          label={
            localPrintedAt
              ? `Loading sheet printed ${fmtPrinted(localPrintedAt)}${localPrintedBy ? ` by ${localPrintedBy}` : ""} — print again`
              : "Print loading sheet"
          }
          disabledReason={props.disabledReason}
          onClick={handleOpen}
        />
      ) : (
      <button
        type="button"
        onClick={handleOpen}
        disabled={props.mode === "day" && !date}
        className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        title={props.mode === "day" ? "Print loading sheets for every order shipping on this date" : "Print loading sheet"}
      >
        <Printer size={14} aria-hidden="true" className="text-muted" />
        {props.mode === "day" ? "Loading sheets" : "Loading sheet"}
      </button>
      )}
      {isOpen && typeof document !== "undefined" ? createPortal(modal, document.body) : null}
    </>
  );
}
