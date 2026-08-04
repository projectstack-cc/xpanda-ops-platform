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
