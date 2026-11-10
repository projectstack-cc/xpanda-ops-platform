// src/lib/zonedPack.selfcheck.ts
// lbz-v2-01: guarded dev self-check for zonedPack.ts (offload zones). Pure, no network; same shape as
// forcedPack.selfcheck.ts. Not part of the production build path. Labels are neutral (public repo).
import { zonedPack, UNZONED_LABEL, ZONE_COLORS } from "./zonedPack";
import { pack, validatePlan, TRAILER_TYPES, DEFAULT_PACK_OPTIONS, HOLEY_BOARD_CATEGORY } from "./packEngine";
import type { CartLine, PackPlan, PackSku, PackTrailer } from "./packEngine";
import { clonePlan, recomputePlan } from "./loadEditor";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const T53 = "53ft Standard";
const BOX = "26ft Box Truck";
const OPTS = { ...DEFAULT_PACK_OPTIONS };

const mkSku = (h: number): PackSku => ({ id: `HB_${h}`, name: `${h}in holey`, sku: `HB_${h}`, length: 48, width: 24, height: h, weight: 1, category: HOLEY_BOARD_CATEGORY, allowRotation: false });
export const FOUR_ZONE_SKUS: PackSku[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(mkSku);

// [height, qty] per zone — the one real zoned order's quantities, neutral labels.
const FOUR_ZONE_SPEC: Array<{ label: string; seq: number; lines: Array<[number, number]> }> = [
  { label: "ZONE 1", seq: 1, lines: [[1, 24], [2, 40], [3, 56], [4, 52], [5, 60], [6, 40], [7, 40], [8, 40], [9, 40]] },
  { label: "ZONE 2", seq: 2, lines: [[6, 8], [7, 16], [8, 17]] },
  { label: "ZONE 3", seq: 3, lines: [[1, 24], [2, 38], [3, 39], [4, 27], [5, 27], [6, 27]] },
  { label: "ZONE 4", seq: 4, lines: [[6, 16], [7, 46], [8, 45], [9, 21], [10, 20], [11, 3]] },
];

/** The four-zone fixture, quantities scaled by `scale` (ceil). Exported for zoneBol.selfcheck.ts. */
export function fourZoneCart(scale: (q: number) => number = (q) => q): CartLine[] {
  return FOUR_ZONE_SPEC.flatMap((z) => z.lines.map(([h, q]) => ({ skuId: `HB_${h}`, qty: scale(q), offloadSeq: z.seq, zoneLabel: z.label })));
}
export const FOUR_ZONE: CartLine[] = fourZoneCart();

const sumQty = (cart: CartLine[]) => cart.reduce((s, l) => s + l.qty, 0);

function mergeBySku(cart: CartLine[]): CartLine[] {
  const m = new Map<string, number>();
  for (const l of cart) m.set(l.skuId, (m.get(l.skuId) ?? 0) + l.qty);
  return Array.from(m.entries()).map(([skuId, qty]) => ({ skuId, qty }));
}

function columnsOf(t: PackTrailer) {
  return t.rows.flatMap((r) => r.columns);
}

function placedPieces(plan: PackPlan): number {
  return plan.trailers.reduce((s, t) => s + columnsOf(t).reduce((s2, c) => s2 + c.layers.reduce((s3, l) => s3 + l.count, 0), 0), 0);
}

/** One line per row, doors (posFromFront 0) to wall: `pos len | ZONE:stack ...`. */
export function doorToWall(t: PackTrailer): string[] {
  return [...t.rows]
    .sort((a, b) => a.posFromFront - b.posFromFront)
    .map((r) => `${String(r.posFromFront).padStart(4)}" +${r.rowLength} w${r.rowWidthUsed} | ${r.columns.map((c) => `${(c.zoneLabel ?? "?").replace("ZONE ", "Z")}:${c.layers.map((l) => `${l.unitHeight}x${l.count}`).join("+")}${c.onEdge ? "(edge)" : ""}`).join(" ")}`);
}

/** Per-row max offloadSeq is non-decreasing doors -> wall, and a row shares at most adjacent zones. */
function zoneOrderOk(t: PackTrailer): { ok: boolean; detail: string } {
  let prev = -Infinity;
  for (const r of [...t.rows].sort((a, b) => a.posFromFront - b.posFromFront)) {
    const seqs = r.columns.map((c) => c.offloadSeq).filter((s): s is number => typeof s === "number");
    if (!seqs.length) continue;
    const max = Math.max(...seqs);
    const min = Math.min(...seqs);
    if (max < prev) return { ok: false, detail: `row at ${r.posFromFront}: max ${max} < previous ${prev}` };
    if (max - min > 1) return { ok: false, detail: `row at ${r.posFromFront}: zones ${min}..${max} are not adjacent` };
    prev = max;
  }
  return { ok: true, detail: "" };
}

function piecesByZoneSku(plan: PackPlan): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of plan.trailers) for (const c of columnsOf(t)) for (const l of c.layers) m.set(`${c.zoneLabel}|${l.skuId}`, (m.get(`${c.zoneLabel}|${l.skuId}`) ?? 0) + l.count);
  return m;
}

