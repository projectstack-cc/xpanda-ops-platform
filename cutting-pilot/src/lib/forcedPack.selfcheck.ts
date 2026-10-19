// src/lib/forcedPack.selfcheck.ts
// lbr-10: guarded dev self-check for forcedPack.ts (Force sizes). Pure, no network; mirrors the
// other Load Builder selfchecks' shape. Not part of the production build path.
import { packForced } from "./forcedPack";
import { pack, validatePlan, TRAILER_TYPES, DEFAULT_PACK_OPTIONS, HOLEY_BOARD_CATEGORY } from "./packEngine";
import type { CartLine, PackPlan, PackSku } from "./packEngine";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const T53 = "53ft Standard";
const BOX = "26ft Box Truck";
const OPTS = { ...DEFAULT_PACK_OPTIONS };

// lbr-03's golden rows (GOLDEN_4472_T1), nose -> doors.
const GOLDEN_WANT = [
  "13x8 13x8 13x8 13x8",
  "13x8 13x8 13x8 13x8",
  "13x8 13x7+9x2 13x6+10x3 12x9",
  "12x9 12x9 12x9 12x9",
  "12x9 12x9 12x9 12x9",
  "12x9 12x9 12x9 12x9",
  "12x3+10x7 11x9+10x1 11x9+10x1 11x9+10x1",
  "11x9+10x1 11x9+10x1 11x9+10x1 11x9+10x1",
  "11x9+10x1 11x9+10x1 11x9+10x1 11x9+10x1",
  "11x9+10x1 11x9+10x1 11x9+10x1 11x9+10x1",
  "11x9+10x1 11x9+10x1 11x9+10x1 11x9+10x1",
  "11x9+10x1 11x9+10x1 11x6+10x4 10x10+8x1",
  "10x10+9x1 10x10+9x1 10x10+9x1 10x10+9x1",
];

const mkGolden = (h: number): PackSku => ({ id: `GOLD_${h}`, name: `${h}in holey`, sku: `GOLD_${h}`, length: 48, width: 24, height: h, weight: 1, category: HOLEY_BOARD_CATEGORY, allowRotation: false });
const GOLDEN_SKUS = [13, 12, 11, 10, 9, 8].map(mkGolden);
const GOLDEN_QTY: Record<number, number> = { 13: 85, 12: 120, 11: 195, 10: 85, 9: 6, 8: 1 };
const GOLDEN_CART: CartLine[] = GOLDEN_SKUS.map((s) => ({ skuId: s.id, qty: GOLDEN_QTY[s.height] }));

function rowsNoseFirst(plan: PackPlan, t: number): string[] {
  return [...(plan.trailers[t]?.rows ?? [])]
    .reverse()
    .map((r) => [...r.columns].sort((a, b) => a.posY - b.posY).map((c) => c.layers.map((l) => `${l.unitHeight}x${l.count}`).join("+")).join(" "));
}

function placedPlusBalance(plan: PackPlan): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of plan.trailers) for (const r of t.rows) for (const c of r.columns) for (const l of c.layers) m.set(l.skuId, (m.get(l.skuId) ?? 0) + l.count);
  for (const b of plan.balance) m.set(b.skuId, (m.get(b.skuId) ?? 0) + b.remaining);
  return m;
}

function conserves(plan: PackPlan, cart: CartLine[]): boolean {
  const m = placedPlusBalance(plan);
  return cart.every((l) => m.get(l.skuId) === l.qty) && m.size === cart.length;
}

