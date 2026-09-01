// src/components/schedule/DayColumn.tsx
// One weekday column within a WeekBand: header (day + date) + its order rows, then birthdays.
// Rows render at one roomy size and, when they overflow the column height, crawl in a seamless
// loop (AutoScrollColumn) — the board no longer clips to a rowCap or sheds fields.
//
// Linked-jobs rail (trailer_group_id): a group's members render inside a shared left-rail block
// instead of as plain rows. The rail is derived from trailer_group_id, never from sheet sort_order
// adjacency. Sheet stacking just means `withGroupsAdjacent` is normally a no-op.
import type { ScheduleBoardRow, Birthday } from "@/types/schedule";
import OrderRow from "./OrderRow";
import AutoScrollColumn from "./AutoScrollColumn";

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
  birthdays: Birthday[];
}

// Only a trailer_group_id with >=2 rows PRESENT IN THIS COLUMN counts as a local group. A count of
// exactly 1 means the rest of the group is in another day column — rendered as a link chip on the
// lone row (OrderRow's `orphanedGroup`), never a rail spanning nothing.
function countLocalGroups(rows: ScheduleBoardRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.trailer_group_id) continue;
    counts.set(r.trailer_group_id, (counts.get(r.trailer_group_id) ?? 0) + 1);
  }
  return counts;
}

// Pulls each local group's rows adjacent, anchored at its first member. No-op when the sheet
// already stacks them (the common case).
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
// everything else is its own single-row block. Run AFTER withGroupsAdjacent.
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

export default function DayColumn({ dayOfWeek, shipDate, rows, birthdays }: DayColumnProps) {
  const localCount = countLocalGroups(rows);
  const ordered = withGroupsAdjacent(rows, localCount);
  const blocks = buildBlocks(ordered, localCount);

  return (
    <div className="min-h-0 min-w-0 flex flex-col bg-[var(--surface)]">
      <div className="shrink-0 flex items-baseline justify-between gap-1 px-1.5 py-0.5 border-b border-[var(--line)]">
        <span className="font-mono tabular-nums text-[clamp(0.6875rem,1vh,0.8rem)] font-semibold text-text">
          {formatDayHeader(dayOfWeek, shipDate)}
        </span>
        <span className="font-mono tabular-nums text-[10px] text-text-faint">{rows.length}</span>
      </div>

      <AutoScrollColumn>
        {blocks.length === 0 ? (
          <div className="px-1.5 py-2 text-[10px] italic text-text-faint">No loads</div>
        ) : (
          blocks.map((block, bi) =>
            block.grouped ? (
              <div
                key={`group-${block.rows[0].trailer_group_id}`}
                className="bg-[var(--surface-2)] border-l-2 border-t-2 border-b-2 border-[var(--brand)]"
              >
                {block.rows.map((row, i) => (
                  <OrderRow key={`${row.invoice_number}-${row.job_id ?? i}`} row={row} inGroup />
                ))}
              </div>
            ) : (
              <OrderRow
                key={`${block.rows[0].invoice_number}-${block.rows[0].job_id ?? bi}`}
                row={block.rows[0]}
                orphanedGroup={!!block.rows[0].trailer_group_id}
              />
            )
          )
        )}
      </AutoScrollColumn>

      {birthdays.length > 0 && (
        <div className="shrink-0 border-t border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-1">
          {birthdays.map((b) => (
            <div
              key={`${b.name}-${b.month}-${b.day}`}
              className="flex items-center gap-1 leading-tight text-[clamp(0.625rem,0.95vh,0.75rem)] font-semibold text-text"
            >
              <span aria-hidden="true">🎂</span>
              <span className="min-w-0 truncate">{b.name}</span>
              <span aria-hidden="true">🎉</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
