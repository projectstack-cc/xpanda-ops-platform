// Guarded dev self-check for the block nester (P324). Not part of the production build path —
// invoked once from BlocksApp in a NODE_ENV !== "production" effect and logged to console.
//
// IMPORTANT LIMITATION: the real "PO#1" ground-truth baseline (1# = 302 parts/10 molds/floor
// 6.31, 1.5# = 74/3/2.03, 2# = 59/3/2.09, 0 scrap wedges) cannot be asserted here — the source
// spreadsheet isn't in this repo, and fabricating SKU data to hit those exact numbers would prove
// nothing about the real engine (mold count and volume floor are functions of the real
// dimensional distribution, not of aggregate piece counts). This self-check instead verifies the
// STRUCTURAL invariants the prompt lists as checkable independent of that file:
//   - every density's summed finished parts reconciles to the input qty totals
//   - offcut-recursive block count is never worse than the greedy baseline
//   - block count is never below the physical volume floor
//   - odd qty produces exactly one scrap wedge per SKU, even qty produces none
import type { SkuLine, BlockSize } from "./blockTypes";
import { nest, nestDensity, __internal } from "./blockNester";

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

  // --- offcut <= greedy, block count >= ceil(volumeFloor), across several density mixes ---
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
    const greedyChunks = __internal.buildChunksFfd(__internal.buildRectangles(mix).rects, block);
    const greedyBlocks = __internal.packChunksIntoBlocks(greedyChunks, block);
    const offcutChunks = __internal.buildChunksOffcut(__internal.buildRectangles(mix).rects, block);
    const offcutBlocks = __internal.packChunksIntoBlocks(offcutChunks, block);
    const floor = __internal.computeVolumeFloor(mix, block);
    const dResult = nestDensity(mix, block);

    check(
      `mix ${i}: offcut blocks (${offcutBlocks.length}) <= greedy blocks (${greedyBlocks.length})`,
      offcutBlocks.length <= greedyBlocks.length
    );
    check(
      `mix ${i}: final blocksNeeded (${dResult.blocksNeeded}) >= ceil(volumeFloor) (${Math.ceil(floor)})`,
      dResult.blocksNeeded >= Math.ceil(floor),
      `floor=${floor}`
    );
    check(
      `mix ${i}: final blocksNeeded never worse than greedy`,
      dResult.blocksNeeded <= greedyBlocks.length
    );
  }

  // --- Prove the offcut lever actually engages (strictly beats greedy at least once), not just
  // ties. A narrow-length block (100") forces one chunk per block; two footprints that each
  // leave a large per-chunk height leftover in greedy consolidate into fewer chunks (and
  // therefore fewer blocks) once cross-footprint trimming is allowed. ---
  const narrowBlock: BlockSize = { width: 50, height: 50, length: 100 };
  const leverMix: SkuLine[] = [
    line({ item: "A", width: 10, length: 90, tlo: 2, thi: 4, density: 1, qty: 18 }),
    line({ item: "B", width: 12, length: 90, tlo: 1, thi: 1.5, density: 1, qty: 18 }),
  ];
  const leverGreedy = __internal.packChunksIntoBlocks(
    __internal.buildChunksFfd(__internal.buildRectangles(leverMix).rects, narrowBlock),
    narrowBlock
  );
  const leverOffcut = __internal.packChunksIntoBlocks(
    __internal.buildChunksOffcut(__internal.buildRectangles(leverMix).rects, narrowBlock),
    narrowBlock
  );
  check(
    `offcut lever: strictly beats greedy on a constructed case (offcut=${leverOffcut.length} < greedy=${leverGreedy.length})`,
    leverOffcut.length < leverGreedy.length,
    `greedy=${leverGreedy.length} offcut=${leverOffcut.length}`
  );

  // --- PO#1 ground-truth baseline — NOT checked here. See file-level comment. ---
  check(
    "PO#1 baseline (302/10/6.31, 74/3/2.03, 59/3/2.09, 0 scrap)",
    true,
    "SKIPPED — real PO#1 file not available; not asserted against fabricated data"
  );

  return { pass: results.every((r) => r.pass), results };
}
