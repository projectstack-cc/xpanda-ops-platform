"use client";
import JobRow from "./JobRow";
import type { CuttingJob } from "./types";

const WORK_QUEUE_SIZE = 5;

// Shift-handoff continuity: a job with any line already in progress (or holding an open
// session) must be obvious to the next operator so they know exactly where to resume.
// (Duplicated in JobRow.tsx — prompt scope says no new shared module for this.)
const isInProcess = (j: CuttingJob) =>
  j.lines.some((l) => l.line_status === "in_progress" || l.open_session_id != null);

// Stable partition — preserves the existing priority order within each group.
const byInProcessFirst = (arr: CuttingJob[]) => [
  ...arr.filter(isInProcess),
  ...arr.filter((j) => !isInProcess(j)),
];

interface Props {
  jobs: CuttingJob[]; // already priority-sorted by the queue API
  selectedJobId: string | null;
  onSelect: (jobId: string) => void;
  onViewPhotos: (job: CuttingJob) => void;
}

// Ranked "work next" shortlist. Reads the already-priority-sorted queue, keeps only jobs
// that still have incomplete cutting lines. P335/P336: per-user — if the current user has
// any incomplete assigned jobs, show all of them ("My Queue"); otherwise fall back to the
// top few of the global priority sort ("Work Queue") so the floor works top-down instead of
// cherry-picking. Guide only — every job stays clickable here and in the full list below.
export default function WorkQueue({ jobs, selectedJobId, onSelect, onViewPhotos }: Props) {
  const incomplete = byInProcessFirst(
    jobs.filter((j) => j.lines.some((l) => l.line_status !== "complete"))
  );
  const mine = incomplete.filter((j) => j.assigned_to_me);
  const assignedMode = mine.length > 0;
  const queued = assignedMode ? mine : incomplete.slice(0, WORK_QUEUE_SIZE);

  return (
    <section aria-label="Priority work queue" className="border-b border-border">
      <div className="px-4 py-2 bg-[var(--surface-2)] flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {assignedMode ? "My Queue" : "Work Queue"}
        </span>
        {queued.length > 0 && (
          <span className="font-mono tabular-nums text-xs text-muted">
            {assignedMode ? `${queued.length} assigned` : `top ${queued.length}`}
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
