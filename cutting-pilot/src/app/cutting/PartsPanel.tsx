"use client";
import type { CuttingJob } from "./types";

interface Props {
  job: CuttingJob;
  line: string;
  requiredLines: string[];
  onSelectLine: (line: string) => void;
  onToggle: (lineItemId: string, completed: boolean) => void;
  busy: boolean;
}

// Docked per-line parts checklist (no overlay). Each cutting line tracks its own completion of
// each part on the order. Cross Cutter / Hole Cutter really work in chunks; until the block-calc
// BOM is wired, every line shows the same parts list and the chunk note below stands in.
export default function PartsPanel({
  job,
  line,
  requiredLines,
  onSelectLine,
  onToggle,
  busy,
}: Props) {
  const items = job.line_items ?? [];
  const prog = job.progress?.[line] ?? {};
  const doneCount = items.filter((it) => prog[it.id]?.completed).length;

  return (
    <div className="border border-border rounded-lg overflow-hidden mb-3">
      {/* Line selector */}
      <div className="flex overflow-x-auto border-b border-border bg-[var(--ghost-bg)]">
        {requiredLines.map((ln) => (
          <button
            key={ln}
            type="button"
            onClick={() => onSelectLine(ln)}
            aria-pressed={ln === line}
            className={[
              "shrink-0 px-3 min-h-[44px] text-xs font-semibold border-b-2 cursor-pointer whitespace-nowrap",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]",
              ln === line
                ? "border-[var(--accent)] text-text"
                : "border-transparent text-muted hover:text-text",
            ].join(" ")}
          >
            {ln}
          </button>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {line} — parts
        </span>
        <span className="font-mono tabular-nums text-xs text-muted">
          {doneCount}/{items.length}
        </span>
      </div>

      {/* Checklist */}
      {items.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted">No parts on this order.</p>
      ) : (
        <ul className="divide-y divide-border max-h-72 overflow-y-auto">
          {items.map((it) => {
            const checked = !!prog[it.id]?.completed;
            return (
              <li key={it.id}>
                <label className="flex items-start gap-3 px-3 py-2.5 cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={(e) => onToggle(it.id, e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)] cursor-pointer disabled:opacity-50"
                  />
                  <span className="min-w-0 flex-1">
                    {it.part_number && (
                      <span className="font-mono text-sm text-text">{it.part_number} </span>
                    )}
                    {it.description && (
                      <span
                        className={`text-sm ${checked ? "text-muted line-through" : "text-text"}`}
                      >
                        {it.description}
                      </span>
                    )}
                    {it.dimensions && (
                      <span className="block text-xs text-muted mt-0.5">{it.dimensions}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-sm text-muted">
                    {it.quantity ?? "—"}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {/* Blocks / chunks required — reserved placeholder (fills once block-calc BOM feeds qty_target) */}
      <div className="m-3 rounded border border-dashed border-border px-3 py-2.5 opacity-70">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Blocks / chunks required — coming soon
        </span>
        <p className="text-xs text-muted mt-1">
          Cross Cutter / Hole Cutter work in chunks; counts list here once the block-calculator BOM is
          wired.
        </p>
      </div>
    </div>
  );
}
