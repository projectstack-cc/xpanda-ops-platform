// src/components/logistics/PlanMetricsStrip.tsx
// lb-ui-01: the metrics strip consuming planMetrics(plan, dims, options). Flat cards, no border,
// muted 13px label, 24px/500 value (Decision, locked). No warning treatment on near-full length —
// the planner reads the number plainly, it is never colored or badged (Decision, locked).
//
// Token note: the prompt's spec named `var(--surface-1)` for these cards, which does not exist in
// globals.css (only --surface/--surface-2/--card-bg are defined, and only those three are exposed
// to Tailwind). Substituted the closest real token, --surface-2 (already used for PlatformHeader's
// own flat title strip) — see CHANGELOG for the full token-substitution note.
import type { Dimensions, PlanMetrics } from "@/lib/packEngine";

interface PlanMetricsStripProps {
  metrics: PlanMetrics;
  dims: Dimensions;
}

function round(n: number): number {
  return Math.round(n);
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex-1 min-w-[140px] rounded-lg bg-[var(--surface-2)] px-4 py-3">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="text-2xl font-medium font-mono tabular-nums text-text leading-tight">{value}</div>
      {sub && <div className="text-xs text-text-hint font-mono tabular-nums mt-0.5">{sub}</div>}
    </div>
  );
}

export default function PlanMetricsStrip({ metrics, dims }: PlanMetricsStripProps) {
  return (
    <div className="flex flex-wrap gap-3" role="group" aria-label="Plan metrics">
      <MetricCard label="Trailers" value={String(metrics.trailerCount)} />
      <MetricCard
        label="Length used"
        value={`${round(metrics.usedLength)}"`}
        sub={`of ${round(dims.length)}" per trailer`}
      />
      <MetricCard label="Height fill" value={`${round(metrics.meanHeightUtilization * 100)}%`} />
      <MetricCard label="Width fill" value={`${round(metrics.meanWidthUtilization * 100)}%`} />
      <MetricCard label="Unplaced pieces" value={String(metrics.balancePieces)} />
    </div>
  );
}
