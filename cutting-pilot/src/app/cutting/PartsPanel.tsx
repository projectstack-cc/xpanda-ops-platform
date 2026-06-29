"use client";
import type { CuttingJob } from "./types";

interface Props {
  job: CuttingJob;
  line: string;
  onToggle: (lineItemId: string, completed: boolean) => void;
  busy: boolean;
}

// Docked parts checklist for a single cutting line (the operator's clocked-in line).
// Cross Cutter / Hole Cutter really work in chunks; until the block-calc BOM is wired, every line
// shows the same parts list and the chunk note below stands in.
export default function PartsPanel({ job, line, onToggle, busy }: Props) {
  const items = job.line_items ?? [];
  const prog = job.progress?.[line] ?? {};
  const doneCount = items.filter((it) => prog[it.id]?.completed).length;

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-surface">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {line} — parts
        </span>
        <span className="font-mono tabular-nums text-xs text-muted">
          {doneCount}/{items.length}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted">No parts on this order.</p>
      ) : (
        <ul className="divide-y divide-border">
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
                      <span className={`text-sm ${checked ? "text-muted line-through" : "text-text"}`}>
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
