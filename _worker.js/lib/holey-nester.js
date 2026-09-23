// _worker.js/lib/holey-nester.js
// Holey Board chunk nester — server-authoritative port of the FFD packing in
// manufacturing/holey-board-calculator.html (binPack). A "chunk" is 48"×24"×height; boards are
// guillotine-sliced along the height. Pattern-agnostic (hole count does not affect the horizontal
// cut). Kerf is charged BETWEEN boards only (interior cuts — n boards need n−1 cuts); the first
// board in a chunk incurs no kerf. Pure: given resolved {thickness,qty} items, returns chunk count.

export const HB_CHUNK_HEIGHT = 50.5; // real sliceable block height (blocks run a little over 50")
export const HB_KERF = 0.079;        // guillotine kerf / wire loss (matches existing calculators)

// items: [{ thickness:Number(inches), qty:Number(int>=1) }]
// opts:  { height=HB_CHUNK_HEIGHT, kerf=HB_KERF }
export function nestHoleyChunks(items, opts = {}) {
  const height = Number.isFinite(opts.height) ? opts.height : HB_CHUNK_HEIGHT;
  const kerf   = Number.isFinite(opts.kerf)   ? opts.kerf   : HB_KERF;

  const boards = [];
  const oversize = [];
  for (const it of (items || [])) {
    const t = Number(it && it.thickness);
    const q = parseInt(it && it.qty, 10);
    if (!(t > 0) || !(q >= 1)) continue;
    if (t > height + 1e-9) { oversize.push(t); continue; }   // a single board taller than the block
    for (let i = 0; i < q; i++) boards.push(t);
  }

  boards.sort((a, b) => b - a);   // FFD: largest first

  const chunks = [];
  for (const t of boards) {
    let placed = false;
    for (const ch of chunks) {
      // adding to a non-empty chunk needs one interior kerf before this board (n boards → n−1 cuts)
      if (ch.remaining >= t + kerf - 1e-9) {
        ch.boards.push(t);
        ch.remaining -= (t + kerf);
        placed = true;
        break;
      }
    }
    if (!placed) chunks.push({ boards: [t], remaining: height - t });   // first board: no kerf
  }

  const total_boards = boards.length;
  const total_waste  = chunks.reduce((s, ch) => s + Math.max(0, ch.remaining), 0);
  const avg_util = chunks.length
    ? chunks.reduce((s, ch) => s + (height - Math.max(0, ch.remaining)) / height, 0) / chunks.length * 100
    : 0;

  return {
    chunks_required: chunks.length,
    total_boards,
    avg_util: Number(avg_util.toFixed(1)),
    total_waste: Number(total_waste.toFixed(2)),
    height, kerf,
    breakdown: chunks.map((ch, i) => ({
      index: i + 1,
      boards: ch.boards,
      remnant: Number(Math.max(0, ch.remaining).toFixed(3)),
    })),
    oversize,
  };
}

// hb-onhand-01: net an order's HB lines against floor stock and re-nest what's left.
// lines: [{part_id, part_number, thickness, qty}]; onHand: parsed jobs.hb_on_hand or null.
// Returns the `net` object (see contract) or null when there is no positive floor stock.
export function netHoleyChunks(lines, onHand, orderChunksRequired, opts = {}) {
  const safeLines = Array.isArray(lines) ? lines : [];

  let pcsStored = {};
  let chunksStored = 0;
  if (onHand && typeof onHand === 'object') {
    if (onHand.pcs && typeof onHand.pcs === 'object') pcsStored = onHand.pcs;
    const c = parseInt(onHand.chunks, 10);
    if (Number.isFinite(c) && c > 0) chunksStored = c;
  }

  const pcs = [];
  const toCutItems = [];
  let anyPcsOnHand = false;

  for (const line of safeLines) {
    const orderQty = parseInt(line && line.qty, 10);
    if (!(orderQty >= 1)) continue;
    const thickness = Number(line && line.thickness);

    const stored = parseInt(pcsStored[line.part_id], 10);
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

  let net;
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
