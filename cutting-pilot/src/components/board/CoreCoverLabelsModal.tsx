"use client";
// src/components/board/CoreCoverLabelsModal.tsx
// jb-12 — Core Covers bag labels (4 pcs/bag) for the v2 board. Thin wrapper over
// LabelChecklistModal; the PDF is bagLabels.ts (the Block Calculator's P413/P417 generator) fed by
// the coreCoverLabels.ts job-line adapter. Bag numbering stays whole-order under any selection.
import { useMemo } from "react";
import LabelChecklistModal from "@/components/board/LabelChecklistModal";
import { buildBagLabelsPdf, densityString, sizeString, UnparsedRowsError } from "@/lib/bagLabels";
import { coreCoverSkuLines, type CoreCoverLineItem } from "@/lib/coreCoverLabels";

interface CoreCoverLabelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  lineItems: CoreCoverLineItem[];
  /** Used for the download filename: core-covers-labels-<fileKey>.pdf (invoice number or job id). */
  fileKey: string;
}

export default function CoreCoverLabelsModal({ isOpen, onClose, lineItems, fileKey }: CoreCoverLabelsModalProps) {
  const skuLines = useMemo(() => coreCoverSkuLines(lineItems), [lineItems]);

  return (
    <LabelChecklistModal
      isOpen={isOpen}
      onClose={onClose}
      items={lineItems}
      rowLabel={(_, i) => {
        const s = skuLines[i];
        if (!s?.parsed) return s?.item || "Untitled";
        return `${s.item} · ${sizeString(s)} · ${densityString(s)}`;
      }}
      rowQty={(li) => Number(li.quantity) || 0}
      rowWarning={(_, i) =>
        skuLines[i]?.parsed ? null : "Couldn't read size/density — fix this order line before printing."
      }
      buildPdf={(selected) => {
        const onlyLines = new Set<number>();
        selected.forEach((s, i) => { if (s) onlyLines.add(i); });
        return buildBagLabelsPdf(skuLines, { onlyLines });
      }}
      errorMessage={(e) =>
        e instanceof UnparsedRowsError
          ? "Can't print — these lines couldn't be read: " + e.rows.map((r) => r.item || r.raw).join(", ")
          : "Couldn't generate the labels. Please try again."
      }
      filename={`core-covers-labels-${fileKey}.pdf`}
      viewerTitle="Core Covers labels"
    />
  );
}
