// Block nester for the Block Nesting module (/v2/blocks). Pure engine — no DOM, no Cloudflare
// context, client+server safe. Separate from and does NOT touch the legacy src/lib/blockEngine.ts
// (still used by the cutting dashboard).
//
// P411 rewrite over P324's engine. Per density (density never mixes — a mold is one density):
//   1. Face capacity with top-off (computeFaceCapacity): a reference/self-check figure only, not
//      a placement driver — see the prompt's own framing ("a capacity, not a forced add"). The
//      ordered qty is always laid out exactly, never inflated to hit capacity.
//   2. Lay out ordered quantity: each SKU's qty pairs into ceil(qty/2) rectangles of height
//      tlo+thi+0.25" (kerf for the 3 face cuts: flat-taper-flat). An odd qty leaves one LONE
//      WEDGE occupying only its thick-end height (thi) in the stacking ledger — its complement
//      (the rest of what a full paired rectangle would have used, tlo+kerf tall) is real offcut,
//      but it's NOT tallied as its own region: whatever the packer stacks immediately above (at
//      y+thi) already claims that space, and if nothing does, it's already inside the chunk's
//      leftover-face-height region (block.height - usedHeight, which itself only advanced by thi
//      for this rect). Tallying it separately would double-count cubic inches already counted
//      one of those two ways — this was caught by pre-push review before it could ship. With no
//      threshold, the complement simply lands in carriedForwardBF via whichever of those two
//      regions actually claims it; it is real offcut, never tallied separately.
//   3. Chunk = one width, one length, many heights: rectangles of the same established chunk
//      width stack up the face; a narrower rectangle may be admitted into an existing chunk's
//      remaining height, ripped down from that chunk's established (wider) face to its own
//      native width (trimmedFrom) — the strip beside it is offcut. A chunk's length is the max
//      native length among its residents; a shorter resident leaves a "length end" gap, also
//      offcut. Both routed to the pool via tallyCarriedForwardBF (all real offcut carries; no
//      size gate).
//   4. Recursive offcut nesting -> inventory, not waste: leftover face height, block-width
//      strips, and length ends are NOT dropped as waste — each is classified as carried-forward
//      inventory (all of it); the floor decides live what is physically worth keeping. SCOPED
//      LIMITATION: this engine does not attempt to place additional
//      finished parts inside these offcut regions (that needs full 2D/3D guillotine bin-packing
//      across the block's whole width x length plane — see BACKLOG.md); it computes/classifies
//      the resulting BF split honestly, it does not re-nest into them.
//   5. Pack chunks into fixed-length molds: block.length is fixed capacity — every mold is full
//      length whether used or not. Each internal cross-cut between chunks sharing a mold costs
//      0.25/3" (0.0833"), charged as (n-1) per mold. Two tiers, both computed in full:
//        - buildChunksGreedy + packMoldsFirstFit ("greedy" tier, first-fit-decreasing by chunk
//          length): the required baseline.
//        - the SAME chunk set repacked via packMoldsBestFit (best-fit-decreasing): the
//          "offcut-recursion" tier — a legitimately different, usually-tighter bin-packing
//          heuristic over the same chunks. Whichever yields fewer-or-equal molds wins by explicit
//          comparison, so "never regress below the greedy mold count" is a hard guarantee, not an
//          assumption.
//   6. Objective: minimize mold count first, yield second.
//   7. Output in board feet (1 BF = 144 in^3): finishedBF (packing-invariant — a pure function of
//      the order, computed directly from SKU dims/qty), carriedForwardBF, kerfLossBF, moldsNeeded,
//      and the block(mold) -> chunk -> SKU map. No flat "waste %".
import {
  DEFAULT_BLOCK,
  type BlockSize,
  type BlockSizes,
  type DensityNestResult,
  type NestBlock,
  type NestChunk,
  type NestChunkLine,
  type NestResult,
  type NestTotals,
  type SkuLine,
} from "./blockTypes";

const TAPER_KERF = 0.25;
const CROSS_CUT_KERF = 0.25 / 3;
const BF = 144; // 1 board foot = 144 in^3
const EPS = 1e-9;

