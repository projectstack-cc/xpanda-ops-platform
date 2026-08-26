// Shared typed contract for the Block Nesting module (/v2/blocks). Consumed by the P410 parser/
// grid and the P411 nester/renderer. Ephemeral — no DB, no persistence.
//
// Axis convention: length = block.length (198, the chunk/mold axis, taper runs along this axis);
// height = block.height (the 65/44 taper-stacking face axis — where paired-wedge bands stack);
// width = block.width (50, one part across — the width−partWidth strip is offcut).

export interface SkuLine {
  item: string;
  width: number;
  length: number;
  tlo: number;
  thi: number;
  density: number;
  qty: number;
  parsed: boolean;
  raw: string;
}

// inches
export interface BlockSize {
  width: number;
  height: number;
  length: number;
}

// key = density as string, e.g. "1", "1.5", "2"
export type BlockSizes = Record<string, BlockSize>;

export const DEFAULT_BLOCK: BlockSize = { width: 50, height: 50, length: 198 };

// P411: per-density defaults = the customer's current molds (still fully editable in the UI).
// Falls back to DEFAULT_BLOCK for any density not listed here.
export const DEFAULT_BLOCKS: BlockSizes = {
  "1": { width: 50, height: 65, length: 198 },
  "1.5": { width: 50, height: 44, length: 198 },
  "2": { width: 50, height: 44, length: 198 },
};

// P411: carried-forward vs true-scrap threshold (inches) on an offcut's smallest usable
// dimension; consumed by blockNester.ts. Placeholder — Steve will set the real value.
export const DEFAULT_MIN_REUSABLE_IN = 12;

// --- Nester output (P411) ---

export interface NestChunkLine {
  item: string;
  tlo: number;
  thi: number;
  qty: number; // finished pieces from this line, within this chunk
  // Actual cut dimensions for this line. partWidth is this SKU's own (native or trimmed-to) part
  // width — NOT necessarily the chunk's full established width, since a narrower SKU sharing a
  // face keeps its own ordered width (see trimmedFrom). partLength may be LESS than the chunk's
  // length when this SKU is naturally shorter than the chunk's longest resident (the "length end"
  // gap — routed to the offcut pool, see blockNester.ts).
  partWidth: number;
  partLength: number;
  // Present iff this SKU's native width is narrower than the chunk's established width (set by
  // whichever SKU opened the chunk) and its band had to be ripped down from that wider face to
  // this SKU's own native dims — the resulting width-strip is offcut, routed to the pool.
  trimmedFrom?: { width: number; length: number };
}

export interface NestChunk {
  width: number;
  length: number;
  faceUsed: number; // inches of block.height consumed by this chunk's stacked bands
  lines: NestChunkLine[];
}

export interface NestBlock {
  chunks: NestChunk[];
}

export interface DensityNestResult {
  density: number;
  blocks: NestBlock[]; // block (mold) -> chunk -> SKU map
  moldsNeeded: number;
  finishedBF: number; // board feet actually delivered as ordered parts (packing-invariant)
  carriedForwardBF: number; // offcut whose smallest usable dimension >= minReusableIn
  scrapBF: number; // remaining offcut (finishedBF + carriedForwardBF + scrapBF == moldsNeeded's total block BF)
  volumeFloor: number; // perfect-yield minimum mold count (finishedBF / BF-per-mold)
}

// key = density as string, e.g. "1", "1.5", "2"
export type NestResult = Record<string, DensityNestResult>;

export interface NestTotals {
  moldsNeeded: number;
  finishedBF: number;
  carriedForwardBF: number;
  scrapBF: number;
}
