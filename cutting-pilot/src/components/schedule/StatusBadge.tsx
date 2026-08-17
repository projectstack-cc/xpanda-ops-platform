// src/components/schedule/StatusBadge.tsx
// One badge for the 6-state ladder + the unmatched fallback. Color + text always paired —
// never color alone (bad shop lighting, colorblind operators). All colors from tokens.
import type { ScheduleStatus } from "@/types/schedule";

const STATUS_VARIANTS: Record<ScheduleStatus, { label: string; cls: string }> = {
  "Not Started": {
    label: "Not started",
    cls: "bg-[var(--ghost-bg)] text-[var(--text-hint)] border border-[var(--border)]",
  },
  Cutting: {
    label: "Cutting",
    cls: "bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)]",
  },
  "In Production": {
    label: "In Production",
    cls: "bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]",
  },
  Ready: {
    label: "Ready",
    cls: "bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)]",
  },
  Loading: {
    label: "Loading",
    cls: "bg-[var(--loading-bg)] text-[var(--loading-text)] border border-[var(--loading-border)]",
  },
  Loaded: {
    label: "Loaded",
    cls: "bg-[var(--loaded-bg)] text-[var(--loaded-text)] border border-[var(--loaded-border)]",
  },
  Shipped: {
    label: "Shipped",
    cls: "bg-[var(--success-bg)] text-[var(--success-text)]",
  },
};

interface StatusBadgeProps {
  status: ScheduleStatus | null;
  unmatched: boolean;
  sheetStatus: string | null;
  progressPct?: number | null;
  loadsDone?: number | null;
  loadsTotal?: number | null;
}

export default function StatusBadge({ status, unmatched, sheetStatus, progressPct, loadsDone, loadsTotal }: StatusBadgeProps) {
  const base =
    "inline-flex items-center px-1.5 py-[1px] rounded text-[10px] leading-tight font-medium whitespace-nowrap";

  if (unmatched || !status) {
    const label = sheetStatus?.trim() || "No job match";
    return (
      <span
        className={`${base} bg-[var(--ghost-bg)] text-[var(--text-faint)] border border-dashed border-[var(--border)]`}
        title="No matching platform job — showing the sheet's own status"
      >
        {label}
      </span>
    );
  }

  const variant = STATUS_VARIANTS[status] ?? STATUS_VARIANTS["Not Started"];
  let label = variant.label;
  if (status === "In Production" && progressPct != null) {
    label = `In Production – ${progressPct}%`;
  } else if (status === "Loading" && loadsTotal != null && loadsTotal > 1) {
    // Multi-load progress (P377). loadsDone falls back to 0 so a just-started multi-load order
    // reads "Loading 0 of Y" rather than dropping the suffix. Single-load orders (loadsTotal <= 1)
    // keep the plain "Loading" label.
    label = `Loading ${loadsDone ?? 0} of ${loadsTotal}`;
  }
  return <span className={`${base} ${variant.cls}`}>{label}</span>;
}
