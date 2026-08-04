// Real PO#1 line items, extracted verbatim from xPanda_PO1_Nesting_Map.xlsx's
// "PO Parts (parsed)" sheet (raw description column) — provided by Steve, 2026-08-04. Used by
// both dev self-checks (poParser.selfcheck.ts, blockNester.selfcheck.ts) to validate against the
// real, manager-hand-checked baseline instead of synthetic fixtures.
//
// Expected baseline (from the same file's Summary sheet, exact):
//   1#:   18 SKUs, 302 parts, 10 molds (greedy), volume floor 6.31, 0 scrap wedges
//   1.5#: 13 SKUs,  74 parts,  3 molds (greedy), volume floor 2.03, 0 scrap wedges
//   2#:   16 SKUs,  59 parts,  3 molds (greedy), volume floor 2.09, 3 scrap wedges
export interface Po1FixtureRow {
  item: string;
  desc: string;
  qty: number;
}

export const PO1_ROWS: Po1FixtureRow[] = [
  { item: "R1712", desc: "50 x (4x3) x 102 - 1#", qty: 2 },
  { item: "R687", desc: "50.00 X (5X4) X 96.00 - 1#", qty: 4 },
  { item: "R2052", desc: "47.75 x (5 x 6)  x 96 - 1#", qty: 2 },
  { item: "R2049", desc: "47.75 x (4 x 5)  x 96 - 1#", qty: 4 },
  { item: "R526", desc: "47.75 X (3X5) X 96 -1#..(MISC)", qty: 4 },
  { item: "R522", desc: "47.75 X (2X4) X 96 -1#..(MISC)", qty: 2 },
  { item: "R900", desc: "46.125 x (3x5) x 92.25 - 1# (MISC)", qty: 8 },
  { item: "R903", desc: "46.125 x (2x4) x 92.25 - 1# (MISC)", qty: 20 },
  { item: "R913", desc: "46.125 x (4x6) x 92.25 - 1# (MISC)", qty: 2 },
  { item: "R599", desc: "41.25 X (3X5) X 84.25-1#..(MISC/1406/5500)", qty: 10 },
  { item: "R506", desc: "41.25 X (2X4) X 84.25-1#..(MICR)", qty: 4 },
  { item: "R670", desc: "41.25 X (4X6) X 84.25 - 1#", qty: 2 },
  { item: "R599", desc: "41.25 X (3X5) X 84.25-1#..(MISC/1406/5500)", qty: 24 },
  { item: "R506", desc: "41.25 X (2X4) X 84.25-1#..(MICR)", qty: 12 },
  { item: "R988", desc: "40.25 x (2x4) x 82.25 - 1# (1206, Crossover, EB2)", qty: 24 },
  { item: "R988", desc: "40.25 x (2x4) x 82.25 - 1# (1206, Crossover, EB2)", qty: 60 },
  { item: "R664", desc: "39.25 X (4X6) X 80.25 - 1#", qty: 2 },
  { item: "R609", desc: "39.25 X (3X5) X 80.25 -1#..(MISC)", qty: 2 },
  { item: "R507", desc: "39.25 X (2X4) X 80.25 - 1#", qty: 8 },
  { item: "R507", desc: "39.25 X (2X4) X 80.25 - 1#", qty: 6 },
  { item: "R808", desc: "35.5 x (2X4) x 72.75 - 1# (LPCornerSpa)", qty: 60 },
  { item: "R1326", desc: "39.25 x (2x4) x 36.25 1# (Solo)", qty: 40 },
  { item: "R1118", desc: "50 X (5X6) X 104 - 1.5#", qty: 2 },
  { item: "R2037", desc: "47.75 x (3x4) x 96 - 1.5", qty: 2 },
  { item: "R612", desc: "47.75 X (2X4) X 96 - 1.5#..(MISC)", qty: 2 },
  { item: "R601", desc: "47.75 X (3X5) X 96 - 1.5#..(MISC)", qty: 2 },
  { item: "R2038", desc: "46.13 x (3x4) x 92.25 - 1.5", qty: 4 },
  { item: "R2051", desc: "46.125 x (4 x 5)  x 92.25 - 1.5#", qty: 4 },
  { item: "R901", desc: "46.125 x (3x5) x 92.25 - 1.5# (MISC)", qty: 8 },
  { item: "R904", desc: "46.125 x (2x4) x 92.25 - 1.5# (MICR)", qty: 18 },
  { item: "R594", desc: "41.25 X (3X5) X 84.25 - 1.5#..(MISC)", qty: 2 },
  { item: "R667", desc: "41.25 X (4X2) 84.25 - 1.5#", qty: 12 },
  { item: "R671", desc: "41.25 X (4X6) X 84.25 - 1.5#", qty: 2 },
  { item: "R667", desc: "41.25 X (4X2) 84.25 - 1.5#", qty: 2 },
  { item: "R597", desc: "39.25 X (3X5) X 80.25 - 1.5#..(MISC)", qty: 2 },
  { item: "R662", desc: "39.25 X (4X2) X 80.25 - 1.5#", qty: 10 },
  { item: "R662", desc: "39.25 X (4X2) X 80.25 - 1.5#", qty: 2 },
  { item: "R699", desc: "49.5 X (5X3) X 102.00 - 2#", qty: 2 },
  { item: "R888", desc: "48 X (6 X 4) X 102 2#", qty: 2 },
  { item: "R2053", desc: "47.75 x (4 x 5)  x 96 - 2#", qty: 2 },
  { item: "R603", desc: "47.75 X (3X5) X 96 - 2#..(MISC)", qty: 4 },
  { item: "R603", desc: "47.75 X (3X5) X 96 - 2#..(MISC)", qty: 4 },
  { item: "R520", desc: "47.75 X (2X4) X 96 - 2#..(MISC)", qty: 2 },
  { item: "R2073", desc: "47.75 x (5 x 6)  x 96 - 2#", qty: 1 },
  { item: "R610", desc: "47.75 X (4X6) X 96 - 2#..(MISC)", qty: 5 },
  { item: "R520", desc: "47.75 X (2X4) X 96 - 2#..(MISC)", qty: 2 },
  { item: "R2072", desc: "46.13 x (5 x 6)  x 92.25 - 2#", qty: 1 },
  { item: "R899", desc: "46.125 x (4x6) x 92.25 - 2# (MISC)", qty: 2 },
  { item: "R902", desc: "46.125 x (3x5) x 92.25 - 2# (MISC)", qty: 8 },
  { item: "R905", desc: "46.125 x (2x4) x 92.25 - 2# (MISC)", qty: 6 },
  { item: "R899", desc: "46.125 x (4x6) x 92.25 - 2# (MISC)", qty: 2 },
  { item: "R899", desc: "46.125 x (4x6) x 92.25 - 2# (MISC)", qty: 4 },
  { item: "R669", desc: "41.25 X (3X5) X 84.25 - 2#", qty: 4 },
  { item: "R668", desc: "41.25 X (4X2) X 84.25 - 2#", qty: 2 },
  { item: "R672", desc: "41.25 X (4X6) X 84.25 - 2# (MISC)", qty: 2 },
  { item: "R534", desc: "39.25 X (3X5) X 80.25 - 2#..(MISC)", qty: 2 },
  { item: "R663", desc: "39.25 X (4X2) X 80.25 - 2#\nSchedule 07/31 - LPI + AFTER MARKET", qty: 2 },
];

export const PO1_EXPECTED: Record<string, { skus: number; parts: number; molds: number; floor: number; scrap: number }> = {
  "1": { skus: 18, parts: 302, molds: 10, floor: 6.31, scrap: 0 },
  "1.5": { skus: 13, parts: 74, molds: 3, floor: 2.03, scrap: 0 },
  "2": { skus: 16, parts: 59, molds: 3, floor: 2.09, scrap: 3 },
};
