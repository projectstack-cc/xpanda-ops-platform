// cutting-pilot/src/lib/holeyNester.ts
// Pure port of _worker.js/lib/holey-nester.js (P379). Holey Board chunk nester — FFD packing
// in a 48"×24"×height block; boards guillotine-sliced along the height. Pattern-agnostic.
// Kerf is charged BETWEEN boards only (n boards → n−1 cuts); the first board in a chunk
// incurs no kerf. Pure: given resolved {thickness,qty} items, returns the chunk count and a
// per-chunk board list consumed by the cutList.ts CHUNK BREAKDOWN page.
export const HB_CHUNK_HEIGHT = 50.5;
export const HB_KERF = 0.079;

export interface NestInputItem {
  thickness: number;
  qty: number;
}

export interface NestChunk {
  index: number;
  boards: number[];
  remnant: number;
}

export interface NestResult {
  chunks_required: number;
  total_boards: number;
  avg_util: number;
  total_waste: number;
  height: number;
  kerf: number;
  breakdown: NestChunk[];
  oversize: number[];
}

export function nestHoleyChunks(
  items: NestInputItem[] | null | undefined,
  opts: { height?: number; kerf?: number } = {}
): NestResult {
  const height = Number.isFinite(opts.height) ? (opts.height as number) : HB_CHUNK_HEIGHT;
  const kerf = Number.isFinite(opts.kerf) ? (opts.kerf as number) : HB_KERF;

  const boards: number[] = [];
  const oversize: number[] = [];
  for (const it of items || []) {
    const t = Number(it && it.thickness);
    const q = parseInt(String((it as any)?.qty ?? ""), 10);
    if (!(t > 0) || !(q >= 1)) continue;
    if (t > height + 1e-9) {
      oversize.push(t);
      continue;
    }
    for (let i = 0; i < q; i++) boards.push(t);
  }

  boards.sort((a, b) => b - a);

  const chunks: Array<{ boards: number[]; remaining: number }> = [];
  for (const t of boards) {
    let placed = false;
    for (const ch of chunks) {
      if (ch.remaining >= t + kerf - 1e-9) {
        ch.boards.push(t);
        ch.remaining -= t + kerf;
        placed = true;
        break;
      }
    }
    if (!placed) chunks.push({ boards: [t], remaining: height - t });
  }

  const total_boards = boards.length;
  const total_waste = chunks.reduce((s, ch) => s + Math.max(0, ch.remaining), 0);
  const avg_util = chunks.length
    ? (chunks.reduce((s, ch) => s + (height - Math.max(0, ch.remaining)) / height, 0) / chunks.length) * 100
    : 0;

  return {
    chunks_required: chunks.length,
    total_boards,
    avg_util: Number(avg_util.toFixed(1)),
    total_waste: Number(total_waste.toFixed(2)),
    height,
    kerf,
    breakdown: chunks.map((ch, i) => ({
      index: i + 1,
      boards: ch.boards,
      remnant: Number(Math.max(0, ch.remaining).toFixed(3)),
    })),
    oversize,
  };
}

// hb-onhand-01: typed port of _worker.js/lib/holey-nester.js's netHoleyChunks. Nets an order's
// HB lines against floor stock and re-nests what's left. Pure: no D1, no DOM.
export interface HbLine {
  part_id: string;
  part_number: string | null;
  thickness: number;
  qty: number;
}

export interface HbOnHand {
  pcs?: Record<string, number>;
  chunks?: number;
}

export interface HbNetPc {
  part_id: string;
  part_number: string | null;
  thickness: number;
  order_qty: number;
  on_hand: number;
  to_cut: number;
}

export interface HbNet extends NestResult {
  order_chunks_required: number;
  pcs: HbNetPc[];
  chunks_on_hand_entered: number;
  chunks_on_hand: number;
  chunks_to_cut: number;
}

export function netHoleyChunks(
  lines: HbLine[] | null | undefined,
  onHand: HbOnHand | null | undefined,
  orderChunksRequired: number,
  opts: { height?: number; kerf?: number } = {}
): HbNet | null {
  const safeLines = Array.isArray(lines) ? lines : [];

  let pcsStored: Record<string, unknown> = {};
  let chunksStored = 0;
  if (onHand && typeof onHand === "object") {
    if (onHand.pcs && typeof onHand.pcs === "object") pcsStored = onHand.pcs;
    const c = parseInt(String(onHand.chunks ?? ""), 10);
    if (Number.isFinite(c) && c > 0) chunksStored = c;
  }

  const pcs: HbNetPc[] = [];
  const toCutItems: NestInputItem[] = [];
  let anyPcsOnHand = false;

  for (const line of safeLines) {
    const orderQty = parseInt(String(line?.qty ?? ""), 10);
    if (!(orderQty >= 1)) continue;
    const thickness = Number(line?.thickness);

    const stored = parseInt(String(pcsStored[line.part_id] ?? ""), 10);
    const onHandQty = Number.isFinite(stored) && stored > 0 ? Math.min(stored, orderQty) : 0;
    const toCut = orderQty - onHandQty;

    if (onHandQty > 0) {
      anyPcsOnHand = true;
      pcs.push({
        part_id: line.part_id,
        part_number: line.part_number,
        thickness,
        order_qty: orderQty,
        on_hand: onHandQty,
        to_cut: toCut,
      });
    }
    if (toCut > 0 && thickness > 0) toCutItems.push({ thickness, qty: toCut });
  }

  if (!anyPcsOnHand && chunksStored <= 0) return null;

  let net: NestResult;
  try {
    net = nestHoleyChunks(toCutItems, opts);
  } catch {
    return null;
  }

  const chunksOnHand = Math.min(chunksStored, net.chunks_required);
  const chunksToCut = net.chunks_required - chunksOnHand;

  return {
    ...net,
    order_chunks_required: Number.isFinite(orderChunksRequired) ? orderChunksRequired : net.chunks_required,
    pcs,
    chunks_on_hand_entered: chunksStored,
    chunks_on_hand: chunksOnHand,
    chunks_to_cut: chunksToCut,
  };
}