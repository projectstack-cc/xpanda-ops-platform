// src/lib/pdfjs.ts — marina-04
// Shared lazy pdf.js loader (browser only). Same behaviour as the private copies in packingSlip.ts,
// parseInvoicePdf.ts and bolEditorEngine.ts — those are not moved onto this yet (BACKLOG).

let _pdfjs: typeof import("pdfjs-dist") | null = null;

export async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  const mod = await import("pdfjs-dist");
  // basePath ("/v2") applies automatically to page/API routing but NOT to this literal string —
  // it must match the physical file scripts/copy-pdf-worker.mjs places post-build.
  mod.GlobalWorkerOptions.workerSrc = "/v2/pdf.worker.min.mjs";
  _pdfjs = mod;
  return _pdfjs;
}

// Page count of a PDF, or null on any failure (never throws) — the caller then omits page_count.
export async function countPdfPages(file: Blob): Promise<number | null> {
  let pdf: { numPages: number; destroy: () => Promise<void> } | null = null;
  try {
    const lib = await loadPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    pdf = await lib.getDocument({ data }).promise;
    return pdf.numPages;
  } catch {
    return null;
  } finally {
    try {
      await pdf?.destroy();
    } catch {
      /* ignore */
    }
  }
}
