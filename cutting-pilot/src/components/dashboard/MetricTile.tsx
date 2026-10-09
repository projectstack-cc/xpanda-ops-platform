// src/components/dashboard/MetricTile.tsx — admin-03
// Plain-number KPI tile (dock-01 flat standard: hairline border, radius ≤4px, flat). Sibling of
// StatTile, which is shaped around orders/loads — leave that one alone.

interface MetricTileProps {
  label: string;
  value: number | undefined;
  unit?: string;
  caption?: string;
  /** Renders a <button> when set, a <div> otherwise. */
  onClick?: () => void;
}

export default function MetricTile({ label, value, unit, caption, onClick }: MetricTileProps) {
  const body = (
    <>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-text">{value === undefined ? "—" : value}</span>
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </div>
      {caption && <div className="mt-1 text-xs text-muted">{caption}</div>}
    </>
  );
  const base = "bg-surface border border-[var(--card-border)] rounded p-4 text-left";
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} w-full cursor-pointer hover:border-[var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]`}
      >
        {body}
      </button>
    );
  }
  return <div className={base}>{body}</div>;
}
