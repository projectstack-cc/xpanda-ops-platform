"use client";
import type { CuttingJob } from "./types";

interface Props {
  job: CuttingJob;
  line: string;
  onToggle: (lineItemId: string, completed: boolean) => void;
  onSetChunkTarget?: (qtyTarget: number) => void;
  busy: boolean;
  readOnly?: boolean;
  // P384: manager-gate for the HB guillotine (Main/Blue) manual chunk override — independent of
  // `readOnly` (clock-in state), since a manager sets this without being clocked into the line.
  canManageChunks?: boolean;
}

// Docked parts checklist for a single cutting line (the operator's clocked-in line).
// Cross Cutter / Hole Cutter really work in chunks; until the block-calc BOM is wired, every line
// shows the same parts list and the chunk note below stands in.
export default function PartsPanel({
  job,
  line,
  onToggle,
  onSetChunkTarget,
  busy,
  readOnly,
  canManageChunks,
}: Props) {
  const items = job.line_items ?? [];
  const prog = job.progress?.[line] ?? {};
  const doneCount = items.filter((it) => prog[it.id]?.completed).length;

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-surface">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {line} — parts
        </span>
        <span className="flex items-center gap-2">
          {readOnly && (
            <span className="text-xs text-muted">Start this line to edit</span>
          )}
          <span className="font-mono tabular-nums text-xs text-muted">
            {doneCount}/{items.length}
          </span>
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
                    disabled={busy || readOnly}
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

      {(() => {
        const lineRow = job.lines?.find((l) => l.line === line);
        // Part lines carry a real target now; chunk lines still await the block-calc engine.
        if (lineRow && lineRow.unit === "part" && lineRow.qty_target != null) {
          return (
            <div className="m-3 rounded border border-border px-3 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Target — parts to produce
              </span>
              <p className="font-mono tabular-nums text-sm text-text mt-1">
                {lineRow.qty_target}
              </p>
            </div>
          );
        }
        if (lineRow && lineRow.unit === "chunk") {
          // P382/P384: HB guillotine (Main/Blue) chunk lines — manual override is manager-only,
          // independent of clock-in (`readOnly`). No block-calc BOM applies here (that's the
          // taper/Cross-Cutter concept), so no "out of N blocks" line.
          // QC Cleanup-7 (AUDIT-302): the Cross Cutter chunk-input branch that used to share this
          // condition was removed — this component's `line` is always Main Line / Blue Line here
          // (Cross Cutter moved to the standalone /v2/cutting/crosscutter board), so `isHbGuillotine`
          // is the only way into this branch now.
          const isHbGuillotine =
            (line === "Main Line" || line === "Blue Line") && job.hb_chunks_required != null;

          if (isHbGuillotine) {
            if (!canManageChunks) {
              return (
                <div className="m-3 rounded border border-border px-3 py-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Chunks to cut
                  </span>
                  <p className="font-mono tabular-nums text-sm text-text mt-1">
                    {lineRow.qty_target ?? "—"}
                  </p>
                </div>
              );
            }
            return (
              <div className="m-3 rounded border border-border px-3 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Chunks to cut
                </span>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    placeholder="—"
                    defaultValue={lineRow.qty_target ?? ""}
                    disabled={busy}
                    aria-label="chunks to cut"
                    onBlur={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (v > 0 && v !== lineRow.qty_target) onSetChunkTarget?.(v);
                    }}
                    className="w-24 min-h-[44px] rounded border border-border bg-surface px-2 py-1 font-mono tabular-nums text-sm text-text disabled:opacity-50"
                  />
                  <span className="text-xs text-muted">chunks</span>
                </div>
                <p className="text-xs text-muted mt-2">Manual override — overrides the computed chunk count from order entry.</p>
              </div>
            );
          }

          // Hole Cutter (and any other non-HB-guillotine chunk line): mirrors the Cross Cutter
          // target, read-only. Still reachable — a job whose hb_chunks_required clears later
          // leaves a stale unit='chunk' cut_plan_lines row with isHbGuillotine false.
          return (
            <div className="m-3 rounded border border-border px-3 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Chunks to drill
              </span>
              <p className="font-mono tabular-nums text-sm text-text mt-1">
                {lineRow.qty_target ?? "—"}
              </p>
              {lineRow.qty_target == null && (
                <p className="text-xs text-muted mt-1">
                  Set on the Cross Cutter — this line mirrors it.
                </p>
              )}
            </div>
          );
        }
        return null;
      })()}
    </div>
  );
}