export function runForcedPackSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  const plain = pack(GOLDEN_CART, GOLDEN_SKUS, TRAILER_TYPES[T53], OPTS);

  // 0. Empty queue -> identical to plain pack() output.
  {
    const forced = packForced(GOLDEN_CART, GOLDEN_SKUS, [], T53, OPTS);
    check("empty queue: deep-equals plain pack()", JSON.stringify(forced) === JSON.stringify(plain));
  }

  // 1. Golden forced [53ft × 1] == plain pack(): same rows (the lbr-03 golden list), balance, totals.
  //    Not byte-identical by design: the forced trailer carries type "53ft Standard" + forced: true,
  //    and the consolidation note reads "…to fit the trucks you picked".
  {
    const forced = packForced(GOLDEN_CART, GOLDEN_SKUS, [{ type: T53, count: 1 }], T53, OPTS);
    check("golden [53ft × 1]: 1 trailer, forced, typed 53ft Standard", forced.trailers.length === 1 && forced.trailers[0].forced === true && forced.trailers[0].type === T53);
    check("golden [53ft × 1]: rows equal the lbr-03 golden list", JSON.stringify(rowsNoseFirst(forced, 0)) === JSON.stringify(GOLDEN_WANT), JSON.stringify(rowsNoseFirst(forced, 0)));
    check("golden [53ft × 1]: rows deep-equal plain pack()'s", JSON.stringify(forced.trailers[0].rows) === JSON.stringify(plain.trailers[0].rows));
    check(
      "golden [53ft × 1]: balance, totals and plain warnings equal plain pack()'s",
      JSON.stringify(forced.balance) === JSON.stringify(plain.balance) &&
        forced.totalUnits === plain.totalUnits &&
        forced.totalStacks === plain.totalStacks &&
        forced.mixedStacks === plain.mixedStacks &&
        JSON.stringify(forced.warnings) === JSON.stringify(plain.warnings)
    );
    check(
      "golden [53ft × 1]: consolidation applied, 30 top-offs, note names the picked trucks",
      forced.consolidation?.applied === true && forced.consolidation.topOffStacks === 30 && forced.consolidation.note === "Mixed 30 stacks to fit the trucks you picked" && forced.consolidation.pureTrailers === 1,
      JSON.stringify(forced.consolidation)
    );
    check("golden [53ft × 1]: validatePlan clean", validatePlan(forced, GOLDEN_CART, GOLDEN_SKUS, OPTS).length === 0);
  }

  // 2. Golden forced [26ft Box Truck × 2]: two box trucks first, the rest on 53ft, overflow warning.
  {
    const forced = packForced(GOLDEN_CART, GOLDEN_SKUS, [{ type: BOX, count: 2 }], T53, OPTS);
    const box = TRAILER_TYPES[BOX];
    check("golden [box × 2]: 3+ trailers", forced.trailers.length >= 3, String(forced.trailers.length));
    check(
      "golden [box × 2]: trailers 1–2 have box-truck dims, type and the forced flag",
      forced.trailers.slice(0, 2).every((t) => JSON.stringify(t.dims) === JSON.stringify(box) && t.type === BOX && t.forced === true),
      JSON.stringify(forced.trailers.map((t) => [t.type, t.dims.length, t.forced]))
    );
    check(
      "golden [box × 2]: the rest are 53ft Standard, not forced",
      forced.trailers.slice(2).every((t) => t.dims.length === TRAILER_TYPES[T53].length && t.type === T53 && t.forced === undefined),
      JSON.stringify(forced.trailers.slice(2).map((t) => [t.type, t.forced]))
    );
    const overflow = forced.warnings.find((w) => / pieces didn't fit the forced trucks — added \d+ × 53ft Standard\.$/.test(w));
    check("golden [box × 2]: overflow warning present", !!overflow, String(overflow));
    check("golden [box × 2]: pieces conserved (placed + balance == cart)", conserves(forced, GOLDEN_CART));
    check("golden [box × 2]: nothing left in balance", forced.balance.length === 0, JSON.stringify(forced.balance));
    const v = validatePlan(forced, GOLDEN_CART, GOLDEN_SKUS, OPTS);
    check("golden [box × 2]: validatePlan reports zero violations", v.length === 0, JSON.stringify(v));
    check("golden [box × 2]: pureTrailers = trailers (truck count fixed by the user)", forced.consolidation?.pureTrailers === forced.trailers.length && forced.consolidation?.trailers === forced.trailers.length);
    check(
      "golden [box × 2]: totals are the trailers' sums",
      forced.totalUnits === forced.trailers.reduce((s, t) => s + t.totalUnits, 0) && forced.totalStacks === forced.trailers.reduce((s, t) => s + t.totalStacks, 0)
    );
  }

  // 3. More forced trucks than needed: golden [53ft × 3] -> 1 trailer, no empty trailers.
  {
    const forced = packForced(GOLDEN_CART, GOLDEN_SKUS, [{ type: T53, count: 3 }], T53, OPTS);
    check("golden [53ft × 3]: 1 trailer, no empty trailers emitted", forced.trailers.length === 1 && forced.trailers.every((t) => t.totalStacks > 0), String(forced.trailers.length));
    check("golden [53ft × 3]: no overflow warning", !forced.warnings.some((w) => w.includes("didn't fit the forced trucks")));
  }

  // 4. Unknown type: warned and skipped; the known entry still runs.
  {
    const forced = packForced(GOLDEN_CART, GOLDEN_SKUS, [{ type: "99ft Spaceship", count: 1 }, { type: T53, count: 1 }], T53, OPTS);
    check("unknown type: warning", forced.warnings.includes('Unknown trailer type "99ft Spaceship" in Force sizes — skipped.'), JSON.stringify(forced.warnings));
    check("unknown type: skipped — the 53ft entry still packs everything", forced.trailers.length === 1 && forced.trailers[0].forced === true);
    const onlyUnknown = packForced(GOLDEN_CART, GOLDEN_SKUS, [{ type: "nope", count: 2 }], T53, OPTS);
    check("only unknown types: plain pack() plus the warning", JSON.stringify(onlyUnknown.trailers) === JSON.stringify(plain.trailers) && onlyUnknown.warnings[0].startsWith('Unknown trailer type "nope"'));
  }

  // 5. Stability-warning re-indexing. Box truck 1 is filled exactly by a 52×24 filler (6 rows × 3
  //    across × 10 high = 180 pieces); the tall 10×20×40 pieces (40 > 3 × 10) land on forced trailer
  //    2, whose pack() call numbers it "trailer 0" — it must come out as "trailer 1 …". (lb-box-01:
  //    the box truck is now 91" wide, so 3 × 24" filler leaves a 19" gap — the tall piece is now 20"
  //    wide (was 10×10) so it can't ride in that gap and the premise holds.)
  {
    const filler: PackSku = { id: "FILL", name: "filler", sku: "FILL", length: 52, width: 24, height: 10, weight: 1, category: "Blocks", allowRotation: false };
    const tall: PackSku = { id: "TALL", name: "tall", sku: "TALL", length: 10, width: 20, height: 40, weight: 1, category: "Blocks", allowRotation: false };
    const cart: CartLine[] = [
      { skuId: "FILL", qty: 180 },
      { skuId: "TALL", qty: 2 },
    ];
    const forced = packForced(cart, [filler, tall], [{ type: BOX, count: 2 }], T53, OPTS);
    const tallOn = forced.trailers.findIndex((t) => t.rows.some((r) => r.columns.some((c) => c.layers.some((l) => l.skuId === "TALL"))));
    check("stability fixture: the tall pieces are on forced trailer 2", tallOn === 1, `${tallOn} / ${forced.trailers.length} trailers`);
    const stab = forced.warnings.filter((w) => w.includes("stability:"));
    check("stability: re-indexed to the global trailer (prefix 'trailer 1 ')", stab.length > 0 && stab.every((w) => w.startsWith("trailer 1 ")), JSON.stringify(stab));
    check("stability fixture: conserved, validatePlan clean", conserves(forced, cart) && validatePlan(forced, cart, [filler, tall], OPTS).length === 0, JSON.stringify(validatePlan(forced, cart, [filler, tall], OPTS)));
  }

  // 6. Runner height flows through options; counts clamp to 1–10.
  {
    const forced = packForced(GOLDEN_CART, GOLDEN_SKUS, [{ type: BOX, count: 0 }], T53, { ...OPTS, runnerHeight: 4 });
    check("count 0 clamps to 1 (one box truck first)", forced.trailers[0]?.type === BOX && forced.trailers[1]?.type === T53, JSON.stringify(forced.trailers.map((t) => t.type)));
    const tallest = Math.max(...forced.trailers.flatMap((t) => t.rows.flatMap((r) => r.columns.map((c) => c.totalHeight))));
    check("runnerHeight 4: no stack taller than 104″", tallest <= 104 + 1e-6, String(tallest));
  }

  return { pass: results.every((r) => r.pass), results };
}
