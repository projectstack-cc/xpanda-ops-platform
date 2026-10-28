// src/components/logistics/openPdfTab.ts
// lb-trailer-01: the blob-open step shared by LoadingDiagramPrintButton and PrintAllDiagramsButton —
// open PDF bytes in a new tab as a blob: URL (the browser's own viewer handles download and print).
// Returns false when the pop-up was blocked, so the caller can say so.
export function openPdfTab(bytes: Uint8Array): boolean {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank");
  // Give the new tab time to load the blob before releasing it; the object URL is otherwise
  // orphaned in this tab's memory for the rest of the session, a fine tradeoff for one action.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return !!opened;
}

export const POPUP_BLOCKED_MESSAGE = "Pop-up blocked — allow pop-ups for this site to view the diagram.";
