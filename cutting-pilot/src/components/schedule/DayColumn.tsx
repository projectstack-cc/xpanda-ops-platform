// src/components/schedule/DayColumn.tsx
// One weekday column within a WeekBand: header (day + date) + its order rows. Clips to
// `rowCap` and shows a "+N more" chip rather than shrinking text past the legibility floor.
//
// Linked-jobs rail (trailer_group_id, PXXX 3/3): a group's members render inside a shared
// left-rail block instead of as plain rows. The rail is derived from trailer_group_id, never
// from sheet sort_order adjacency — the sheet updater is not a reliable source for "these rows
// belong together" (see status-write-site-inventory.md-adjacent design note in the prompt: a
// rail from adjacency alone would span two unrelated customers the first time the sheet doesn't
// stack them). Sheet stacking just means `withGroupsAdjacent` below is normally a no-op.
import type { ScheduleBoardRow } from "@/types/schedule";
import OrderRow from "./OrderRow";
import type { Density } from "./density";

function formatDayHeader(dayOfWeek: string, shipDate: string | null): string {
  const short = dayOfWeek.slice(0, 3);
  if (!shipDate) return short;
  const parts = shipDate.split("-");
  if (parts.length !== 3) return short;
  const [, month, day] = parts;
  return `${short} ${Number(month)}/${Number(day)}`;
}

interface DayColumnProps {
  dayOfWeek: string;
  shipDate: string | null;
  rows: ScheduleBoardRow[];
  density: Density;
  rowCap: number;
}

// Only a trailer_group_id with >=2 rows PRESENT IN THIS COLUMN counts as a local group. A count
// of exactly 1 means the rest of the group is in a different day column (the sheet disagrees
// about the ship date) — that's rendered as a link chip on the lone row (OrderRow's
// `orphanedGroup`), never a rail spanning nothing.
function countLocalGroups(rows: ScheduleBoardRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.trailer_group_id) continue;
    counts.set(r.trailer_group_id, (counts.get(r.trailer_group_id) ?? 0) + 1);
  }
  return counts;
}

// Pulls each local group's rows adjacent, anchored at the position of its first member, so the
// rail below renders as one continuous block. No-op when the sheet already stacks them (the
// common case, per Steve).
function withGroupsAdjacent(rows: ScheduleBoardRow[], localCount: Map<string, number>): ScheduleBoardRow[] {
  const out: ScheduleBoardRow[] = [];
  const consumed = new Set<number>();
  const started = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    if (consumed.has(i)) continue;
    const gid = rows[i].trailer_group_id;
    if (gid && (localCount.get(gid) ?? 0) >= 2 && !started.has(gid)) {
      started.add(gid);
      for (let j = i; j < rows.length; j++) {
        if (!consumed.has(j) && rows[j].trailer_group_id === gid) {
          out.push(rows[j]);
          consumed.add(j);
        }
      }
    } else {
      out.push(rows[i]);
      consumed.add(i);
    }
  }
  return out;
}

interface RowBlock {
  grouped: boolean;
  rows: ScheduleBoardRow[];
}

// Contiguous runs sharing a locally-multi-member trailer_group_id become one grouped block;
// everything else is its own single-row block. Run this AFTER withGroupsAdjacent so a group's
// rows are guaranteed contiguous here.
function buildBlocks(rows: ScheduleBoardRow[], localCount: Map<string, number>): RowBlock[] {
  const blocks: RowBlock[] = [];
  let i = 0;
  while (i < rows.length) {
    const gid = rows[i].trailer_group_id;
    if (gid && (localCount.get(gid) ?? 0) >= 2) {
      const block: ScheduleBoardRow[] = [];
      while (i < rows.length && rows[i].trailer_group_id === gid) {
        block.push(rows[i]);
        i++;
      }
      blocks.push({ grouped: true, rows: block });
    } else {
      blocks.push({ grouped: false, rows: [rows[i]] });
      i++;
    }
  }
  return blocks;
}

// Slot-priority clipping (Steve-locked decision, third override on top of sort_order after
// group adjacency and the rail itself — a future reader seeing rows out of strict sort_order
// here is not a bug, don't "fix" it back). Grouped blocks always win a slot and are NEVER
// partially clipped — they render in full regardless of rowCap. Only ungrouped rows absorb the
// clipping into "+N more", which is why `overflow` below counts dropped rows directly rather
// than `rows.length - visible.length` (a full group can legitimately push visible row-count past
// rowCap without anything having been dropped).
function selectVisible(blocks: RowBlock[], rowCap: number): { visible: RowBlock[]; overflow: number } {
  const visible: RowBlock[] = [];
  let used = 0;
  let dropped = 0;
  for (const block of blocks) {
    if (block.grouped) {
      visible.push(block);
      used += block.rows.length;
    } else if (used < rowCap) {
      visible.push(block);
      used += 1;
    } else {
      dropped += 1;
    }
  }
  return { visible, overflow: dropped };
}

export default function DayColumn({ dayOfWeek, shipDate, rows, density, rowCap }: DayColumnProps) {
  const localCount = countLocalGroups(rows);
  const ordered = withGroupsAdjacent(rows, localCount);
  const blocks = buildBlocks(ordered, localCount);
  const { visible, overflow } = selectVisible(blocks, rowCap);

  return (
    <div className="min-h-0 min-w-0 flex flex-col bg-[var(--surface)]">
      <div className="shrink-0 flex items-baseline justify-between gap-1 px-1.5 py-0.5 border-b border-[var(--line)]">
        <span className="font-mono tabular-nums text-[clamp(0.6875rem,1vh,0.8rem)] font-semibold text-text">
          {formatDayHeader(dayOfWeek, shipDate)}
        </span>
        <span className="font-mono tabular-nums text-[10px] text-text-faint">{rows.length}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {visible.length === 0 ? (
          <div className="px-1.5 py-2 text-[10px] italic text-text-faint">No loads</div>
        ) : (
          visible.map((block, bi) => {
            const isLastBlock = bi === visible.length - 1;
            return block.grouped ? (
              <div key={`group-${block.rows[0].trailer_group_id}`} className="border-l-2 border-[var(--brand)]">
                {block.rows.map((row, i) => (
                  <OrderRow
                    key={`${row.invoice_number}-${row.job_id ?? i}`}
                    row={row}
                    density={density}
                    isLastInColumn={isLastBlock && i === block.rows.length - 1}
                  />
                ))}
              </div>
            ) : (
              <OrderRow
                key={`${block.rows[0].invoice_number}-${block.rows[0].job_id ?? bi}`}
                row={block.rows[0]}
                density={density}
                orphanedGroup={!!block.rows[0].trailer_group_id}
                isLastInColumn={isLastBlock}
              />
            );
          })
        )}
        {overflow > 0 && (
          <div className="px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand)]">
            +{overflow} more
          </div>
        )}
      </div>
    </div>
  );
}
