// src/lib/linkedGroups.selfcheck.ts
// Guarded dev self-check for linkedGroups.ts (carrier-06) — the regression guard for the schedule
// board's linked-jobs rail after its helpers moved out of DayColumn.tsx. Mirrors
// productionSchedule.selfcheck.ts's shape. Not part of the production build path.
import { buildBlocks, countLocalGroups, groupRows, withGroupsAdjacent, type RowBlock } from "./linkedGroups";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

interface R {
  id: string;
  trailer_group_id: string | null;
}

const r = (id: string, g: string | null = null): R => ({ id, trailer_group_id: g });

// Compact shape: "[g:a,b]" for a grouped block, "a" for an ungrouped one.
function shape(blocks: RowBlock<R>[]): string[] {
  return blocks.map((b) => (b.grouped ? `[g:${b.rows.map((x) => x.id).join(",")}]` : b.rows.map((x) => x.id).join(",")));
}

export function runLinkedGroupsSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, got: unknown, want: unknown) =>
    check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

  // 1. Pair already adjacent → one grouped block, order untouched.
  eq("pair adjacent", shape(groupRows([r("a"), r("b", "G1"), r("c", "G1"), r("d")])), ["a", "[g:b,c]", "d"]);

  // 2. Pair split by an unrelated row → pulled adjacent, anchored at the FIRST member.
  eq("pair split", shape(groupRows([r("a", "G1"), r("x"), r("b", "G1"), r("y")])), ["[g:a,b]", "x", "y"]);

  // 3. Lone member (rest of the group on another day) → ungrouped block, id kept for the chip.
  const lone = groupRows([r("a"), r("b", "G9"), r("c")]);
  eq("lone member", shape(lone), ["a", "b", "c"]);
  eq("lone member keeps gid", lone[1].rows[0].trailer_group_id, "G9");

  // 4. No group ids at all → every row its own ungrouped block.
  eq("no group ids", shape(groupRows([r("a"), r("b"), r("c")])), ["a", "b", "c"]);

  // 5. Two different groups in one day, interleaved.
  eq(
    "two groups interleaved",
    shape(groupRows([r("a", "G1"), r("b", "G2"), r("c", "G1"), r("d", "G2"), r("e")])),
    ["[g:a,c]", "[g:b,d]", "e"]
  );

  // 6. Three-member group + a lone member of another group.
  eq("triple + lone", shape(groupRows([r("a", "G1"), r("z", "G5"), r("b", "G1"), r("c", "G1")])), ["[g:a,b,c]", "z"]);

  // 7. Empty list.
  eq("empty", groupRows<R>([]), []);

  // 8. groupRows is exactly count → adjacent → blocks (DayColumn's sequence).
  const input = [r("a", "G1"), r("x"), r("b", "G1"), r("q", "G2")];
  const counts = countLocalGroups(input);
  eq("counts", Array.from(counts.entries()), [["G1", 2], ["G2", 1]]);
  eq("groupRows == manual sequence", shape(groupRows(input)), shape(buildBlocks(withGroupsAdjacent(input, counts), counts)));

  // 9. Row count is conserved (no row dropped or duplicated).
  const many = [r("a", "G1"), r("b"), r("c", "G2"), r("d", "G1"), r("e", "G2"), r("f", "G3")];
  eq("conserves rows", groupRows(many).flatMap((b) => b.rows.map((x) => x.id)).sort(), ["a", "b", "c", "d", "e", "f"]);

  return { pass: results.every((x) => x.pass), results };
}
