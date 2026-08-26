// Guarded dev self-check for the block nester (P411). Not part of the production build path —
// invoked once from BlocksApp in a NODE_ENV !== "production" effect and logged to console.
//
// Verifies: the face-capacity-with-top-off formula against all five customer-locked reference
// numbers; the reconciliation identity (finishedBF + carriedForwardBF + kerfLossBF == moldsNeeded's
// total block BF) on synthetic mixes and on the real PO#1 fixture at both old and new default
// block sizes; finishedBF's invariance to block size/packing; moldsNeeded >= ceil(volumeFloor);
// the offcut-recursion (best-fit) tier never regressing past the greedy (first-fit) tier; and the
// PO#1 piece-count regression (302/74/59) as a parser+capacity-path baseline. P412 removed the
// minimum-reusable-size threshold entirely — all enumerated real offcut is carriedForwardBF now
// (no size gate); kerfLossBF is the honest unavoidable-loss residual (saw kerf + micro-regions).
//
// STILL NOT COVERED as of P412: the "locked customer order" (Sheet1, 20 SKUs) ground truth from
// the P411 prompt — pieces 1#=303/1.5#=60/2#=48, greedy molds 1#=8/3/3, finishedBF=37,038. That
// fixture's raw line items have never been provided (checked: absent from both
// xPanda_PO1_Nesting_Map.xlsx, which only has PO#1's 47 SKUs, and the rest of the repo, as of both
// P411 and P412). Those four numbers are aggregates of an order this file doesn't have — they
// can't be reconstructed from a handful of totals without fabricating SKU rows tuned to match,
// which would be worthless as verification. Once Steve provides that order (same shape as
// po1Fixture.ts), add it here alongside PO1_ROWS. See BACKLOG.md's matching item.
import type { SkuLine, BlockSize } from "./blockTypes";
import { nest, nestDensity, computeFaceCapacity, __internal } from "./blockNester";
import { parsePoRows } from "./poParser";
import { PO1_ROWS, PO1_EXPECTED } from "./po1Fixture";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function approxEq(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) < eps;
}

function line(overrides: Partial<SkuLine>): SkuLine {
  return {
    item: "X",
    width: 10,
    length: 20,
    tlo: 2,
    thi: 4,
    density: 1.5,
    qty: 4,
    parsed: true,
    raw: "",
    ...overrides,
  };
}

function reconciles(d: ReturnType<typeof nestDensity>, block: BlockSize): { ok: boolean; detail: string } {
  const totalBlockBF = (d.moldsNeeded * block.width * block.height * block.length) / 144;
  const sum = d.finishedBF + d.carriedForwardBF + d.kerfLossBF;
  return {
    ok: approxEq(sum, totalBlockBF) && d.carriedForwardBF >= -1e-6 && d.kerfLossBF >= -1e-6,
    detail: `finished=${d.finishedBF.toFixed(2)} carried=${d.carriedForwardBF.toFixed(
      2
    )} kerfLoss=${d.kerfLossBF.toFixed(2)} sum=${sum.toFixed(2)} moldBF=${totalBlockBF.toFixed(2)}`,
  };
}

