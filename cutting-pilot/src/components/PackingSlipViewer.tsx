"use client";
// src/components/PackingSlipViewer.tsx
// lgx-slip-01: collapsible "Packing Slip" viewer, lifted verbatim from board/OrderDetailModal.tsx and
// shared with logistics/ShipmentEditModal.tsx. Owns its open state; PdfViewer mounts only while open,
// so nothing is fetched until the user expands it. `src` null => toggle disabled + empty text.
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import PdfViewer from "@/components/PdfViewer";

interface PackingSlipViewerProps {
  src: string | null;
  filename: string;
  defaultOpen?: boolean;
}

export default function PackingSlipViewer({ src, filename, defaultOpen = false }: PackingSlipViewerProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!src}
        className="flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-[var(--link)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={16} className="shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight size={16} className="shrink-0" aria-hidden="true" />
        )}
        Packing Slip
      </button>
      {!src && <p className="text-sm text-muted">No packing slip attached.</p>}
      {open && src && <PdfViewer src={src} filename={filename} title="Packing slip" />}
    </div>
  );
}
