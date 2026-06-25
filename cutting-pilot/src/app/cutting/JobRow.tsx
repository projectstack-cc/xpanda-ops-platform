"use client";
import { MessageSquare } from "lucide-react";
import { JobStatusPill } from "@/components/StatusPill";
import type { CuttingJob } from "./types";

interface Props {
  job: CuttingJob;
  isActive: boolean;
  onClick: () => void;
}

export default function JobRow({ job, isActive, onClick }: Props) {
  const hasHandoffNote = job.lines.some((l) => l.last_handoff_note);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? "true" : undefined}
      className={[
        "w-full text-left px-4 py-3 border-b border-border transition-colors cursor-pointer min-h-[44px]",
        "border-l-[3px]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]",
        isActive
          ? "bg-[var(--accent-soft)] border-l-[var(--accent)]"
          : "hover:bg-[var(--ghost-bg)] border-l-transparent",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-mono tabular-nums text-xs text-muted">
              {job.invoice_number}
            </span>
            {hasHandoffNote && (
              <MessageSquare
                size={12}
                className="text-[var(--warn-text)] shrink-0"
                aria-label="Has handoff note"
              />
            )}
          </div>
          <div className="font-medium text-sm text-text truncate mt-0.5">
            {job.customer}
          </div>
          {job.ship_date && (
            <div className="font-mono tabular-nums text-xs text-[var(--text-hint)] mt-0.5">
              Ships {job.ship_date}
            </div>
          )}
        </div>
        <div className="shrink-0 pt-0.5">
          <JobStatusPill lines={job.lines} />
        </div>
      </div>
    </button>
  );
}