interface Rect {
  item: string;
  nativeWidth: number;
  nativeLength: number;
  tlo: number;
  thi: number;
  height: number; // stacking footprint on the face: tlo+thi+kerf for a pair, thi for a lone wedge
  pieces: number; // 1 or 2 finished pieces represented by this rectangle
}

interface PlacedRect extends Rect {
  trimmedFrom?: { width: number; length: number };
}

interface Chunk {
  width: number;
  rects: PlacedRect[];
  usedHeight: number;
}

/** Face capacity with top-off (reference figure — see file header; not a placement driver).
 *  capacity = 2*floor(H/rect) + (1 if the leftover height fits one more lone wedge, else 0). */
export function computeFaceCapacity(tlo: number, thi: number, H: number): number {
  const rect = tlo + thi + TAPER_KERF;
  if (rect <= EPS || H <= 0) return 0;
  const pairs = Math.floor((H + EPS) / rect);
  const remainder = H - pairs * rect;
  const loneWedge = remainder + EPS >= thi ? 1 : 0;
  return 2 * pairs + loneWedge;
}

function buildRectangles(lines: SkuLine[]): Rect[] {
  const rects: Rect[] = [];
  for (const line of lines) {
    const rectCount = Math.ceil(line.qty / 2);
    const odd = line.qty % 2 === 1;
    for (let i = 0; i < rectCount; i++) {
      const isLastOdd = odd && i === rectCount - 1;
      rects.push({
        item: line.item,
        nativeWidth: line.width,
        nativeLength: line.length,
        tlo: line.tlo,
        thi: line.thi,
        height: isLastOdd ? line.thi : line.tlo + line.thi + TAPER_KERF,
        pieces: isLastOdd ? 1 : 2,
      });
    }
  }
  return rects;
}

// finishedBF is a pure function of the order (width * length * avg-taper-height * qty), never of
// how it's packed — asserted by the self-check across both old and new default block sizes.
function computeFinishedBF(lines: SkuLine[]): number {
  const totalVolume = lines.reduce(
    (sum, l) => sum + l.width * l.length * ((l.tlo + l.thi) / 2) * l.qty,
    0
  );
  return totalVolume / BF;
}

function computeVolumeFloor(lines: SkuLine[], block: BlockSize): number {
  const blockVolume = block.width * block.height * block.length;
  if (blockVolume <= 0) return 0;
  return (computeFinishedBF(lines) * BF) / blockVolume;
}

// Greedy tier (the prompt's required baseline): a chunk's width is established by whichever
// rectangle opens it — process rectangles WIDEST-first (ties broken by native footprint area
// descending) so a chunk's width ceiling is always set before anything narrower is considered for
// it. A narrower rectangle may then be admitted into an existing chunk's remaining height, ripped
// down from that chunk's established (wider) face to its own native width (trimmedFrom flagged
// only when strictly narrower). Length is never forced to match: a chunk's length is the max
// native length among its residents, and a shorter resident leaves an unrecovered "length end"
// gap (routed to the offcut pool). A rectangle WIDER than every open chunk (or that fits nowhere
// by height) anchors a new chunk at its own native width.
function buildChunksGreedy(rects: Rect[], block: BlockSize): Chunk[] {
  const sorted = [...rects].sort((a, b) => {
    if (b.nativeWidth !== a.nativeWidth) return b.nativeWidth - a.nativeWidth;
    return b.nativeWidth * b.nativeLength - a.nativeWidth * a.nativeLength;
  });
  const chunks: Chunk[] = [];

  for (const r of sorted) {
    let bestIdx = -1;
    let bestRemaining = Infinity;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const remaining = block.height - c.usedHeight;
      const fits = r.nativeWidth <= c.width + EPS && r.height <= remaining + EPS;
      if (fits && remaining < bestRemaining) {
        bestRemaining = remaining;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      chunks.push({ width: r.nativeWidth, rects: [{ ...r }], usedHeight: r.height });
      continue;
    }

    const c = chunks[bestIdx];
    const trimmed = r.nativeWidth < c.width - EPS;
    c.rects.push(
      trimmed ? { ...r, trimmedFrom: { width: r.nativeWidth, length: r.nativeLength } } : { ...r }
    );
    c.usedHeight += r.height;
  }

  return chunks;
}

