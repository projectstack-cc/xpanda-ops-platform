// Status pills — rolled-up (job list) and per-line (detail surface).
// Color+text always paired; never color alone.

interface LineForPill {
  line_status: "not_started" | "in_progress" | "complete";
  open_session_id: string | null;
}

const LINE_VARIANTS: Record<
  "not_started" | "in_progress" | "complete",
  { label: string; cls: string }
> = {
  not_started: {
    label: "Not started",
    cls: "border border-[var(--border)] text-[var(--text-hint)]",
  },
  in_progress: {
    label: "In progress",
    cls: "bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)]",
  },
  complete: {
    label: "Complete",
    cls: "bg-[var(--success-bg)] text-[var(--success-text)]",
  },
};

export function LineStatusPill({
  status,
}: {
  status: "not_started" | "in_progress" | "complete";
}) {
  const { label, cls } = LINE_VARIANTS[status] ?? LINE_VARIANTS.not_started;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${cls}`}
    >
      {label}
    </span>
  );
}

export function JobStatusPill({ lines }: { lines: LineForPill[] }) {
  const total = lines.length;
  const complete = lines.filter((l) => l.line_status === "complete").length;
  const anyActive = lines.some((l) => l.open_session_id !== null);

  let label: string;
  let cls: string;

  if (total > 0 && complete === total) {
    label = "Cut complete";
    cls = "bg-[var(--success-bg)] text-[var(--success-text)]";
  } else if (anyActive) {
    label = `Cutting · ${complete}/${total}`;
    cls = "bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)]";
  } else if (complete > 0) {
    label = `${complete}/${total} done`;
    cls = "bg-[var(--ghost-bg)] text-[var(--text-muted)] border border-[var(--border)]";
  } else {
    label = "Not started";
    cls = "text-[var(--text-hint)] border border-[var(--border)]";
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${cls}`}
    >
      {label}
    </span>
  );
}
