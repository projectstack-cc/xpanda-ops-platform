"use client";
// Cut-sheet renderer — consumes the P411 nester's NestResult. Per density → per mold → per
// chunk: a table (item, taper, qty, part W×L, trimmed flag) beside the cut diagram. Header shows
// the board-foot split (finished / carried-forward / scrap) per density + total.
import type { BlockSizes, NestResult } from "@/lib/blockTypes";
import { nestTotals } from "@/lib/blockNester";
import ChunkElevation from "./ChunkElevation";

interface Props {
  result: NestResult;
  blockSizes: BlockSizes;
}

function bfSplit(finishedBF: number, carriedForwardBF: number, scrapBF: number): string {
  return `finished ${finishedBF.toFixed(2)} BF · carried-forward ${carriedForwardBF.toFixed(
    2
  )} BF · scrap ${scrapBF.toFixed(2)} BF`;
}

export default function CutSheet({ result, blockSizes }: Props) {
  const densities = Object.keys(result)
    .map(Number)
    .sort((a, b) => a - b);

  if (densities.length === 0) {
    return <p className="text-sm text-muted">No parsed SKUs with quantity to nest.</p>;
  }

  const totals = nestTotals(result);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border pb-2">
        <h3 className="text-base font-semibold text-text">Total</h3>
        <span className="text-xs font-mono tabular-nums text-muted">
          {totals.moldsNeeded} mold{totals.moldsNeeded === 1 ? "" : "s"} ·{" "}
          {bfSplit(totals.finishedBF, totals.carriedForwardBF, totals.scrapBF)}
        </span>
      </div>

      {densities.map((density) => {
        const key = String(density);
        const d = result[key];
        const block = blockSizes[key];
        return (
          <div key={key} className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h3 className="text-base font-semibold text-text">{density}# density</h3>
              <span className="text-xs font-mono tabular-nums text-muted">
                {d.moldsNeeded} mold{d.moldsNeeded === 1 ? "" : "s"} · volume floor{" "}
                {d.volumeFloor.toFixed(2)} · {bfSplit(d.finishedBF, d.carriedForwardBF, d.scrapBF)}
              </span>
            </div>

            {d.blocks.map((mold, moldIdx) => (
              <div key={moldIdx} className="border border-border rounded p-3 space-y-3">
                <p className="text-xs font-semibold text-muted uppercase tracking-wide">
                  Mold {moldIdx + 1} of {d.moldsNeeded}
                </p>
                {mold.chunks.map((chunk, chunkIdx) => (
                  <div key={chunkIdx} className="flex flex-col md:flex-row gap-3">
                    <div className="overflow-x-auto flex-1 min-w-0">
                      <table className="w-full text-xs border-collapse">
                        <caption className="text-left text-[11px] text-muted pb-1 caption-top">
                          Chunk {chunkIdx + 1}: {chunk.width}&quot; wide × {chunk.length}&quot; long
                        </caption>
                        <thead>
                          <tr className="bg-[var(--surface-2)] text-left text-muted">
                            <th className="px-2 py-1.5 font-medium">Item</th>
                            <th className="px-2 py-1.5 font-medium">Taper</th>
                            <th className="px-2 py-1.5 font-medium">Qty</th>
                            <th className="px-2 py-1.5 font-medium">Part W×L</th>
                            <th className="px-2 py-1.5 font-medium">Trimmed</th>
                          </tr>
                        </thead>
                        <tbody>
                          {chunk.lines.map((line, lineIdx) => (
                            <tr
                              key={lineIdx}
                              className="border-t border-border"
                              style={line.trimmedFrom ? { background: "var(--warn-bg)" } : undefined}
                            >
                              <td className="px-2 py-1.5 text-text">{line.item || "—"}</td>
                              <td className="px-2 py-1.5 font-mono tabular-nums text-text">
                                {line.tlo}&quot;→{line.thi}&quot;
                              </td>
                              <td className="px-2 py-1.5 font-mono tabular-nums text-text">{line.qty}</td>
                              <td className="px-2 py-1.5 font-mono tabular-nums text-text">
                                {line.partWidth}&quot; × {line.partLength}&quot;
                              </td>
                              <td className="px-2 py-1.5 text-[var(--warn-text)]">
                                {line.trimmedFrom
                                  ? `✓ (was ${line.trimmedFrom.width}" × ${line.trimmedFrom.length}")`
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="md:w-[220px] shrink-0">
                      {block && <ChunkElevation chunk={chunk} block={block} />}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
