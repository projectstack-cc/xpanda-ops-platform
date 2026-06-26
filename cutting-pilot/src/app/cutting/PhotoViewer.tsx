"use client";
import Modal from "@/components/Modal";
import type { CuttingJob } from "./types";

interface Props {
  job: CuttingJob | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function PhotoViewer({ job, isOpen, onClose }: Props) {
  const photos = job?.photos ?? [];
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={job ? `Cut-list photos — ${job.customer}` : "Cut-list photos"}
    >
      {photos.length === 0 ? (
        <p className="text-sm text-muted">No cut-list photos for this job yet.</p>
      ) : (
        <div className="space-y-4">
          {photos.map((p) => (
            <figure key={p.session_id} className="space-y-1">
              <figcaption className="text-xs font-semibold text-muted">{p.line}</figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/v2/api/cutting/photo/${p.session_id}`}
                alt={`Cut list — ${p.line}`}
                className="w-full rounded border border-border"
                loading="lazy"
              />
            </figure>
          ))}
        </div>
      )}
    </Modal>
  );
}