function chunkLength(c: Chunk): number {
  return c.rects.reduce((max, r) => Math.max(max, r.nativeLength), 0);
}

function moldUsedLength(items: { length: number }[]): number {
  if (items.length === 0) return 0;
  const sumLen = items.reduce((s, x) => s + x.length, 0);
  return sumLen + (items.length - 1) * CROSS_CUT_KERF;
}

// "Greedy" mold packing: first-fit-decreasing by chunk length.
function packMoldsFirstFit(chunks: Chunk[], block: BlockSize): Chunk[][] {
  const items = chunks.map((c) => ({ c, length: chunkLength(c) })).sort((a, b) => b.length - a.length);
  const molds: { c: Chunk; length: number }[][] = [];

  for (const item of items) {
    let placedIn: { c: Chunk; length: number }[] | null = null;
    for (const m of molds) {
      if (moldUsedLength([...m, item]) <= block.length + EPS) {
        placedIn = m;
        break;
      }
    }
    if (placedIn) placedIn.push(item);
    else molds.push([item]);
  }

  return molds.map((m) => m.map((x) => x.c));
}

// "Offcut-recursion" mold packing: best-fit-decreasing by chunk length — among molds the chunk
// fits into, picks the one leaving the least leftover length. A different (usually tighter)
// heuristic over the identical chunk set from buildChunksGreedy; never assumed better, always
// compared against the first-fit result before being used (see nestDensity).
function packMoldsBestFit(chunks: Chunk[], block: BlockSize): Chunk[][] {
  const items = chunks.map((c) => ({ c, length: chunkLength(c) })).sort((a, b) => b.length - a.length);
  const molds: { c: Chunk; length: number }[][] = [];

  for (const item of items) {
    let bestIdx = -1;
    let bestSlack = Infinity;
    for (let i = 0; i < molds.length; i++) {
      const used = moldUsedLength([...molds[i], item]);
      if (used <= block.length + EPS) {
        const slack = block.length - used;
        if (slack < bestSlack) {
          bestSlack = slack;
          bestIdx = i;
        }
      }
    }
    if (bestIdx === -1) molds.push([item]);
    else molds[bestIdx].push(item);
  }

  return molds.map((m) => m.map((x) => x.c));
}

// Sums every enumerated real-offcut region (leftover face height, block-width strips, length
// ends, mold length leftover) in board feet — no size gate; the floor decides live what's worth
// keeping. The residual (moldsNeeded's total block BF - finishedBF - carriedForwardBF, computed
// in nestDensity as kerfLossBF) is NOT a second independent sum of this same set — it's the
// unavoidable process loss this function deliberately does not enumerate: saw kerf (the internal
// per-pair sliver, the cross-cut kerf between chunks) and any other micro-region below what's
// worth tracking. A kerf-width sliver is never inventory, so it stays out of carriedForwardBF and
// lands in kerfLossBF by construction.
function tallyCarriedForwardBF(molds: Chunk[][], block: BlockSize): number {
  let carriedVol = 0;
  const maybeCarry = (w: number, h: number, l: number) => {
    if (w <= EPS || h <= EPS || l <= EPS) return;
    // Redundant with the early return above (P412 dropped the size-gate condition that used to
    // live here) — kept explicit rather than collapsed, so a region is never added silently.
    if (w > EPS && h > EPS && l > EPS) carriedVol += w * h * l;
  };

  for (const mold of molds) {
    let usedLength = 0;
    for (const c of mold) {
      const length = chunkLength(c);
      usedLength += length;

      // Leftover face height above this chunk's stacked bands, across its own footprint.
      maybeCarry(c.width, block.height - c.usedHeight, length);
      // Block-width strip beside this chunk's established width, for its own length span.
      maybeCarry(block.width - c.width, block.height, length);

      for (const r of c.rects) {
        // Length end: this resident is shorter than the chunk's established length.
        if (r.nativeLength < length - EPS) {
          maybeCarry(c.width, r.height, length - r.nativeLength);
        }
        // Width strip from ripping this resident down to its own native width.
        if (r.trimmedFrom) {
          maybeCarry(c.width - r.nativeWidth, r.height, r.nativeLength);
        }
        // NOTE: a lone wedge's complement (r.complementHeight) is deliberately NOT tallied here
        // — see the file header's step 2 for why that would double-count against either the next
        // band's own footprint or this chunk's leftover-face-height region above.
      }
    }

    const moldLeftoverLength =
      block.length - usedLength - Math.max(mold.length - 1, 0) * CROSS_CUT_KERF;
    maybeCarry(block.width, block.height, moldLeftoverLength);
  }

  return carriedVol / BF;
}

