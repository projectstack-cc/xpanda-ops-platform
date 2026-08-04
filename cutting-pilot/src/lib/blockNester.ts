// Offcut-recursive block nester for the Block Nesting module (/v2/blocks). Pure engine — no
// DOM, no Cloudflare context, client+server safe. Separate from and does NOT touch the legacy
// src/lib/blockEngine.ts (still used by the cutting dashboard).
//
// Algorithm, per density (density never mixes — a mold is one density):
//   1. Pair tapers: each SKU's qty pairs into ceil(qty/2) rectangles of height tlo+thi+0.25"
//      (kerf for the 3 face cuts: flat-taper-flat). Odd qty leaves one scrap complement wedge
//      (tracked; a wedge isn't a rectangular offcut, so it is not geometrically re-poolable).
//   2. A chunk has one WIDTH and stacks rectangles up block.height (the taper wire cuts each
//      height band in one pass across the chunk's full width). Rectangles sharing a width can
//      share a chunk even when their LENGTHS differ — the chunk's own length is the max native
//      length among its resident bands; a shorter band leaves a "length end" gap
//      (chunkLength - partLength), reported per-line via NestChunkLine.partLength but NOT
//      further re-packed (see the scoped-limitation note below).
//   3. Offcut recursion (buildChunksOffcut): a global best-fit-decreasing pass that additionally
//      allows a rectangle to be admitted into an EXISTING chunk of a different (smaller-or-equal)
//      width, by trimming its width down to exactly that chunk's width, when there's remaining
//      height for it — "any part may be trimmed down ... to fill available offcut" applied to
//      each chunk's own height-leftover void. This is the buildChunksFfd (per-width, height-FFD)
//      baseline's designated yield lever.
//      SCOPED LIMITATION: two of the three offcut sources the prompt lists are NOT re-harvested
//      here: the block-level *width strip* (block.width - chunk.width, running that chunk's
//      whole length) and the per-band *length end* described above. Re-pooling those would
//      require full 2D/3D guillotine bin-packing across the block's whole width×length plane;
//      this engine only re-harvests the per-chunk HEIGHT-leftover void. Backlogged in
//      BACKLOG.md — see the P324 CHANGELOG entry for why this line was drawn here.
//   4. Pack chunks into fixed-length blocks (molds): block.length is fixed capacity — every mold
//      is full length whether used or not. Each internal cross-cut between chunks sharing a
//      block costs 0.25/3" (0.0833"), charged as (n-1) per block. FFD by chunk length.
//   Offcut vs. greedy: both are computed in full and the smaller-or-equal block count wins by
//   explicit comparison, so "never regress below the greedy baseline" is a hard guarantee, not a
//   heuristic hope.
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

// Greedy baseline: group by WIDTH only (not length — see file header), height-FFD per width
// group. Never trims: every rect keeps its own native width/length.
function buildChunksFfd(rects: Rect[], block: BlockSize): Chunk[] {
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

// Offcut-recursive: global best-fit-decreasing over ALL rectangles regardless of native width.
// A rectangle may be admitted into an existing chunk of a smaller-or-equal width (trimmed down
// to exactly that chunk's width) if there's remaining height for it. Length is never trimmed —
// a naturally shorter band just leaves a length-end gap (reported, not re-packed).
function buildChunksOffcut(rects: Rect[], block: BlockSize): Chunk[] {
  const sorted = [...rects].sort((a, b) => b.height - a.height);
  const chunks: Chunk[] = [];

  for (const r of sorted) {
    let bestIdx = -1;
    let bestRemaining = Infinity;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const remaining = block.height - c.usedHeight;
      const fits = r.nativeWidth >= c.width - EPS && r.height <= remaining + EPS;
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
    const trimmed = r.nativeWidth > c.width + EPS;
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

  const greedyChunks = buildChunksFfd(rects, block);
  const greedyBlocks = packChunksIntoBlocks(greedyChunks, block);

  const offcutChunks = buildChunksOffcut(rects, block);
  const offcutBlocks = packChunksIntoBlocks(offcutChunks, block);

  // Never regress below the greedy baseline: pick whichever block count is smaller-or-equal.
  const useOffcut = offcutBlocks.length <= greedyBlocks.length;
  const finalBlocks = useOffcut ? offcutBlocks : greedyBlocks;

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

// Exposed for the dev self-check only (verifying "offcut <= greedy" is structural, not assumed).
export const __internal = {
  buildRectangles,
  buildChunksFfd,
  buildChunksOffcut,
  packChunksIntoBlocks,
  computeVolumeFloor,
  chunkLength,
};
