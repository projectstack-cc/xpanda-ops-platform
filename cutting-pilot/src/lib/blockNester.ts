// Block nester for the Block Nesting module (/v2/blocks). Pure engine — no DOM, no Cloudflare
// context, client+server safe. Separate from and does NOT touch the legacy src/lib/blockEngine.ts
// (still used by the cutting dashboard).
//
// Validated exactly (blocksNeeded, volumeFloor, scrapWedges — all three densities) against the
// real hand-checked PO#1 reference (xPanda_PO1_Nesting_Map.xlsx): 1# = 10 molds/6.31 floor/0
// scrap, 1.5# = 3/2.03/0, 2# = 3/2.09/3. That file's own "Method & Assumptions" sheet documents
// three tiers — Strict (no reuse at all), Greedy (height-leftover reuse via width-only trimming,
// what's implemented here), and a true offcut-recursive optimum that additionally re-pools
// width-strip and length-end voids, which the reference spreadsheet itself states is NOT yet
// computed ("the true offcut-recursive optimum sits between [floor and greedy]"). This engine
// matches their Greedy tier exactly; the further optimum is out of scope here too (see the
// scoped-limitation note below), same boundary the domain expert's own hand analysis drew.
//
// Algorithm, per density (density never mixes — a mold is one density):
//   1. Pair tapers: each SKU's qty pairs into ceil(qty/2) rectangles of height tlo+thi+0.25"
//      (kerf for the 3 face cuts: flat-taper-flat). Odd qty leaves one scrap complement wedge —
//      a genuine extra unit of that same size, set aside for a future order or eventually
//      scrapped (tracked as a count; not itself a rectangular offcut, so not geometrically
//      re-poolable by this engine).
//   2. Strict tier (buildChunksStrict): group rectangles by exact native width, height-FFD-bin
//      each width group into chunks. No cross-SKU reuse at all — the naive floor.
//   3. Greedy tier (buildChunksGreedy — the required baseline, "MUST hit the PO#1 numbers"): a
//      chunk's width is set by whichever rectangle opens it. Process rectangles WIDEST-first
//      (ties by native footprint area descending); a narrower rectangle may be admitted into an
//      existing chunk's remaining height, its width trimmed down to exactly that chunk's
//      established width (trimmedFrom flagged only when strictly narrower — an exact width match
//      needs no trim). LENGTH is never forced to match: a chunk's length is the max native length
//      among its residents, and a shorter resident just leaves an unrecovered "length end" gap
//      (reported per-line via NestChunkLine.partLength, not re-packed).
//      SCOPED LIMITATION (matches the reference spreadsheet's own stated scope): the block-level
//      *width strip* (block.width - chunk.width, running that chunk's whole length) and the
//      per-band *length end* above are computed/displayed but never fed back into the packer as
//      additional capacity — that would need full 2D/3D guillotine bin-packing across the block's
//      whole width×length plane. Backlogged in BACKLOG.md.
//   4. Pack chunks into fixed-length blocks (molds): block.length is fixed capacity — every mold
//      is full length whether used or not. Each internal cross-cut between chunks sharing a block
//      costs 0.25/3" (0.0833"), charged as (n-1) per block. FFD by chunk length.
//   Strict vs. greedy: both are computed in full and the smaller-or-equal block count wins by
//   explicit comparison, so "never regress below the strict floor" is a hard guarantee (greedy
//   has strictly more admission freedom than strict, so it always wins in practice).
import type {
  BlockSize,
  BlockSizes,
  DensityNestResult,
  NestBlock,
  NestChunk,
  NestChunkLine,
  NestResult,
  SkuLine,
} from "./blockTypes";

const TAPER_KERF = 0.25;
const CROSS_CUT_KERF = 0.25 / 3;
const EPS = 1e-9;

