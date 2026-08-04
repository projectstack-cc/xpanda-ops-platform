// Shared typed contract for the Block Nesting module (/v2/blocks). Consumed by the P323
// parser/grid and the P324 nester/renderer. Ephemeral — no DB, no persistence.

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

// --- Nester output (P324) ---

export interface NestChunkLine {
  item: string;
  tlo: number;
  thi: number;
  qty: number; // finished pieces from this line, within this chunk
  // Actual cut dimensions for this line. partWidth always equals the chunk's own width (a band
  // spans the chunk's full cross-section); partLength may be LESS than the chunk's length when
  // this SKU is naturally shorter than the chunk's longest resident (the "length end" gap — not
  // re-harvested by this engine, see blockNester.ts's scoped-limitation comment).
  partWidth: number;
  partLength: number;
  trimmedFrom?: { width: number; length: number }; // present iff this SKU's native width exceeded the chunk's and had to be cut down to fit
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
  blocks: NestBlock[];
  blocksNeeded: number;
  scrapWedges: number;
  volumeFloor: number;
}

// key = density as string, e.g. "1", "1.5", "2"
export type NestResult = Record<string, DensityNestResult>;
