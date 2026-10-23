// src/components/dashboard/MetricTile.tsx — admin-03
// Plain-number KPI tile (dock-01 flat standard: hairline border, radius ≤4px, flat). Sibling of
// StatTile, which is shaped around orders/loads — leave that one alone.
// rpt-01: additive `tone="warn"` (warn tokens on the tile, label, value, unit and caption); the
// default tone renders byte-identically to before.
// rpt-03: additive `value: number | string` (Incidents' "Top category" shows a name); output for a
// number is unchanged.

interface MetricTileProps {
  label: string;
  value: number | string | undefined;
  unit?: string;
  caption?: string;
  /** Renders a <button> when set, a <div> otherwise. */
  onClick?: () => void;
  /** "warn" = a figure that needs attention (warn-bg / warn-border / warn-text). */
  tone?: "default" | "warn";
}

export default function MetricTile({ label, value, unit, caption, onClick, tone = "default" }: MetricTileProps) {
  const warn = tone === "warn";
  const body = (
    <>
      <div className={`text-xs font-semibold uppercase tracking-wider ${warn ? "text-[var(--warn-text)]" : "text-muted"}`}>{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`text-2xl font-bold tabular-nums ${warn ? "text-[var(--warn-text)]" : "text-text"}`}>{value === undefined ? "—" : value}</span>
        {unit && <span className={`text-sm ${warn ? "text-[var(--warn-text)]" : "text-muted"}`}>{unit}</span>}
      </div>
      {caption && <div className={`mt-1 text-xs ${warn ? "text-[var(--warn-text)]" : "text-muted"}`}>{caption}</div>}
    </>
  );
  const base = warn
    ? "bg-[var(--warn-bg)] border border-[var(--warn-border)] text-[var(--warn-text)] rounded p-4 text-left"
    : "bg-surface border border-[var(--card-border)] rounded p-4 text-left";
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
