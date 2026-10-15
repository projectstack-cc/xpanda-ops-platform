"use client";
// src/components/board/DiversiTechLabelsModal.tsx
// jb-04 — DiversiTech bag/bundle labels for the v2 board. Mirrors legacy P444's SKU checklist
// (jobs/index.html openDiversiTechPrintModal), then renders the generated PDF in-app via the shared
// PdfViewer instead of legacy's popup-blocker-prone window.open.
// jb-12 — the checklist/viewer body moved to the generic LabelChecklistModal; this is now a thin
// wrapper (same props, strings, filename and output).
import LabelChecklistModal from "@/components/board/LabelChecklistModal";
import {
  buildDiversiTechLabelsPdf,
  diversiTechProductLabel,
  type DiversiTechLineItem,
} from "@/lib/diversitechLabels";

interface DiversiTechLabelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: { ship_date: string | null };
  lineItems: DiversiTechLineItem[];
  /** Used for the download filename: diversitech-labels-<fileKey>.pdf (invoice number or job id). */
  fileKey: string;
}

export default function DiversiTechLabelsModal({ isOpen, onClose, job, lineItems, fileKey }: DiversiTechLabelsModalProps) {
  return (
    <LabelChecklistModal
      isOpen={isOpen}
      onClose={onClose}
      items={lineItems}
      rowLabel={(li) => diversiTechProductLabel(li) || "Untitled"}
      rowQty={(li) => Number(li.quantity) || 0}
      buildPdf={(selected) => buildDiversiTechLabelsPdf(job, lineItems.filter((_, i) => selected[i]))}
      filename={`diversitech-labels-${fileKey}.pdf`}
      viewerTitle="DiversiTech labels"
    />
  );
}