function cartByZoneSku(cart: CartLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of cart) {
    const k = `${l.zoneLabel ?? UNZONED_LABEL}|${l.skuId}`;
    m.set(k, (m.get(k) ?? 0) + l.qty);
  }
  return m;
}

const sameMap = (a: Map<string, number>, b: Map<string, number>) => a.size === b.size && Array.from(a.entries()).every(([k, v]) => b.get(k) === v);

export function runZonedPackSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }
  const dims = TRAILER_TYPES[T53];
  const skus = FOUR_ZONE_SKUS;

  // 0. Zone fields can't affect pack(): same cart with and without them packs identically.
  {
    const stripped = FOUR_ZONE.map(({ skuId, qty }) => ({ skuId, qty }));
    const a = pack(FOUR_ZONE, skus, dims, OPTS);
    const b = pack(stripped, skus, dims, OPTS);
    check("pack() ignores CartLine zone fields (deep-equal plans)", JSON.stringify(a) === JSON.stringify(b));
  }

  // 1. FOUR_ZONE on 53ft: the prototype's result.
  const plan = zonedPack(FOUR_ZONE, skus, dims, OPTS);
  const t0 = plan.trailers[0];
  {
    check(
      "FOUR_ZONE: 1 trailer, 13 rows, 624\", 766 placed, empty balance",
      plan.trailers.length === 1 && t0.rows.length === 13 && t0.usedLength === 624 && placedPieces(plan) === 766 && sumQty(FOUR_ZONE) === 766 && plan.balance.length === 0,
      `${plan.trailers.length} trailers, ${t0?.rows.length} rows, ${t0?.usedLength}", ${placedPieces(plan)} placed, balance ${JSON.stringify(plan.balance)}\n${t0 ? doorToWall(t0).join("\n") : ""}`
    );
    check("FOUR_ZONE: totals are the trailer's", plan.totalUnits === 766 && plan.totalStacks === t0.totalStacks && t0.totalUnits === 766);
    check("FOUR_ZONE: no consolidation summary (left undefined)", plan.consolidation === undefined);
  }

  // 2. Every column carries a zone; a stack holds one zone by construction (one stamp per column).
  {
    const cols = plan.trailers.flatMap(columnsOf);
    const bad = cols.filter((c) => !c.zoneLabel || typeof c.offloadSeq !== "number" || !c.zoneColor);
    check("every column has zoneLabel, offloadSeq and zoneColor", cols.length > 0 && bad.length === 0, `${bad.length} of ${cols.length}`);
    check("zone colors follow delivery index", cols.every((c) => c.zoneColor === ZONE_COLORS[(c.offloadSeq as number) - 1]));
  }

  // 3. Doors -> wall: per-row max offloadSeq non-decreasing; shared rows hold adjacent zones only.
  {
    const r = zoneOrderOk(t0);
    check("FOUR_ZONE: zone order non-decreasing doors -> wall, shared rows adjacent", r.ok, r.detail);
    const first = [...t0.rows].sort((a, b) => a.posFromFront - b.posFromFront)[0];
    check("FOUR_ZONE: the doors row (posFromFront 0) is ZONE 1", first.posFromFront === 0 && first.columns.every((c) => c.zoneLabel === "ZONE 1"));
    const shared = t0.rows.filter((row) => new Set(row.columns.map((c) => c.zoneLabel)).size > 1).length;
    check("FOUR_ZONE: at least one boundary row is shared (gap-fill ran)", shared > 0, String(shared));
  }

  // recomputePlan doesn't disturb row order or positions.
  {
    const again = clonePlan(plan);
    recomputePlan(again, OPTS);
    const sig = (p: PackPlan) => JSON.stringify(p.trailers.map((t) => t.rows.map((r) => [r.posFromFront, r.rowLength, r.columns.map((c) => c.posY)])));
    check("recomputePlan leaves posFromFront / posY unchanged", sig(again) === sig(plan));
  }

  // 4. FOUR_ZONE x2: 2 trailers, Truck 1 starts at the doors with ZONE 1, ZONE 4 finishes on Truck 2.
  {
    const cart = fourZoneCart((q) => q * 2);
    const p2 = zonedPack(cart, skus, dims, OPTS);
    const doors = (t: PackTrailer) => [...t.rows].sort((a, b) => a.posFromFront - b.posFromFront)[0];
    check(
      "FOUR_ZONE x2: 2 trailers",
      p2.trailers.length === 2,
      `${p2.trailers.length}\n${p2.trailers.map((t, i) => `T${i + 1}\n${doorToWall(t).join("\n")}`).join("\n")}`
    );
    check("FOUR_ZONE x2: Truck 1 starts at the doors with ZONE 1", !!p2.trailers[0] && doors(p2.trailers[0]).columns.every((c) => c.zoneLabel === "ZONE 1"));
    const last = p2.trailers[p2.trailers.length - 1];
    const wall = [...last.rows].sort((a, b) => b.posFromFront - a.posFromFront)[0];
    check("FOUR_ZONE x2: ZONE 4 finishes on Truck 2 (its wall row)", p2.trailers.length === 2 && wall.columns.some((c) => c.zoneLabel === "ZONE 4"));
    check("FOUR_ZONE x2: each truck's zone order holds", p2.trailers.every((t) => zoneOrderOk(t).ok));
    check("FOUR_ZONE x2: conserved per zone and SKU, empty balance", sameMap(piecesByZoneSku(p2), cartByZoneSku(cart)) && p2.balance.length === 0);
    const v = validatePlan(p2, mergeBySku(cart), skus, OPTS);
    check("FOUR_ZONE x2: validatePlan clean", v.length === 0, JSON.stringify(v.slice(0, 3)));
  }

  // 5. FOUR_ZONE at ceil(q/3): 1 trailer, 7 rows.
  {
    const p3 = zonedPack(fourZoneCart((q) => Math.ceil(q / 3)), skus, dims, OPTS);
    check("FOUR_ZONE ceil(q/3): 1 trailer, 7 rows", p3.trailers.length === 1 && p3.trailers[0].rows.length === 7, `${p3.trailers.length} trailers, ${p3.trailers[0]?.rows.length} rows\n${p3.trailers[0] ? doorToWall(p3.trailers[0]).join("\n") : ""}`);
    check("FOUR_ZONE ceil(q/3): zone order holds", zoneOrderOk(p3.trailers[0]).ok, zoneOrderOk(p3.trailers[0]).detail);
  }

  // 6. Same SKU in two zones stays separate per zone.
  {
    check("FOUR_ZONE: per-zone, per-SKU pieces match the cart", sameMap(piecesByZoneSku(plan), cartByZoneSku(FOUR_ZONE)));
    const hb6 = Array.from(piecesByZoneSku(plan).entries()).filter(([k]) => k.endsWith("|HB_6"));
    check("FOUR_ZONE: HB_6 appears in all four zones, separately", hb6.length === 4, JSON.stringify(hb6));
    const dup: CartLine[] = [
      { skuId: "HB_6", qty: 10, offloadSeq: 1, zoneLabel: "A" },
      { skuId: "HB_6", qty: 5, offloadSeq: 1, zoneLabel: "A" },
      { skuId: "HB_6", qty: 7, offloadSeq: 2, zoneLabel: "B" },
    ];
    const pd = zonedPack(dup, skus, dims, OPTS);
    const m = piecesByZoneSku(pd);
    check("two lines of one SKU in one zone merge; the other zone stays apart", m.get("A|HB_6") === 15 && m.get("B|HB_6") === 7 && m.size === 2, JSON.stringify(Array.from(m.entries())));
  }

  // 7. An unzoned line lands at the wall under UNZONED_LABEL, with no color.
  {
    const cart: CartLine[] = [...fourZoneCart((q) => Math.ceil(q / 3)), { skuId: "HB_4", qty: 30 }];
    const pu = zonedPack(cart, skus, dims, OPTS);
    const t = pu.trailers[pu.trailers.length - 1];
    const wall = [...t.rows].sort((a, b) => b.posFromFront - a.posFromFront)[0];
    const unz = pu.trailers.flatMap(columnsOf).filter((c) => c.zoneLabel === UNZONED_LABEL);
    check("unzoned: the wall row holds Unzoned stacks", wall.columns.some((c) => c.zoneLabel === UNZONED_LABEL), doorToWall(t).join("\n"));
    check("unzoned: offloadSeq null, zoneColor unset, 30 pieces", unz.length > 0 && unz.every((c) => c.offloadSeq === null && c.zoneColor === undefined) && unz.reduce((s, c) => s + c.stackCount, 0) === 30);
    check("unzoned: zone order holds (Unzoned ignored)", zoneOrderOk(t).ok);
  }

  // 8. A piece too large for any trailer: balance + warning, no infinite loop.
  {
    const huge: PackSku = { id: "HUGE", name: "huge", sku: "HUGE", length: 900, width: 24, height: 4, weight: 1, category: "Blocks", allowRotation: false };
    const cart: CartLine[] = [
      { skuId: "HB_4", qty: 20, offloadSeq: 1, zoneLabel: "A" },
      { skuId: "HUGE", qty: 3, offloadSeq: 2, zoneLabel: "B" },
    ];
    const ph = zonedPack(cart, [...skus, huge], dims, OPTS);
    check("too large: 3 HUGE in balance", ph.balance.some((b) => b.skuId === "HUGE" && b.remaining === 3), JSON.stringify(ph.balance));
    check("too large: warning names the zone", ph.warnings.some((w) => w.startsWith("[B] ")), JSON.stringify(ph.warnings));
    check("too large: the rest still packs", placedPieces(ph) === 20 && ph.trailers.length === 1);
    const v = validatePlan(ph, mergeBySku(cart), [...skus, huge], OPTS);
    check("too large: validatePlan clean (conservation includes balance)", v.length === 0, JSON.stringify(v.slice(0, 3)));
  }

  // 9. validatePlan on FOUR_ZONE (cart merged by SKU for the conservation rule).
  {
    const v = validatePlan(plan, mergeBySku(FOUR_ZONE), skus, OPTS);
    check("FOUR_ZONE: validatePlan reports zero violations", v.length === 0, JSON.stringify(v.slice(0, 3)));
  }

  // 10. Holey board on the 26ft box truck: never a gap-fill beside an on-edge column.
  {
    const cart = fourZoneCart((q) => Math.ceil(q / 4));
    const pb = zonedPack(cart, skus, TRAILER_TYPES[BOX], OPTS);
    const edgeRows = pb.trailers.flatMap((t) => t.rows).filter((r) => r.columns.some((c) => c.onEdge));
    check("box truck: an on-edge column was placed (the case is exercised)", edgeRows.length > 0, pb.trailers.map((t) => doorToWall(t).join("\n")).join("\n--\n"));
    check("box truck: rows with an on-edge column hold one zone only", edgeRows.every((r) => new Set(r.columns.map((c) => c.zoneLabel)).size === 1));
    check("box truck: conserved per zone, empty balance", sameMap(piecesByZoneSku(pb), cartByZoneSku(cart)) && pb.balance.length === 0);
    const v = validatePlan(pb, mergeBySku(cart), skus, OPTS);
    check("box truck: validatePlan clean", v.length === 0, JSON.stringify(v.slice(0, 3)));
  }

  // Empty cart.
  {
    const pe = zonedPack([], skus, dims, OPTS);
    check("empty cart: no trailers, no balance", pe.trailers.length === 0 && pe.balance.length === 0);
  }

  return { pass: results.every((r) => r.pass), results };
}