interface Rect {
  item: string;
  nativeWidth: number;
  nativeLength: number;
  tlo: number;
  thi: number;
  height: number;
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

function buildRectangles(lines: SkuLine[]): { rects: Rect[]; scrapWedges: number } {
  const rects: Rect[] = [];
  let scrapWedges = 0;

  for (const line of lines) {
    const rectCount = Math.ceil(line.qty / 2);
    const odd = line.qty % 2 === 1;
    if (odd) scrapWedges += 1;

    for (let i = 0; i < rectCount; i++) {
      const isLastOdd = odd && i === rectCount - 1;
      rects.push({
        item: line.item,
        nativeWidth: line.width,
        nativeLength: line.length,
        tlo: line.tlo,
        thi: line.thi,
        height: line.tlo + line.thi + TAPER_KERF,
        pieces: isLastOdd ? 1 : 2,
      });
    }
  }

  return { rects, scrapWedges };
}

// taper runs along length; wedge volume uses average height (a linear taper's volume is exact
// via the trapezoidal average, no integral needed).
function computeVolumeFloor(lines: SkuLine[], block: BlockSize): number {
  const blockVolume = block.width * block.height * block.length;
  if (blockVolume <= 0) return 0;
  const totalVolume = lines.reduce(
    (sum, l) => sum + l.width * l.length * ((l.tlo + l.thi) / 2) * l.qty,
    0
  );
  return totalVolume / blockVolume;
}

// Strict tier: group by EXACT native width, height-FFD per width group. Never trims — every rect
// keeps its own native width/length. This is the naive floor with no cross-SKU reuse at all.
function buildChunksStrict(rects: Rect[], block: BlockSize): Chunk[] {
  const groups = new Map<number, Rect[]>();
  for (const r of rects) {
    const g = groups.get(r.nativeWidth);
    if (g) g.push(r);
    else groups.set(r.nativeWidth, [r]);
  }

  const chunks: Chunk[] = [];
  for (const groupRects of Array.from(groups.values())) {
    const sorted = [...groupRects].sort((a, b) => b.height - a.height);
    const widthChunks: Chunk[] = [];
    for (const r of sorted) {
      const home = widthChunks.find((c) => c.usedHeight + r.height <= block.height + EPS);
      if (home) {
        home.rects.push({ ...r });
        home.usedHeight += r.height;
      } else {
        widthChunks.push({ width: r.nativeWidth, rects: [{ ...r }], usedHeight: r.height });
      }
    }
    chunks.push(...widthChunks);
  }
  return chunks;
}

// Greedy tier (the prompt's required baseline): a chunk's width is established by whichever
// rectangle opens it — process rectangles WIDEST-first (ties broken by native footprint area
// descending) so a chunk's width ceiling is always set before anything narrower is considered
// for it. A narrower rectangle may then be admitted into an existing chunk's remaining height,
// its width trimmed down to exactly that chunk's established width (flagged via trimmedFrom
// only when strictly narrower — width equal to the chunk needs no trim). Length is never
// forced to match: a chunk's length is the max native length among its residents, and a
// shorter resident simply leaves an unrecovered "length end" gap (reported per-line via
// NestChunkLine.partLength, not re-packed — see the scoped-limitation note in the file header).
// A rectangle WIDER than every open chunk (or that fits nowhere by height) anchors a new chunk
// at its own native width.
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

// Pack chunks into fixed-length blocks (molds). FFD by chunk length; a block holding n chunks
// charges (n-1) internal cross-cuts off its usable length.
function packChunksIntoBlocks(chunks: Chunk[], block: BlockSize): Chunk[][] {
  const withLength = chunks.map((c) => ({ c, length: chunkLength(c) }));
  const sorted = [...withLength].sort((a, b) => b.length - a.length);
  const blocks: { chunk: Chunk; length: number }[][] = [];

  for (const item of sorted) {
    let placedIn: { chunk: Chunk; length: number }[] | null = null;
    for (const b of blocks) {
      const total = b.reduce((sum, x) => sum + x.length, 0) + item.length + b.length * CROSS_CUT_KERF;
      if (total <= block.length + EPS) {
        placedIn = b;
        break;
      }
    }
    if (placedIn) placedIn.push({ chunk: item.c, length: item.length });
    else blocks.push([{ chunk: item.c, length: item.length }]);
  }

  return blocks.map((b) => b.map((x) => x.chunk));
}

function chunkLength(c: Chunk): number {
  return c.rects.reduce((max, r) => Math.max(max, r.nativeLength), 0);
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
        partWidth: c.width,
        partLength: r.nativeLength,
        trimmedFrom: r.trimmedFrom,
      });
    }
  }
  return { width: c.width, length, faceUsed: c.usedHeight, lines: Array.from(lineMap.values()) };
}

export function nestDensity(lines: SkuLine[], block: BlockSize): DensityNestResult {
  const { rects, scrapWedges } = buildRectangles(lines);
  const volumeFloor = computeVolumeFloor(lines, block);

  const strictChunks = buildChunksStrict(rects, block);
  const strictBlocks = packChunksIntoBlocks(strictChunks, block);

  const greedyChunks = buildChunksGreedy(rects, block);
  const greedyBlocks = packChunksIntoBlocks(greedyChunks, block);

  // Never regress below the strict baseline: pick whichever block count is smaller-or-equal.
  // (Greedy has strictly more admission freedom than strict, so it wins by construction in
  // every case we've observed — this comparison makes that a hard guarantee, not an assumption.)
  const useGreedy = greedyBlocks.length <= strictBlocks.length;
  const finalBlocks = useGreedy ? greedyBlocks : strictBlocks;

  const blocks: NestBlock[] = finalBlocks.map((chunkList) => ({
    chunks: chunkList.map(chunkToNestChunk),
  }));

  return {
    density: lines[0]?.density ?? 0,
    blocks,
    blocksNeeded: blocks.length,
    scrapWedges,
    volumeFloor,
  };
}

export function nest(skuLines: SkuLine[], sizes: BlockSizes): NestResult {
  const densities = Array.from(
    new Set(skuLines.filter((l) => l.parsed && l.density > 0 && l.qty > 0).map((l) => l.density))
  ).sort((a, b) => a - b);

  const result: NestResult = {};
  for (const density of densities) {
    const block = sizes[String(density)] ?? { width: 50, height: 50, length: 198 };
    const lines = skuLines.filter((l) => l.parsed && l.density === density && l.qty > 0);
    result[String(density)] = nestDensity(lines, block);
  }
  return result;
}

// Exposed for the dev self-check only (verifying "greedy <= strict" is structural, not assumed).
export const __internal = {
  buildRectangles,
  buildChunksStrict,
  buildChunksGreedy,
  packChunksIntoBlocks,
  computeVolumeFloor,
  chunkLength,
};
