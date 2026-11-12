// src/components/StopChip.tsx
// stops-03 — a trailer-group order's stop ("2nd Stop") as a small neutral pill. One component for every
// surface (Carrier View, v2 logistics rows, v2 Job Board rows). Renders nothing when the stop is unset.
// Neutral on purpose: red = problem, green = ready, black/yellow stripe = live load.
import { stopLabel } from "@/lib/trailerStops";

export default function StopChip({ stop, className = "" }: { stop: number | null | undefined; className?: string }) {
  if (!stop) return null;
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap font-mono tabular-nums bg-[var(--ghost-bg)] text-[var(--text)] ${className}`}
    >
      {stopLabel(stop)}
    </span>
  );
}
