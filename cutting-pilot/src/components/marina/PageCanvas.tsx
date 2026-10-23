"use client";
// src/components/marina/PageCanvas.tsx — marina-06 (moved out of CutSheetSetup.tsx, marina-05)
// One cut-sheet page on a canvas (default export) + useMarinaPdf(fileId), the shared way the setup and
// inspect screens open a Marina file with pdf.js. Behaviour unchanged from marina-05.
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfJs } from "@/lib/pdfjs";
import { API, ERROR_TEXT } from "./ui";

// Fetch /files/{id} → pdf.js document; destroyed on unmount or when fileId changes. null = don't load
// (the setup screen waits for its checks; the inspect screen waits until "View cut sheet" is opened).
export function useMarinaPdf(fileId: string | null): { pdf: PDFDocumentProxy | null; error: string | null } {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const res = await fetch(`${API}/files/${encodeURIComponent(fileId)}`);
        if (!res.ok) throw new Error(`Couldn't download the cut sheet (HTTP ${res.status}).`);
        const data = new Uint8Array(await res.arrayBuffer());
        const lib = await loadPdfJs();
        doc = await lib.getDocument({ data }).promise;
        if (cancelled) {
          doc.destroy().catch(() => {});
          return;
        }
        setPdf(doc);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e) || "Couldn't open the cut sheet.");
      }
    })();
    return () => {
      cancelled = true;
      setPdf(null);
      doc?.destroy().catch(() => {});
    };
  }, [fileId]);

  return { pdf, error };
}

// One PDF page on a canvas: container width × devicePixelRatio (cap 2), or a fixed CSS scale (Enlarge).
// The in-flight render is cancelled and awaited before the next one (pdf.js rejects two renders on one
// canvas). Reference only — no click-to-pick.
export default function PageCanvas({ pdf, pageNo, fixedScale }: { pdf: PDFDocumentProxy; pageNo: number; fixedScale?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<{ promise: Promise<unknown>; cancel: () => void } | null>(null);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (fixedScale) return;
    const el = wrapRef.current;
    if (!el) return;
    setWidth(Math.floor(el.clientWidth));
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      setWidth((prev) => (Math.abs(prev - w) >= 2 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixedScale]);

  useEffect(() => {
    if (!fixedScale && !width) return;
    let cancelled = false;
    (async () => {
      const prev = taskRef.current;
      if (prev) {
        prev.cancel();
        await prev.promise.catch(() => {});
      }
      try {
        const page = await pdf.getPage(pageNo);
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const base = page.getViewport({ scale: 1 });
        const cssScale = fixedScale ?? width / base.width;
        const dpr = fixedScale ? 1 : Math.min(window.devicePixelRatio || 1, 2);
        const vp = page.getViewport({ scale: cssScale * dpr });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = `${Math.floor(base.width * cssScale)}px`;
        canvas.style.height = `${Math.floor(base.height * cssScale)}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const task = page.render({ canvasContext: ctx, viewport: vp });
        taskRef.current = task;
        await task.promise;
        if (!cancelled) setError(false);
      } catch (e: any) {
        if (!cancelled && e?.name !== "RenderingCancelledException") setError(true);
      }
    })();
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
    };
  }, [pdf, pageNo, width, fixedScale]);

  return (
    <div ref={wrapRef} className={fixedScale ? "w-max" : "w-full"}>
      <canvas ref={canvasRef} className="block rounded" aria-label={`Cut sheet page ${pageNo}`} role="img" />
      {error && <p className={ERROR_TEXT}>Couldn&apos;t draw this page.</p>}
    </div>
  );
}
