// Guarded dev self-check for bag label printing (P413). Not part of the production build path —
// invoked once from BlocksApp in a NODE_ENV !== "production" effect and logged to console.
//
// Verifies computeBags only (no PDF): per-line bagging (4/bag, remainder last), sequential
// numbering across multiple lines sharing one loaded PO, and that no bag mixes pieces from two
// different SKU lines.
import type { SkuLine } from "./blockTypes";
import { computeBags } from "./bagLabels";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function line(overrides: Partial<SkuLine>): SkuLine {
  return {
    item: "X",
    width: 50,
    length: 96,
    tlo: 4,
    thi: 5,
    density: 1.5,
    qty: 4,
    parsed: true,
    raw: "",
    ...overrides,
  };
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function runBagLabelsSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  // qty 14 -> 4 bags, pieces [4,4,4,2]
  {
    const bags = computeBags([line({ item: "A", qty: 14 })]);
    const pieces = bags.map((b) => b.piecesInBag);
    check(
      "qty 14 -> 4 bags [4,4,4,2]",
      bags.length === 4 && arraysEqual(pieces, [4, 4, 4, 2]),
      `bags=${bags.length} pieces=${JSON.stringify(pieces)}`
    );
    check(
      "qty 14 -> totalBags=4 on every entry",
      bags.every((b) => b.totalBags === 4),
      `totalBags=${JSON.stringify(bags.map((b) => b.totalBags))}`
    );
  }

  // qty 4 -> 1 bag [4]
  {
    const bags = computeBags([line({ item: "B", qty: 4 })]);
    check(
      "qty 4 -> 1 bag [4]",
      bags.length === 1 && arraysEqual(bags.map((b) => b.piecesInBag), [4]),
      `bags=${JSON.stringify(bags.map((b) => b.piecesInBag))}`
    );
  }

  // qty 1 -> 1 bag [1]
  {
    const bags = computeBags([line({ item: "C", qty: 1 })]);
    check(
      "qty 1 -> 1 bag [1]",
      bags.length === 1 && arraysEqual(bags.map((b) => b.piecesInBag), [1]),
      `bags=${JSON.stringify(bags.map((b) => b.piecesInBag))}`
    );
  }

  // qty 5 -> 2 bags [4,1]
  {
    const bags = computeBags([line({ item: "D", qty: 5 })]);
    check(
      "qty 5 -> 2 bags [4,1]",
      bags.length === 2 && arraysEqual(bags.map((b) => b.piecesInBag), [4, 1]),
      `bags=${JSON.stringify(bags.map((b) => b.piecesInBag))}`
    );
  }

  // sequential numbering across 2+ lines: qty 4 then qty 6 -> bag numbers 1,2,3, totalBags=3, pieces [4,4,2]
  {
    const bags = computeBags([line({ item: "E", qty: 4 }), line({ item: "F", qty: 6 })]);
    const numbers = bags.map((b) => b.bagNumber);
    const pieces = bags.map((b) => b.piecesInBag);
    check(
      "sequential numbering across 2 lines: numbers [1,2,3]",
      arraysEqual(numbers, [1, 2, 3]),
      `numbers=${JSON.stringify(numbers)}`
    );
    check(
      "sequential numbering across 2 lines: pieces [4,4,2]",
      arraysEqual(pieces, [4, 4, 2]),
      `pieces=${JSON.stringify(pieces)}`
    );
    check(
      "sequential numbering across 2 lines: totalBags=3 on every entry",
      bags.every((b) => b.totalBags === 3),
      `totalBags=${JSON.stringify(bags.map((b) => b.totalBags))}`
    );
  }

  // no SKU shares a bag: each bag's item matches exactly one source line
  {
    const bags = computeBags([line({ item: "G", qty: 4 }), line({ item: "H", qty: 6 })]);
    const gBags = bags.filter((b) => b.item === "G");
    const hBags = bags.filter((b) => b.item === "H");
    check(
      "no SKU shares a bag (G bags all item G, H bags all item H)",
      gBags.length === 1 && hBags.length === 2 && bags.every((b) => b.item === "G" || b.item === "H"),
      `gBags=${gBags.length} hBags=${hBags.length}`
    );
  }

  // qty 0 lines are excluded entirely
  {
    const bags = computeBags([line({ item: "I", qty: 0 }), line({ item: "J", qty: 4 })]);
    check(
      "qty 0 lines produce no bags",
      bags.length === 1 && bags[0].item === "J",
      `bags=${JSON.stringify(bags.map((b) => b.item))}`
    );
  }

  return { pass: results.every((r) => r.pass), results };
}
