// src/components/schedule/DayColumn.tsx
// One weekday column within a WeekBand: header (day + date) + its order rows, then birthdays.
// Rows render at one roomy size and, when they overflow the column height, crawl in a seamless
// loop (AutoScrollColumn) — the board no longer clips to a rowCap or sheds fields.
//
// Linked-jobs rail (trailer_group_id): a group's members render inside a shared left-rail block
// instead of as plain rows. The rail is derived from trailer_group_id, never from sheet sort_order
// adjacency. Sheet stacking just means `withGroupsAdjacent` is normally a no-op.
// The grouping helpers live in src/lib/linkedGroups.ts (carrier-06), shared with the Carrier View.
import type { ScheduleBoardRow, Birthday } from "@/types/schedule";
import OrderRow from "./OrderRow";
import AutoScrollColumn from "./AutoScrollColumn";
import InteractiveScrollColumn from "./InteractiveScrollColumn";
import { buildBlocks, countLocalGroups, withGroupsAdjacent } from "@/lib/linkedGroups";

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
  // Desk board: use the hover-pausing scrollbar column and make rows clickable. Omitted on the TV
  // board → AutoScrollColumn + non-clickable rows, unchanged.
  interactive?: boolean;
  onSelectOrder?: (jobId: string) => void;
}

export default function DayColumn({ dayOfWeek, shipDate, rows, birthdays, interactive, onSelectOrder }: DayColumnProps) {
  const ScrollWrapper = interactive ? InteractiveScrollColumn : AutoScrollColumn;
  const localCount = countLocalGroups(rows);
  const ordered = withGroupsAdjacent(rows, localCount);
  const blocks = buildBlocks(ordered, localCount);

  return (
    <div className="min-h-0 min-w-0 flex flex-col bg-[var(--surface)]">
      <div
        className={
          interactive
            ? "sticky top-0 z-10 sm:static sm:z-auto shrink-0 flex items-baseline justify-between gap-1 px-3 py-2 sm:px-1.5 sm:py-0.5 border-b border-[var(--line)] bg-[var(--surface-2)] sm:bg-transparent"
            : "shrink-0 flex items-baseline justify-between gap-1 px-1.5 py-0.5 border-b border-[var(--line)]"
        }
      >
        <span
          className={
            interactive
              ? "font-mono tabular-nums text-sm sm:text-[clamp(0.6875rem,1vh,0.8rem)] font-semibold text-text"
              : "font-mono tabular-nums text-[clamp(0.6875rem,1vh,0.8rem)] font-semibold text-text"
          }
        >
          {formatDayHeader(dayOfWeek, shipDate)}
        </span>
        <span className={interactive ? "font-mono tabular-nums text-xs sm:text-[10px] text-text-faint" : "font-mono tabular-nums text-[10px] text-text-faint"}>{rows.length}</span>
      </div>

      <ScrollWrapper>
        {blocks.length === 0 ? (
          <div className={interactive ? "px-3 py-3 sm:px-1.5 sm:py-2 text-sm sm:text-[10px] italic text-text-faint" : "px-1.5 py-2 text-[10px] italic text-text-faint"}>No loads</div>
        ) : (
          blocks.map((block, bi) =>
            block.grouped ? (
              <div
                key={`group-${block.rows[0].trailer_group_id}`}
                className="bg-[var(--surface-2)] border-l-2 border-t-2 border-b-2 border-[var(--brand)]"
              >
                {block.rows.map((row, i) => (
                  <OrderRow key={`${row.invoice_number}-${row.job_id ?? i}`} row={row} inGroup onSelect={onSelectOrder} interactive={interactive} />
                ))}
              </div>
            ) : (
              <OrderRow
                key={`${block.rows[0].invoice_number}-${block.rows[0].job_id ?? bi}`}
                row={block.rows[0]}
                orphanedGroup={!!block.rows[0].trailer_group_id}
                interactive={interactive}
                onSelect={onSelectOrder}
              />
            )
          )
        )}
      </ScrollWrapper>

      {birthdays.length > 0 && (
        <div className={interactive ? "shrink-0 border-t border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 sm:px-1.5 sm:py-1" : "shrink-0 border-t border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-1"}>
          {birthdays.map((b) => (
            <div
              key={`${b.name}-${b.month}-${b.day}`}
              className={interactive ? "flex items-center gap-1 leading-tight text-sm sm:text-[clamp(0.625rem,0.95vh,0.75rem)] font-semibold text-text" : "flex items-center gap-1 leading-tight text-[clamp(0.625rem,0.95vh,0.75rem)] font-semibold text-text"}
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
