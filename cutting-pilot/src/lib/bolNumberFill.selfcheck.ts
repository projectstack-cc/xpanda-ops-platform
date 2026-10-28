// src/lib/bolNumberFill.selfcheck.ts
// Guarded dev self-check for bolNumberFill.ts (lb-ui-13). Same check()/results shape as
// deliveryTime.selfcheck.ts. Not part of the production build path.
import { fillBolNumbers, reconcileBolNumbers, removeBolIndices, seedBolNumber } from "./bolNumberFill";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export function runBolNumberFillSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, got: unknown, want: unknown) =>
    check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

  // ── fillBolNumbers: the BolGenerateModal rule ────────────────────────────────────────────
  const fill = fillBolNumbers(["", "", ""], [false, false, false], 0, "4440-01");
  eq("fill: trailer 1 prefix-## fills blanks", fill, { numbers: ["4440-01", "4440-02", "4440-03"], autoFilled: [false, true, true] });
  eq("fill: keeps digit width", fillBolNumbers(["", ""], [false, false], 0, "A-009").numbers, ["A-009", "A-010"]);

  const handTyped = fillBolNumbers(["4440-01", "4440-02", "4440-03"], [false, true, true], 2, "SPECIAL");
  eq("hand edit clears that trailer's flag", handTyped.autoFilled, [false, true, false]);
  const refill = fillBolNumbers(handTyped.numbers, handTyped.autoFilled, 0, "4440-05");
  eq("no clobber: re-edit of trailer 1 leaves a hand-typed value", refill.numbers, ["4440-05", "4440-06", "SPECIAL"]);
  eq("re-edit of trailer 1 refreshes still-auto trailers", refill.autoFilled, [false, true, false]);
  eq("no prefix-## shape → only trailer 1 changes", fillBolNumbers(["", "x"], [false, true], 0, "4440").numbers, ["4440", "x"]);
  eq("edit of a later trailer never fills others", fillBolNumbers(["", "", ""], [false, false, false], 1, "9-01").numbers, ["", "9-01", ""]);
  const inputs = ["a", "b"];
  fillBolNumbers(inputs, [false, false], 0, "z-1");
  eq("inputs are not mutated", inputs, ["a", "b"]);

  // ── seeding + reconcile ──────────────────────────────────────────────────────────────────
  eq("seed one trailer = bare invoice", seedBolNumber("4440", 0, 1), "4440");
  eq("seed multi = INV-0N", [seedBolNumber("4440", 0, 3), seedBolNumber("4440", 2, 3)], ["4440-01", "4440-03"]);
  eq("seed manual load (no invoice) = blank", seedBolNumber("", 1, 3), "");
  eq("fresh 3-trailer order", reconcileBolNumbers(null, 3, "4440").numbers, ["4440-01", "4440-02", "4440-03"]);
  eq("fresh manual load stays blank", reconcileBolNumbers(null, 2, "").numbers, ["", ""]);
  const one = reconcileBolNumbers(null, 1, "4440");
  eq("1 → 3 re-pack re-seeds the untouched bare invoice", reconcileBolNumbers(one, 3, "4440").numbers, ["4440-01", "4440-02", "4440-03"]);
  const typed = fillBolNumbers(reconcileBolNumbers(null, 3, "4440").numbers, [true, true, true], 1, "MINE");
  eq("3 → 4 keeps a hand-typed value by index", reconcileBolNumbers(typed, 4, "4440").numbers, ["4440-01", "MINE", "4440-03", "4440-04"]);
  eq("3 → 2 drops trailers past the new count", reconcileBolNumbers(typed, 2, "4440").numbers, ["4440-01", "MINE"]);
  const typedFirst = fillBolNumbers(["", ""], [true, true], 0, "B-07");
  eq("re-pack after a typed trailer 1 continues its sequence", reconcileBolNumbers(typedFirst, 3, "4440").numbers, ["B-07", "B-08", "B-09"]);

  // ── lb-trailer-01: removeBolIndices (an empty trailer dropped) ───────────────────────────
  const typed4527 = { numbers: ["4527-01", "4527-02", "4527-03"], autoFilled: [false, false, false] };
  eq("remove [1] from hand-typed keeps each number on its trailer", removeBolIndices(typed4527, [1]), { numbers: ["4527-01", "4527-03"], autoFilled: [false, false] });
  eq("remove [] is a copy", removeBolIndices(typed4527, []), typed4527);
  eq("remove does not mutate its input", typed4527.numbers, ["4527-01", "4527-02", "4527-03"]);
  const autoSet = reconcileBolNumbers(null, 3, "4527");
  eq("auto-filled set, remove [1] + reconcile → re-seeded for 2", reconcileBolNumbers(removeBolIndices(autoSet, [1]), 2, "4527").numbers, ["4527-01", "4527-02"]);
  const mixed = fillBolNumbers(autoSet.numbers, autoSet.autoFilled, 2, "SPECIAL");
  eq("remove [1] + reconcile keeps a hand-typed trailer 3 as the new trailer 2", reconcileBolNumbers(removeBolIndices(mixed, [1]), 2, "4527").numbers, ["4527-01", "SPECIAL"]);

  return { pass: results.every((r) => r.pass), results };
}
