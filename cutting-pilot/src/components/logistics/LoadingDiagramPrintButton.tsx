// src/components/logistics/LoadingDiagramPrintButton.tsx
// lb-ui-08: per-trailer "Print / Export" action. Builds the PDF via loadingDiagramPdf.ts and opens
// it in a new tab as a blob: URL — the browser's own PDF viewer handles both download and print
// natively (Design Decision, locked: no hand-built print stylesheet/popup the way legacy's simpler
// printPackingSlip needs, since legacy's own PDF path already rasterizes the same content anyway).
// Reused from both TrailerDiagram's headerAction slot in CustomizeEditor.tsx (edit mode) and
// LoadPlanView.tsx (view mode) — one definition, two call sites, matching the platform's no-copy-
// paste-modals doctrine extended to this smaller action-button case.
"use client";

import { useState } from "react";
import { Printer, RefreshCw } from "lucide-react";
import type { Dimensions, PackSku, PackTrailer } from "@/lib/packEngine";
import { buildLoadingDiagramPdf } from "@/lib/loadingDiagramPdf";
import { openPdfTab, POPUP_BLOCKED_MESSAGE } from "./openPdfTab";

interface LoadingDiagramPrintButtonProps {
  trailer: PackTrailer;
  trailerIndex: number;
  dims: Dimensions;
  skus: PackSku[];
  runnerHeight?: number;
  warnings?: string[];
  /** lb-diag-02: this trailer's BOL # and the job's invoice #, passed straight to the PDF. */
  bolNumber?: string;
  invoiceNumber?: string;
  /** lb-trailer-01: set (the reason) to disable the button — Customize's empty-trailer card. */
  disabledReason?: string;
}

export default function LoadingDiagramPrintButton({
  trailer,
  trailerIndex,
  dims,
  skus,
  runnerHeight,
  warnings,
  bolNumber,
  invoiceNumber,
  disabledReason,
}: LoadingDiagramPrintButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const bytes = await buildLoadingDiagramPdf(trailer, trailerIndex, dims, skus, { runnerHeight, warnings, bolNumber, invoiceNumber });
      if (!openPdfTab(bytes)) setError(POPUP_BLOCKED_MESSAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate the loading diagram PDF.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || !!disabledReason}
        title={disabledReason}
        aria-label={`Print or export loading diagram for trailer ${trailerIndex + 1}`}
        className="min-h-[28px] px-2.5 rounded-md text-[12px] font-medium border border-[var(--border)] text-text flex items-center gap-1 cursor-pointer transition-colors hover:bg-[var(--ghost-bg)] disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      >
        {busy ? <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Printer className="w-3 h-3" aria-hidden="true" />}
        {busy ? "Building…" : "Print / Export"}
      </button>
      {error && (
        <span className="text-[11px] mt-1 max-w-[220px] text-right" style={{ color: "var(--danger-bg)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
