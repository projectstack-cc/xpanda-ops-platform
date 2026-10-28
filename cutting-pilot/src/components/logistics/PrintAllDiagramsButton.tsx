// src/components/logistics/PrintAllDiagramsButton.tsx
// lb-trailer-01: "Print all diagrams" — every trailer's loading diagram in one PDF, in trailer order
// (buildAllLoadingDiagramsPdf merges the per-trailer PDFs), opened in a new tab like the per-trailer
// LoadingDiagramPrintButton (shared openPdfTab). Each trailer carries the same BOL # / invoice # its
// own card's Print / Export uses. Styling comes from the caller (ResultsTab's action row).
"use client";

import { useState } from "react";
import { Printer, RefreshCw } from "lucide-react";
import type { PackSku } from "@/lib/packEngine";
import { buildAllLoadingDiagramsPdf, type AllDiagramsTrailer } from "@/lib/loadingDiagramPdf";
import { openPdfTab, POPUP_BLOCKED_MESSAGE } from "./openPdfTab";

interface PrintAllDiagramsButtonProps {
  trailers: AllDiagramsTrailer[];
  skus: PackSku[];
  runnerHeight?: number;
  warnings?: string[];
  disabled?: boolean;
  className: string;
}

export default function PrintAllDiagramsButton({ trailers, skus, runnerHeight, warnings, disabled, className }: PrintAllDiagramsButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const bytes = await buildAllLoadingDiagramsPdf(trailers, skus, { runnerHeight, warnings });
      if (!openPdfTab(bytes)) setError(POPUP_BLOCKED_MESSAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate the loading diagrams PDF.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={handleClick} disabled={busy || disabled} className={className}>
        {busy ? <RefreshCw size={16} className="animate-spin" aria-hidden="true" /> : <Printer size={16} aria-hidden="true" />}
        {busy ? "Building…" : "Print all diagrams"}
      </button>
      {error && (
        <span role="alert" className="self-center text-xs" style={{ color: "var(--danger-bg)" }}>
          {error}
        </span>
      )}
    </>
  );
}
