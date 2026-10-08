// src/lib/linkedGroups.ts
// Linked-order (trailer_group_id) grouping, shared by the schedule board's DayColumn and the
// Carrier View (carrier-06). Moved verbatim out of components/schedule/DayColumn.tsx; only the
// types changed (ScheduleBoardRow → generic T). Regression guard: linkedGroups.selfcheck.ts.
//
// Semantics (schedule board): >=2 members of a group in the same list → one grouped block, members
// pulled adjacent (anchored at the first member). Exactly 1 member in the list → an ungrouped block
// (the caller renders a "linked to an order on another day" chip). No group id → ungrouped.

export interface GroupKeyed {
  trailer_group_id?: string | null;
}

// Only a trailer_group_id with >=2 rows PRESENT IN THIS COLUMN counts as a local group. A count of
// exactly 1 means the rest of the group is in another day column — rendered as a link chip on the
// lone row (OrderRow's `orphanedGroup`), never a rail spanning nothing.
export function countLocalGroups<T extends GroupKeyed>(rows: T[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.trailer_group_id) continue;
    counts.set(r.trailer_group_id, (counts.get(r.trailer_group_id) ?? 0) + 1);
  }
  return counts;
}

// Pulls each local group's rows adjacent, anchored at its first member. No-op when the sheet
// already stacks them (the common case).
export function withGroupsAdjacent<T extends GroupKeyed>(rows: T[], localCount: Map<string, number>): T[] {
  const out: T[] = [];
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

export interface RowBlock<T> {
  grouped: boolean;
  rows: T[];
}

// Contiguous runs sharing a locally-multi-member trailer_group_id become one grouped block;
// everything else is its own single-row block. Run AFTER withGroupsAdjacent.
export function buildBlocks<T extends GroupKeyed>(rows: T[], localCount: Map<string, number>): RowBlock<T>[] {
  const blocks: RowBlock<T>[] = [];
  let i = 0;
  while (i < rows.length) {
    const gid = rows[i].trailer_group_id;
    if (gid && (localCount.get(gid) ?? 0) >= 2) {
      const block: T[] = [];
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

/** The exact sequence DayColumn runs: count → pull adjacent → build blocks. */
export function groupRows<T extends GroupKeyed>(rows: T[]): RowBlock<T>[] {
  const localCount = countLocalGroups(rows);
  return buildBlocks(withGroupsAdjacent(rows, localCount), localCount);
}
