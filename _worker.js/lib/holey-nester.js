// _worker.js/lib/holey-nester.js
// Holey Board chunk nester — server-authoritative port of the FFD packing in
// manufacturing/holey-board-calculator.html (binPack). A "chunk" is 48"×24"×height; boards are
// guillotine-sliced along the height. Pattern-agnostic (hole count does not affect the horizontal
// cut). Kerf is charged on EVERY board (including the last) — matches the calculator and gives a
// small safety margin. Pure: given resolved {thickness,qty} items, returns chunk count + breakdown.

export const HB_CHUNK_HEIGHT = 50;   // 48×24×50 chunk (51" variant not surfaced at order entry yet)
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
    if (t + kerf > height) { oversize.push(t); continue; }   // can't fit a chunk — excluded
    for (let i = 0; i < q; i++) boards.push(t);
  }

  boards.sort((a, b) => b - a);   // FFD: largest first

  const chunks = [];
  for (const t of boards) {
    const eff = t + kerf;
    let placed = false;
    for (const ch of chunks) {
      if (ch.remaining >= eff - 1e-9) {   // epsilon guards FP drift when remaining ≈ 0
        ch.boards.push(t);
        ch.remaining -= eff;
        placed = true;
        break;
      }
    }
    if (!placed) chunks.push({ boards: [t], remaining: height - eff });
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
