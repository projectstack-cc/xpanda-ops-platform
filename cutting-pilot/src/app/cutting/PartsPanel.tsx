"use client";
import SlideOver from "@/components/SlideOver";
import type { CuttingJob } from "./types";

interface Props {
  job: CuttingJob | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function PartsPanel({ job, isOpen, onClose }: Props) {
  const items = job?.line_items ?? [];

  return (
    <SlideOver isOpen={isOpen} onClose={onClose} title={job ? `Parts — ${job.customer}` : "Parts"}>
      {job && (
        <p className="px-4 py-2 border-b border-border font-mono tabular-nums text-xs text-muted shrink-0">
          {job.invoice_number}
          {job.po_number ? ` · PO ${job.po_number}` : ""}
        </p>
      )}

      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">No line items on this job.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((it, i) => (
            <li key={i} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {it.part_number && (
                    <p className="font-mono text-sm text-text">{it.part_number}</p>
                  )}
                  {it.description && (
                    <p className="text-sm text-muted mt-0.5 break-words">{it.description}</p>
                  )}
                  {it.dimensions && (
                    <p className="text-xs text-muted mt-0.5">{it.dimensions}</p>
                  )}
                </div>
                <span className="shrink-0 font-mono tabular-nums text-sm font-semibold text-text">
                  {it.quantity ?? "—"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Blocks / chunks required — reserved placeholder (fills once block-calc BOM feeds qty_target) */}
      <div className="m-4 rounded border border-dashed border-border px-3 py-3 opacity-70">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Blocks / chunks required — coming soon
        </span>
        <p className="text-xs text-muted mt-1">
          Specific blocks and cut chunks will list here once the block-calculator BOM is wired.
        </p>
      </div>
    </SlideOver>
  );
}
