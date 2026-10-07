"use client";
// src/app/carrier/LinkedGroup.tsx
// Linked orders (jobs.trailer_group_id) for every Carrier View tab (carrier-06) — one wrapper, no
// per-tab copies. Same treatment as the schedule board (components/schedule/DayColumn.tsx), using
// the same shared grouping (src/lib/linkedGroups.ts):
//   - >=2 members in this list → one block with the board's rail tokens + a "Linked · same
//     trailer" header; members render borderless inside it so the block reads as one unit.
//   - exactly 1 member in this list (rest on another day) → no rail; the row gets LinkedOrphanChip.
import { Fragment, type ReactNode } from "react";
import { Link2 } from "lucide-react";
import { groupRows, type GroupKeyed } from "@/lib/linkedGroups";

export interface LinkedRenderCtx {
  /** Rendered inside a group rail — drop the row's own outer border. */
  inGroup: boolean;
  /** Linked, but the rest of its group is on another day. */
  orphan: boolean;
}

export function LinkedOrphanChip() {
  const text = "Linked to an order on another day";
  return (
    <span
      title={text}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold border border-[var(--brand)] text-[var(--brand)]"
    >
      <Link2 size={12} aria-hidden="true" />
      <span aria-hidden="true">Linked</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

export default function LinkedGroupList<T extends GroupKeyed>({
  rows,
  keyOf,
  renderRow,
}: {
  rows: T[];
  keyOf: (row: T, index: number) => string;
  renderRow: (row: T, ctx: LinkedRenderCtx) => ReactNode;
}) {
  const blocks = groupRows(rows);
  return (
    <>
      {blocks.map((block, bi) =>
        block.grouped ? (
          <div
            key={`group-${block.rows[0].trailer_group_id}-${bi}`}
            className="shrink-0 rounded-r bg-[var(--surface-2)] border-l-2 border-t-2 border-b-2 border-[var(--brand)] overflow-hidden"
          >
            <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs font-semibold text-[var(--brand)]">
              <Link2 size={14} aria-hidden="true" />
              Linked · same trailer
            </div>
            <div className="divide-y divide-[var(--border)]">
              {block.rows.map((row, i) => (
                <Fragment key={keyOf(row, i)}>{renderRow(row, { inGroup: true, orphan: false })}</Fragment>
              ))}
            </div>
          </div>
        ) : (
          <Fragment key={keyOf(block.rows[0], bi)}>
            {renderRow(block.rows[0], { inGroup: false, orphan: !!block.rows[0].trailer_group_id })}
          </Fragment>
        )
      )}
    </>
  );
}