function chunkToNestChunk(c: Chunk): NestChunk {
  const length = chunkLength(c);
  const lineMap = new Map<string, NestChunkLine>();
  for (const r of c.rects) {
    const trimKey = r.trimmedFrom ? `${r.trimmedFrom.width}x${r.trimmedFrom.length}` : "native";
    const key = `${r.item}|${r.tlo}|${r.thi}|${r.nativeLength}|${trimKey}`;
    const existing = lineMap.get(key);
    if (existing) {
      existing.qty += r.pieces;
    } else {
      lineMap.set(key, {
        item: r.item,
        tlo: r.tlo,
        thi: r.thi,
        qty: r.pieces,
        partWidth: r.nativeWidth,
        partLength: r.nativeLength,
        trimmedFrom: r.trimmedFrom,
      });
    }
  }
  return { width: c.width, length, faceUsed: c.usedHeight, lines: Array.from(lineMap.values()) };
}

export function nestDensity(lines: SkuLine[], block: BlockSize): DensityNestResult {
  const rects = buildRectangles(lines);
  const volumeFloor = computeVolumeFloor(lines, block);
  const finishedBF = computeFinishedBF(lines);

  const chunks = buildChunksGreedy(rects, block);
  const firstFitMolds = packMoldsFirstFit(chunks, block);
  const bestFitMolds = packMoldsBestFit(chunks, block);

  // Never regress below the greedy (first-fit) baseline: pick whichever mold count is
  // smaller-or-equal, by explicit comparison (a hard guarantee, not an assumption).
  const finalMolds = bestFitMolds.length <= firstFitMolds.length ? bestFitMolds : firstFitMolds;
  const moldsNeeded = finalMolds.length;

  const carriedForwardBF = tallyCarriedForwardBF(finalMolds, block);
  const totalBlockBF = (moldsNeeded * block.width * block.height * block.length) / BF;
  let kerfLossBF = totalBlockBF - finishedBF - carriedForwardBF;
  if (kerfLossBF < 0 && kerfLossBF > -1e-6) kerfLossBF = 0; // floating-point guard only

  const blocks: NestBlock[] = finalMolds.map((chunkList) => ({
    chunks: chunkList.map(chunkToNestChunk),
  }));

  return {
    density: lines[0]?.density ?? 0,
    blocks,
    moldsNeeded,
    finishedBF,
    carriedForwardBF,
    kerfLossBF,
    volumeFloor,
  };
}

export function nest(skuLines: SkuLine[], sizes: BlockSizes): NestResult {
  const densities = Array.from(
    new Set(skuLines.filter((l) => l.parsed && l.density > 0 && l.qty > 0).map((l) => l.density))
  ).sort((a, b) => a - b);

  const result: NestResult = {};
  for (const density of densities) {
    const block = sizes[String(density)] ?? DEFAULT_BLOCK;
    const lines = skuLines.filter((l) => l.parsed && l.density === density && l.qty > 0);
    result[String(density)] = nestDensity(lines, block);
  }
  return result;
}

export function nestTotals(result: NestResult): NestTotals {
  return Object.values(result).reduce<NestTotals>(
    (acc, d) => ({
      moldsNeeded: acc.moldsNeeded + d.moldsNeeded,
      finishedBF: acc.finishedBF + d.finishedBF,
      carriedForwardBF: acc.carriedForwardBF + d.carriedForwardBF,
      kerfLossBF: acc.kerfLossBF + d.kerfLossBF,
    }),
    { moldsNeeded: 0, finishedBF: 0, carriedForwardBF: 0, kerfLossBF: 0 }
  );
}

// Exposed for the dev self-check only.
export const __internal = {
  buildRectangles,
  buildChunksGreedy,
  packMoldsFirstFit,
  packMoldsBestFit,
  computeVolumeFloor,
  computeFinishedBF,
  chunkLength,
};
