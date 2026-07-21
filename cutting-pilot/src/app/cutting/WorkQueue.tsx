"use client";
import JobRow from "./JobRow";
import type { CuttingJob } from "./types";

const WORK_QUEUE_SIZE = 5;

interface Props {
  jobs: CuttingJob[]; // already priority-sorted by the queue API
  selectedJobId: string | null;
  onSelect: (jobId: string) => void;
  onViewPhotos: (job: CuttingJob) => void;
}

// Ranked "work next" shortlist. Reads the already-priority-sorted queue, keeps only jobs
// that still have incomplete cutting lines, and shows the top few so the floor works
// top-down instead of cherry-picking. Guide only — every job stays clickable here and in
// the full list below.
export default function WorkQueue({ jobs, selectedJobId, onSelect, onViewPhotos }: Props) {
  const queued = jobs
    .filter((j) => j.lines.some((l) => l.line_status !== "complete"))
    .slice(0, WORK_QUEUE_SIZE);

  return (
    <section aria-label="Priority work queue" className="border-b border-border">
      <div className="px-4 py-2 bg-[var(--surface-2)] flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Work Queue
        </span>
        {queued.length > 0 && (
          <span className="font-mono tabular-nums text-xs text-muted">
            top {queued.length}
          </span>
        )}
      </div>
      {queued.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">All caught up — nothing queued.</p>
      ) : (
        queued.map((job, i) => (
          <JobRow
            key={`wq-${job.id}`}
            job={job}
            rank={i + 1}
            isActive={job.id === selectedJobId}
            onClick={() => onSelect(job.id)}
            onViewPhotos={() => onViewPhotos(job)}
          />
        ))
      )}
    </section>
  );
}
