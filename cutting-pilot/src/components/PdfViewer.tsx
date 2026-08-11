"use client";
// Shared inline PDF viewer: embeds a PDF (blob URL or same-host endpoint) in an iframe with
// explicit Download + Print controls above it. Explicit controls (not the browser's native
// in-frame PDF toolbar) because that toolbar is unreliable on the iPads/tablets this platform
// targets — some mobile browsers don't render PDFs inline at all. Used by the order-detail
// modal for both the packing slip and the cut list so neither forks its own viewer.
import { useRef, useState } from "react";
import { AlertTriangle, Download, Printer } from "lucide-react";

interface PdfViewerProps {
  src: string;
  filename: string;
  title: string;
  height?: number;
}

export default function PdfViewer({ src, filename, title, height = 420 }: PdfViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loadError, setLoadError] = useState(false);

  function handlePrint() {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.focus();
      win.print();
    } catch {
      window.open(src, "_blank");
    }
  }

  function handleDownload() {
    const a = document.createElement("a");
    a.href = src;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handlePrint}
          className="flex items-center gap-1.5 min-h-[44px] px-3 rounded-md border border-[var(--input-border)] text-text text-xs font-semibold cursor-pointer hover:bg-[var(--ghost-bg)]"
        >
          <Printer size={14} aria-hidden="true" /> Print
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="flex items-center gap-1.5 min-h-[44px] px-3 rounded-md border border-[var(--input-border)] text-text text-xs font-semibold cursor-pointer hover:bg-[var(--ghost-bg)]"
        >
          <Download size={14} aria-hidden="true" /> Download
        </button>
      </div>
      <iframe
        ref={iframeRef}
        src={src}
        title={title}
        className="w-full rounded-lg border border-[var(--card-border)]"
        style={{ height }}
        onError={() => setLoadError(true)}
      />
      {loadError && (
        <p className="flex items-center gap-1.5 text-xs text-[var(--warn-text)]">
          <AlertTriangle size={14} aria-hidden="true" /> Couldn&apos;t load the document — try downloading instead.
        </p>
      )}
    </div>
  );
}
