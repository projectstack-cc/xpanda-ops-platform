// The "locked customer order" ground-truth fixture referenced by the P411 prompt (pieces
// 1#=303/1.5#=60/2#=48, greedy molds 1#=8/3/3, finishedBF=37,038) — provided by Steve 2026-08-26
// via "Foam Purchase Orders (2).xlsx"'s Sheet1 tab (20 line items, raw descriptions + Final QTY
// column). Real SKU codes/dims/qty only — no customer name, no pricing.
//
// Expected baseline (from that sheet's own totals, exact):
//   1#:   303 pieces
//   1.5#:  60 pieces
//   2#:    48 pieces
//   total BF (finished, invariant to packing/defaults): 37,037.85 (~37,038)
export interface LockedOrderRow {
  item: string;
  desc: string;
  qty: number;
}

export const LOCKED_ORDER_ROWS: LockedOrderRow[] = [
  { item: "R610", desc: "47.75 X (4X6) X 96 - 2#..(MISC)", qty: 8 },
  { item: "R2053", desc: "47.75 x (4 x 5)  x 96 - 2#", qty: 8 },
  { item: "R2049", desc: "47.75 x (4 x 5)  x 96 - 1#", qty: 28 },
  { item: "R526", desc: "47.75 X (3X5) X 96 -1#..(MISC)", qty: 30 },
  { item: "R2037", desc: "47.75 x (3x4) x 96 - 1.5", qty: 12 },
  { item: "R522", desc: "47.75 X (2X4) X 96 -1#..(MISC)", qty: 20 },
  { item: "R899", desc: "46.125 x (4x6) x 92.25 - 2# (MISC)", qty: 8 },
  { item: "R902", desc: "46.125 x (3x5) x 92.25 - 2# (MISC)", qty: 10 },
  { item: "R900", desc: "46.125 x (3x5) x 92.25 - 1# (MISC)", qty: 15 },
  { item: "R901", desc: "46.125 x (3x5) x 92.25 - 1.5# (MISC)", qty: 10 },
  { item: "R905", desc: "46.125 x (2x4) x 92.25 - 2# (MISC)", qty: 14 },
  { item: "R903", desc: "46.125 x (2x4) x 92.25 - 1# (MISC)", qty: 40 },
  { item: "R904", desc: "46.125 x (2x4) x 92.25 - 1.5# (MICR)", qty: 14 },
  { item: "R667", desc: "41.25 X (4X2) 84.25 - 1.5#", qty: 14 },
  { item: "R599", desc: "41.25 X (3X5) X 84.25-1#..(MISC/1406/5500)", qty: 30 },
  { item: "R988", desc: "40.25 x (2x4) x 82.25 - 1# (1206, Crossover, EB2)", qty: 40 },
  { item: "R597", desc: "39.25 X (3X5) X 80.25 - 1.5#..(MISC)", qty: 10 },
  { item: "R507", desc: "39.25 X (2X4) X 80.25 - 1#", qty: 20 },
  { item: "R1326", desc: "39.25 x (2x4) x 36.25 1# (Solo)", qty: 40 },
  { item: "R808", desc: "35.5 x (2X4) x 72.75 - 1# (LPCornerSpa)", qty: 40 },
];

export const LOCKED_ORDER_EXPECTED: Record<string, { parts: number; greedyMolds: number }> = {
  "1": { parts: 303, greedyMolds: 8 },
  "1.5": { parts: 60, greedyMolds: 3 },
  "2": { parts: 48, greedyMolds: 3 },
};

// The sheet's own total (row 23, TOTAL BF column) — not a recorded engine output. The self-check
// asserts this with tolerance (approxEq), not bit-exactness, so it isn't a snapshot baseline.
export const LOCKED_ORDER_FINISHED_BF = 37037.846354166664;
