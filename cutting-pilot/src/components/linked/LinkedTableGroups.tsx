"use client";
// src/components/linked/LinkedTableGroups.tsx
// Linked orders (jobs.trailer_group_id) inside a day <table> (link-01) — the table counterpart of
// app/carrier/LinkedGroup.tsx, shared by /v2/board (ProductionBoard) and /v2/logistics
// (ShipmentDashboard). Grouping reuses src/lib/linkedGroups.ts (groupRows), so members are pulled
// adjacent exactly as on the schedule board and Carrier View.
//   - Each grouped block is its own <tbody> with a full 2px brand border. Tailwind preflight sets
//     border-collapse: collapse, where a row group honors its own border, and any expansion <tr>s
//     a row renders (BoardRowEdit, ShipmentRow's drill-down) fall inside it automatically.
//   - Contiguous ungrouped rows are merged into ONE plain <tbody>, never one per row: the rows use
//     `last:border-0`, so one-row tbodies would strip every row divider.
//   - No orphan chip, deliberately. Linked orders share a ship date (one trailer), so a lone member
//     in a day list only means search/a filter hid its partner — it renders as a plain row.
import { Fragment, type ReactNode } from "react";
import { Link2 } from "lucide-react";
import { groupRows, type GroupKeyed } from "@/lib/linkedGroups";

export default function LinkedTableGroups<T extends GroupKeyed>({
  rows,
  colSpan,
  keyOf,
  renderRow,
}: {
  /** One day's rows, already filtered/sorted by the caller. */
  rows: T[];
  /** The table's column count (the header row spans it). */
  colSpan: number;
  keyOf: (row: T, index: number) => string;
  /** The row's existing <tr>(s), unchanged. */
  renderRow: (row: T) => ReactNode;
}) {
  const out: ReactNode[] = [];
  let plain: T[] = [];

  const flushPlain = () => {
    if (!plain.length) return;
    out.push(
      <tbody key={`plain-${keyOf(plain[0], 0)}`}>
        {plain.map((row, i) => (
          <Fragment key={keyOf(row, i)}>{renderRow(row)}</Fragment>
        ))}
      </tbody>
    );
    plain = [];
  };

  for (const block of groupRows(rows)) {
    if (!block.grouped) {
      plain.push(...block.rows);
      continue;
    }
    flushPlain();
    out.push(
      <tbody key={`group-${block.rows[0].trailer_group_id}`} className="border-2 border-[var(--brand)]">
        <tr>
          <td colSpan={colSpan} className="p-0">
            <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs font-semibold text-[var(--brand)]">
              <Link2 size={14} aria-hidden="true" />
              Linked · same trailer
            </div>
          </td>
        </tr>
        {block.rows.map((row, i) => (
          <Fragment key={keyOf(row, i)}>{renderRow(row)}</Fragment>
        ))}
      </tbody>
    );
  }
  flushPlain();

  return <>{out}</>;
}
