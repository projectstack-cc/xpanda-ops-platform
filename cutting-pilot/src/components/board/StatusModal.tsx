"use client";
// src/components/board/StatusModal.tsx
// One reusable modal for all three status-bucket cards (Open / Cutting / Loading) —
// parameterized by title + job list, composing the shared Modal primitive. No copy-paste modal
// per card. Clicking a row closes the modal and hands the job id back so the board can scroll
// to and briefly highlight the matching row (there's no per-job v2 detail page to deep-link to
// yet — that lands with the order-entry edit deep-link, tracked in BACKLOG.md).
import Modal from "@/components/Modal";
import { JobStatusBadge } from "./badges";
import type { BoardJob } from "./ProductionBoard";

interface StatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  jobs: BoardJob[];
  onSelectJob: (jobId: string) => void;
}

export default function StatusModal({ isOpen, onClose, title, jobs, onSelectJob }: StatusModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
      {jobs.length === 0 ? (
        <p className="text-sm text-muted py-4">No jobs in this bucket.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)] max-h-[60vh] overflow-y-auto -mx-2">
          {jobs.map((job) => (
            <li key={job.id}>
              <button
                type="button"
                onClick={() => onSelectJob(job.id)}
                className="w-full min-h-[44px] flex items-center justify-between gap-3 px-2 py-2 text-left rounded-md hover:bg-[var(--ghost-bg)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text truncate">{job.customer || "—"}</span>
                  <span className="block text-xs text-muted truncate">
                    {job.po_number ? `PO ${job.po_number}` : "No PO"}
                    {job.ship_to_city ? ` · ${job.ship_to_city}${job.ship_to_state ? `, ${job.ship_to_state}` : ""}` : ""}
                  </span>
                </span>
                <JobStatusBadge status={job.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
