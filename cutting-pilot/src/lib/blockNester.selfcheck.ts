// Guarded dev self-check for the block nester (P324). Not part of the production build path —
// invoked once from BlocksApp in a NODE_ENV !== "production" effect and logged to console.
//
// Verifies structural invariants against synthetic fixtures (reconciliation, scrap-wedge
// counting, strict >= greedy, blocksNeeded >= ceil(volumeFloor)), PLUS the real PO#1 baseline
// (via po1Fixture.ts — provided by Steve, 2026-08-04): parsing all 57 real line items and nesting
// them reproduces the manager-hand-checked exact numbers for every density (blocksNeeded,
// volumeFloor, scrapWedges — see xPanda_PO1_Nesting_Map.xlsx's Summary sheet).
import type { SkuLine, BlockSize } from "./blockTypes";
import { nest, nestDensity, __internal } from "./blockNester";
import { parsePoRows } from "./poParser";
import { PO1_ROWS, PO1_EXPECTED } from "./po1Fixture";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
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

export function runBlockNesterSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  const block: BlockSize = { width: 50, height: 50, length: 198 };

  // A representative synthetic mix: several footprints/tapers/densities, some odd qty.
  const lines: SkuLine[] = [
    line({ item: "A", width: 12, length: 40, tlo: 2, thi: 4, density: 1.5, qty: 10 }),
    line({ item: "B", width: 12, length: 40, tlo: 3, thi: 5, density: 1.5, qty: 7 }), // odd
    line({ item: "C", width: 8, length: 30, tlo: 1, thi: 3, density: 1.5, qty: 15 }), // odd
    line({ item: "D", width: 20, length: 60, tlo: 4, thi: 6, density: 2, qty: 6 }),
    line({ item: "E", width: 20, length: 60, tlo: 4, thi: 6, density: 2, qty: 1 }), // odd, lone
  ];

  const result = nest(lines, { "1.5": block, "2": block });

  // --- Reconciliation: summed finished pieces per density === input qty totals ---
  for (const density of [1.5, 2]) {
    const inputQty = lines.filter((l) => l.density === density).reduce((s, l) => s + l.qty, 0);
    const dResult = result[String(density)];
    const outputQty = dResult.blocks
      .flatMap((b) => b.chunks)
      .flatMap((c) => c.lines)
      .reduce((s, l) => s + l.qty, 0);
    check(
      `reconciliation @ ${density}#: output pieces === input qty`,
      outputQty === inputQty,
      `input=${inputQty} output=${outputQty}`
    );
  }

  // --- Scrap wedges: odd qty -> 1 wedge per SKU, even -> 0 ---
  const oddOnly = [line({ item: "O1", qty: 5 }), line({ item: "O2", qty: 8 })];
  const { scrapWedges } = __internal.buildRectangles(oddOnly);
  check("scrap wedges: exactly one odd-qty SKU -> 1 wedge", scrapWedges === 1, `got ${scrapWedges}`);

  const bothOdd = [line({ item: "O1", qty: 5 }), line({ item: "O2", qty: 7 })];
  const { scrapWedges: scrapWedges2 } = __internal.buildRectangles(bothOdd);
  check("scrap wedges: two odd-qty SKUs -> 2 wedges", scrapWedges2 === 2, `got ${scrapWedges2}`);

  // --- greedy <= strict, block count >= ceil(volumeFloor), across several density mixes ---
  const mixes: SkuLine[][] = [
    lines.filter((l) => l.density === 1.5),
    lines.filter((l) => l.density === 2),
    [line({ item: "F", width: 15, length: 50, tlo: 2, thi: 2, density: 1, qty: 40 })],
    [
      line({ item: "G", width: 10, length: 25, tlo: 1, thi: 2, density: 1, qty: 3 }),
      line({ item: "H", width: 30, length: 100, tlo: 5, thi: 8, density: 1, qty: 2 }),
    ],
  ];

  for (const [i, mix] of mixes.map((m, idx) => [idx, m] as const)) {
    const strictChunks = __internal.buildChunksStrict(__internal.buildRectangles(mix).rects, block);
    const strictBlocks = __internal.packChunksIntoBlocks(strictChunks, block);
    const greedyChunks = __internal.buildChunksGreedy(__internal.buildRectangles(mix).rects, block);
    const greedyBlocks = __internal.packChunksIntoBlocks(greedyChunks, block);
    const floor = __internal.computeVolumeFloor(mix, block);
    const dResult = nestDensity(mix, block);

    check(
      `mix ${i}: greedy blocks (${greedyBlocks.length}) <= strict blocks (${strictBlocks.length})`,
      greedyBlocks.length <= strictBlocks.length
    );
    check(
      `mix ${i}: final blocksNeeded (${dResult.blocksNeeded}) >= ceil(volumeFloor) (${Math.ceil(floor)})`,
      dResult.blocksNeeded >= Math.ceil(floor),
      `floor=${floor}`
    );
    check(
      `mix ${i}: final blocksNeeded never worse than strict`,
      dResult.blocksNeeded <= strictBlocks.length
    );
  }

  // --- Prove the greedy lever actually engages (strictly beats strict at least once), not just
  // ties. A narrow-length block (100") forces one chunk per block; two footprints that each
  // leave a large per-chunk height leftover under strict consolidate into fewer chunks (and
  // therefore fewer blocks) once cross-footprint width-trim admission is allowed. ---
  const narrowBlock: BlockSize = { width: 50, height: 50, length: 100 };
  const leverMix: SkuLine[] = [
    line({ item: "A", width: 10, length: 90, tlo: 2, thi: 4, density: 1, qty: 18 }),
    line({ item: "B", width: 12, length: 90, tlo: 1, thi: 1.5, density: 1, qty: 18 }),
  ];
  const leverStrict = __internal.packChunksIntoBlocks(
    __internal.buildChunksStrict(__internal.buildRectangles(leverMix).rects, narrowBlock),
    narrowBlock
  );
  const leverGreedy = __internal.packChunksIntoBlocks(
    __internal.buildChunksGreedy(__internal.buildRectangles(leverMix).rects, narrowBlock),
    narrowBlock
  );
  check(
    `greedy lever: strictly beats strict on a constructed case (greedy=${leverGreedy.length} < strict=${leverStrict.length})`,
    leverGreedy.length < leverStrict.length,
    `strict=${leverStrict.length} greedy=${leverGreedy.length}`
  );

  // --- Real PO#1 baseline: parse + nest all 57 real line items, compare to the exact manager-
  // hand-checked numbers (blocksNeeded, volumeFloor, scrapWedges) for every density. ---
  const po1Lines = parsePoRows(PO1_ROWS);
  const po1Sizes = { "1": block, "1.5": block, "2": block };
  const po1Result = nest(po1Lines, po1Sizes);
  for (const densityKey of Object.keys(PO1_EXPECTED)) {
    const exp = PO1_EXPECTED[densityKey];
    const got = po1Result[densityKey];
    check(
      `PO#1 @ ${densityKey}#: ${exp.molds} molds, floor ${exp.floor}, ${exp.scrap} scrap wedges`,
      !!got &&
        got.blocksNeeded === exp.molds &&
        Math.abs(got.volumeFloor - exp.floor) < 0.005 &&
        got.scrapWedges === exp.scrap,
      got
        ? `got molds=${got.blocksNeeded} floor=${got.volumeFloor.toFixed(2)} scrap=${got.scrapWedges}`
        : "no result for this density"
    );
  }

  return { pass: results.every((r) => r.pass), results };
}
