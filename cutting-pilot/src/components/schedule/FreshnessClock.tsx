"use client";
// src/components/schedule/FreshnessClock.tsx
// Honest freshness signal: sourced from source_updated_at (the poller's real last sheet-pull
// time), never render time. Ticks its own relative age on a short interval, independent of the
// board's 60s refetch, so a dead cron visibly ages and crosses into the amber "may be dead"
// treatment on its own — no refetch required to notice.
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

// >2 cron cycles at the current 10-minute poller tick — see prompt-301.
const STALE_THRESHOLD_MS = 20 * 60 * 1000;
// Independent of POLL_MS (ScheduleBoard's 60s refetch) — this only recomputes the relative age.
const CLOCK_TICK_MS = 20_000;

interface FreshnessClockProps {
  sourceUpdatedAt: string | null;
}

function formatAbsolute(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRelative(ageMs: number): string {
  const mins = Math.max(0, Math.floor(ageMs / 60_000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

const AMBER_CLS =
  "px-1.5 py-[1px] rounded bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)]";

export default function FreshnessClock({ sourceUpdatedAt }: FreshnessClockProps) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const base = "inline-flex items-center gap-1 font-mono tabular-nums text-[10px] leading-tight";

  if (!sourceUpdatedAt) {
    return (
      <span className={`${base} ${AMBER_CLS}`}>
        <Clock size={11} aria-hidden="true" />
        no data
      </span>
    );
  }

  const sourceDate = new Date(sourceUpdatedAt);
  const ageMs = Date.now() - sourceDate.getTime();
  const stale = ageMs > STALE_THRESHOLD_MS;

  return (
    <span
      className={[base, stale ? AMBER_CLS : "text-text-faint"].join(" ")}
      title={`Sheet last pulled ${sourceDate.toLocaleString()}`}
    >
      <Clock size={11} aria-hidden="true" />
      {formatRelative(ageMs)} · {formatAbsolute(sourceDate)}
    </span>
  );
}
