"use client";
import type { CuttingJob } from "./types";

interface Props {
  job: CuttingJob;
  line: string;
  onToggle: (lineItemId: string, completed: boolean) => void;
  onSetYield?: (yieldPerChunk: number) => void;
  onSetChunkTarget?: (qtyTarget: number) => void;
  busy: boolean;
}

// Docked parts checklist for a single cutting line (the operator's clocked-in line).
// Cross Cutter / Hole Cutter really work in chunks; until the block-calc BOM is wired, every line
// shows the same parts list and the chunk note below stands in.
export default function PartsPanel({ job, line, onToggle, onSetYield, onSetChunkTarget, busy }: Props) {
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
          // Taper orders: Cross Cutter's chunk count derives from the per-job yield.
          // Manual yield input (prefilled) + computed chunks-required from the line target.
          if (job.is_taper && line === "Cross Cutter") {
            return (
              <div className="m-3 rounded border border-border px-3 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Taper chunks
                </span>
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-xs text-muted">Yield / chunk</label>
                  <input
                    type="number"
                    min={1}
                    defaultValue={job.taper_yield ?? 12}
                    disabled={busy}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (v > 0 && v !== (job.taper_yield ?? 12)) onSetYield?.(v);
                    }}
                    className="w-16 rounded border border-border bg-surface px-2 py-1 font-mono tabular-nums text-sm text-text disabled:opacity-50"
                  />
                </div>
                <p className="text-xs text-muted mt-2">
                  Chunks required:{" "}
                  <span className="font-mono tabular-nums text-sm text-text">
                    {lineRow.qty_target ?? "—"}
                  </span>
                  {job.taper_yield == null && <span className="text-muted"> (default yield)</span>}
                </p>
              </div>
            );
          }
          const isFabricator =
            line === "Cross Cutter" && (job.requiredLines?.length ?? 0) === 1;
          const unitWord = isFabricator ? "parts" : "chunks";
          const blocks = job.blocks_needed;

          if (line === "Cross Cutter") {
            return (
              <div className="m-3 rounded border border-border px-3 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {isFabricator ? "Parts to cut" : "Chunks to cut"}
                </span>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    placeholder="—"
                    defaultValue={lineRow.qty_target ?? ""}
                    disabled={busy}
                    aria-label={`${unitWord} to cut`}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (v > 0 && v !== lineRow.qty_target) onSetChunkTarget?.(v);
                    }}
                    className="w-24 min-h-[44px] rounded border border-border bg-surface px-2 py-1 font-mono tabular-nums text-sm text-text disabled:opacity-50"
                  />
                  <span className="text-xs text-muted">{unitWord}</span>
                </div>
                <p className="text-xs text-muted mt-2">
                  {lineRow.qty_target != null && blocks != null ? (
                    <>
                      <span className="font-mono tabular-nums text-sm text-text">
                        {lineRow.qty_target}
                      </span>{" "}
                      {unitWord} out of{" "}
                      <span className="font-mono tabular-nums text-sm text-text">{blocks}</span>{" "}
                      {blocks === 1 ? "block" : "blocks"}
                    </>
                  ) : blocks != null ? (
                    <>
                      <span className="font-mono tabular-nums text-sm text-text">{blocks}</span>{" "}
                      {blocks === 1 ? "block" : "blocks"} needed — set the {unitWord} count
                    </>
                  ) : (
                    <>Save a cut plan to see blocks needed.</>
                  )}
                </p>
              </div>
            );
          }

          // Hole Cutter: drills the chunks the Cross Cutter made — mirrors that target, read-only.
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
