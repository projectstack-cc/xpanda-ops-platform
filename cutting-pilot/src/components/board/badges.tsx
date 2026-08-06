// src/components/board/badges.tsx
// Tokenized badges for the production board — priority and job status. Shared between the
// board table rows and the status-bucket modal rows so the two never drift.

const badgeBase =
  "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap";

export function PriorityBadge({
  priority,
  priorityLevel,
}: {
  priority: string | null;
  priorityLevel: number | null;
}) {
  if (priority === "rush") {
    return <span className={`${badgeBase} bg-[var(--danger-bg)] text-[var(--danger-text)]`}>Rush</span>;
  }

  const level = priorityLevel ?? 0;
  if (level >= 3) {
    return <span className={`${badgeBase} bg-[var(--danger-bg)] text-[var(--danger-text)]`}>Critical</span>;
  }
  if (level === 2) {
    return (
      <span className={`${badgeBase} bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)]`}>
        High
      </span>
    );
  }
  if (level === 1) {
    return (
      <span className={`${badgeBase} bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)]`}>
        Elevated
      </span>
    );
  }
  return <span className={`${badgeBase} border border-[var(--border)] text-[var(--text-hint)]`}>Normal</span>;
}

const STATUS_VARIANTS: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Not started", cls: "border border-[var(--border)] text-[var(--text-hint)]" },
  in_production: {
    label: "In production",
    cls: "bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)]",
  },
  done: { label: "Done", cls: "bg-[var(--success-bg)] text-[var(--success-text)]" },
  loading: {
    label: "Loading",
    cls: "bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)]",
  },
  shipped: { label: "Shipped", cls: "bg-[var(--ghost-bg)] text-[var(--text-muted)] border border-[var(--border)]" },
};

export function JobStatusBadge({ status }: { status: string }) {
  const v = STATUS_VARIANTS[status] ?? { label: status, cls: "border border-[var(--border)] text-[var(--text-hint)]" };
  return <span className={`${badgeBase} ${v.cls}`}>{v.label}</span>;
}