export function runBlockNesterSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  // --- Face capacity with top-off: the five customer-locked reference numbers ---
  const capacityCases: Array<{ tlo: number; thi: number; H: number; expect: number }> = [
    { tlo: 2, thi: 4, H: 65, expect: 20 },
    { tlo: 3, thi: 5, H: 65, expect: 15 },
    { tlo: 4, thi: 5, H: 65, expect: 14 },
    { tlo: 3, thi: 4, H: 44, expect: 12 },
    { tlo: 4, thi: 5, H: 44, expect: 9 },
  ];
  for (const c of capacityCases) {
    const got = computeFaceCapacity(c.tlo, c.thi, c.H);
    check(
      `face capacity (${c.tlo}>${c.thi})@${c.H} == ${c.expect}`,
      got === c.expect,
      `got ${got}`
    );
  }

  const block: BlockSize = { width: 50, height: 50, length: 198 };

  // --- Reconciliation + non-negativity across several synthetic mixes, some with odd qty ---
  const mixes: SkuLine[][] = [
    [
      line({ item: "A", width: 12, length: 40, tlo: 2, thi: 4, density: 1.5, qty: 10 }),
      line({ item: "B", width: 12, length: 40, tlo: 3, thi: 5, density: 1.5, qty: 7 }), // odd
      line({ item: "C", width: 8, length: 30, tlo: 1, thi: 3, density: 1.5, qty: 15 }), // odd
    ],
    [
      line({ item: "D", width: 20, length: 60, tlo: 4, thi: 6, density: 2, qty: 6 }),
      line({ item: "E", width: 20, length: 60, tlo: 4, thi: 6, density: 2, qty: 1 }), // odd, lone
    ],
    [line({ item: "F", width: 15, length: 50, tlo: 2, thi: 2, density: 1, qty: 41 })], // odd
    [
      line({ item: "G", width: 10, length: 25, tlo: 1, thi: 2, density: 1, qty: 3 }),
      line({ item: "H", width: 30, length: 100, tlo: 5, thi: 8, density: 1, qty: 2 }),
    ],
  ];

  for (const [i, mix] of mixes.map((m, idx) => [idx, m] as const)) {
    const d = nestDensity(mix, block);
    const { ok, detail } = reconciles(d, block);
    check(`mix ${i}: finishedBF + carriedForwardBF + kerfLossBF == moldsNeeded block BF`, ok, detail);

    const floor = __internal.computeVolumeFloor(mix, block);
    check(
      `mix ${i}: moldsNeeded (${d.moldsNeeded}) >= ceil(volumeFloor) (${Math.ceil(floor)})`,
      d.moldsNeeded >= Math.ceil(floor),
      `floor=${floor}`
    );

    const rects = __internal.buildRectangles(mix);
    const chunks = __internal.buildChunksGreedy(rects, block);
    const firstFit = __internal.packMoldsFirstFit(chunks, block);
    const bestFit = __internal.packMoldsBestFit(chunks, block);
    check(
      `mix ${i}: offcut-recursion (best-fit, ${bestFit.length}) never regresses past greedy (first-fit, ${firstFit.length})`,
      bestFit.length <= firstFit.length
    );
    check(
      `mix ${i}: final moldsNeeded (${d.moldsNeeded}) matches the winning tier (${Math.min(
        firstFit.length,
        bestFit.length
      )})`,
      d.moldsNeeded === Math.min(firstFit.length, bestFit.length)
    );

    // Non-tautological accounting checks — carriedForwardBF/kerfLossBF are NOT forced
    // positive/bounded by the residual construction the way the reconciliation identity above is;
    // these catch a region double-counted against total offcut (this is exactly what caught the
    // lone-wedge-complement bug in the P411 pre-push review).
    const dt = nestDensity(mix, block);
    const totalBlockBF = (dt.moldsNeeded * block.width * block.height * block.length) / 144;
    check(
      `mix ${i}: carriedForwardBF (${dt.carriedForwardBF.toFixed(2)}) <= total offcut (${(
        totalBlockBF - dt.finishedBF
      ).toFixed(2)})`,
      dt.carriedForwardBF <= totalBlockBF - dt.finishedBF + 1e-6
    );
    check(`mix ${i}: kerfLossBF (${dt.kerfLossBF.toFixed(2)}) >= 0`, dt.kerfLossBF >= -1e-6);
    check(`mix ${i}: carriedForwardBF (${dt.carriedForwardBF.toFixed(2)}) >= 0`, dt.carriedForwardBF >= -1e-6);
  }

  // --- finishedBF is a pure function of the order: invariant to block size ---
  const invarianceMix = mixes[0];
  const smallBlock: BlockSize = { width: 50, height: 44, length: 198 };
  const bigBlock: BlockSize = { width: 50, height: 65, length: 198 };
  const finishedSmall = nestDensity(invarianceMix, smallBlock).finishedBF;
  const finishedBig = nestDensity(invarianceMix, bigBlock).finishedBF;
  check(
    "finishedBF is invariant to block size",
    approxEq(finishedSmall, finishedBig),
    `small=${finishedSmall.toFixed(4)} big=${finishedBig.toFixed(4)}`
  );

  // --- Real PO#1 baseline (57 real line items): piece-count regression at OLD defaults
  // (50x50x198) for every density — a parser+capacity-path check, per the P411 prompt's own
  // instruction to reproduce this as a regression fixture. ---
  const po1Lines = parsePoRows(PO1_ROWS);
  const po1SizesOld = { "1": block, "1.5": block, "2": block };
  const po1ResultOld = nest(po1Lines, po1SizesOld);
  for (const densityKey of Object.keys(PO1_EXPECTED)) {
    const exp = PO1_EXPECTED[densityKey];
    const got = po1ResultOld[densityKey];
    const gotParts = got
      ? got.blocks.flatMap((b) => b.chunks).flatMap((c) => c.lines).reduce((s, l) => s + l.qty, 0)
      : -1;
    check(
      `PO#1 @ ${densityKey}# (old defaults 50x50x198): ${exp.parts} pieces`,
      gotParts === exp.parts,
      `got ${gotParts}`
    );
    if (got) {
      const { ok, detail } = reconciles(got, block);
      check(`PO#1 @ ${densityKey}# (old defaults): reconciliation holds`, ok, detail);
    }
  }

  // --- Same non-tautological checks as the synthetic mixes above, on the real PO#1 order + logging
  // whether the offcut-recursion (best-fit) tier actually diverges from greedy (first-fit) here,
  // so it's visible whether tier two is doing real work or is decorative on this order. ---
  for (const densityKey of Object.keys(PO1_EXPECTED)) {
    const linesForDensity = po1Lines.filter(
      (l) => l.parsed && String(l.density) === densityKey && l.qty > 0
    );
    if (linesForDensity.length === 0) continue;
    const dt = nestDensity(linesForDensity, block);
    const totalBlockBF = (dt.moldsNeeded * block.width * block.height * block.length) / 144;
    check(
      `PO#1 @ ${densityKey}#: carriedForwardBF <= total offcut`,
      dt.carriedForwardBF <= totalBlockBF - dt.finishedBF + 1e-6,
      `carried=${dt.carriedForwardBF.toFixed(2)} totalOffcut=${(totalBlockBF - dt.finishedBF).toFixed(2)}`
    );
    check(`PO#1 @ ${densityKey}#: kerfLossBF >= 0`, dt.kerfLossBF >= -1e-6);
    check(`PO#1 @ ${densityKey}#: carriedForwardBF >= 0`, dt.carriedForwardBF >= -1e-6);

    const rects = __internal.buildRectangles(linesForDensity);
    const chunks = __internal.buildChunksGreedy(rects, block);
    const firstFit = __internal.packMoldsFirstFit(chunks, block);
    const bestFit = __internal.packMoldsBestFit(chunks, block);
    check(
      `PO#1 @ ${densityKey}# (old defaults): first-fit=${firstFit.length} molds, best-fit=${bestFit.length} molds` +
        (bestFit.length < firstFit.length ? " — tier two wins here" : " — tiers tie on this order"),
      bestFit.length <= firstFit.length
    );
  }

  // --- Same PO#1 order, reconciliation holds at the NEW per-density defaults too ---
  const po1SizesNew: Record<string, BlockSize> = { "1": bigBlock, "1.5": smallBlock, "2": smallBlock };
  const po1ResultNew = nest(po1Lines, po1SizesNew);
  for (const densityKey of Object.keys(PO1_EXPECTED)) {
    const got = po1ResultNew[densityKey];
    if (!got) continue;
    const blockForDensity = po1SizesNew[densityKey];
    const { ok, detail } = reconciles(got, blockForDensity);
    check(`PO#1 @ ${densityKey}# (new per-density defaults): reconciliation holds`, ok, detail);
  }

  return { pass: results.every((r) => r.pass), results };
}
