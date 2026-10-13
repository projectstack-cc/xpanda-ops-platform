// src/lib/forcedPack.ts
// lbr-10: Force sizes — the planner picks the exact trucks (e.g. 1 × 53ft Standard, then 1 × 26ft
// Box Truck). Legacy parity (load-builder.html calcLoading ~863–880, 993): the forced queue is
// filled IN ORDER, one trailer per entry; whatever is left continues on the default trailer type;
// auto-downsize is off while forcing. Composes pack() — packEngine.ts / stackPlanner.ts are not
// edited (the only packEngine.ts change is the type-only `PackTrailer.forced?: true` flag this
// module sets).
//
// Each queued entry runs pack() on the REMAINING demand against that type and keeps only its first
// trailer, so every forced trailer is packed as well as pack() would pack it given what's left. The
// leftover then goes to one pack() call on the default type (all its trailers kept).
//
// Warnings: per-trailer lines (`trailer ${ti} row …`, packEngine's applyStabilityWarnings) are re-
// indexed from each call's local trailer index to the global one, so filterTrailerWarnings keeps
// working; for a queued call only its kept trailer 0's lines survive. Plain lines are deduped. A
// queued call's "trailerLimit reached" / "unable to place remaining" lines describe the trailers
// that call would have built after trailer 0 — which are discarded — so they are dropped too.
//
// Consolidation: `topOffStacks` is counted from the stacks actually kept (a queued call's own count
// covers trailers that were thrown away); `shortenedStacks` is only reported per call, so it is the
// per-call sum, capped at what was kept being mixed at all.
import type { CartLine, PackOptions, PackPlan, PackSku, PackTrailer } from "./packEngine";
import { pack, TRAILER_TYPES } from "./packEngine";

export interface ForcedTrailer {
  /** A TRAILER_TYPES key. */
  type: string;
  /** 1–10 (legacy's input bounds). */
  count: number;
}

export const FORCED_COUNT_MIN = 1;
export const FORCED_COUNT_MAX = 10;

const PER_TRAILER = /^trailer (\d+) ([\s\S]*)$/;
const QUEUED_CALL_ONLY = [/^trailerLimit \(/, /^unable to place remaining /];

function placedBySku(trailer: PackTrailer): Map<string, number> {
  const m = new Map<string, number>();
  for (const row of trailer.rows) for (const column of row.columns) for (const layer of column.layers) m.set(layer.skuId, (m.get(layer.skuId) ?? 0) + layer.count);
  return m;
}

function subtract(cart: CartLine[], placed: Map<string, number>): CartLine[] {
  const left = new Map<string, number>();
  for (const line of cart) left.set(line.skuId, (left.get(line.skuId) ?? 0) + line.qty);
  for (const [skuId, n] of Array.from(placed.entries())) left.set(skuId, (left.get(skuId) ?? 0) - n);
  return Array.from(left.entries())
    .filter(([, qty]) => qty > 0)
    .map(([skuId, qty]) => ({ skuId, qty }));
}

/** Packs `cart` onto the trucks in `queue` (in order, one trailer per entry), then onto
 * `defaultTypeKey` for anything left. An empty queue returns plain pack() output unchanged. */
export function packForced(cart: CartLine[], skus: PackSku[], queue: ForcedTrailer[], defaultTypeKey: string, options: Partial<PackOptions>): PackPlan {
  const defaultDims = TRAILER_TYPES[defaultTypeKey];
  if (queue.length === 0) return pack(cart, skus, defaultDims, options);

  const warnings: string[] = [];
  const plain = new Set<string>();
  const addPlain = (w: string) => {
    if (!plain.has(w)) {
      plain.add(w);
      warnings.push(w);
    }
  };
  const addCallWarnings = (callWarnings: string[], keepLocal: (i: number) => boolean, offset: number, queued: boolean) => {
    for (const w of callWarnings) {
      const m = PER_TRAILER.exec(w);
      if (m) {
        const local = Number(m[1]);
        if (keepLocal(local)) warnings.push(`trailer ${offset + local} ${m[2]}`);
      } else if (!(queued && QUEUED_CALL_ONLY.some((re) => re.test(w)))) {
        addPlain(w);
      }
    }
  };

  const trailerLimit = options.trailerLimit ?? 20;
  const types: string[] = [];
  for (const entry of queue) {
    if (!TRAILER_TYPES[entry.type]) {
      addPlain(`Unknown trailer type "${entry.type}" in Force sizes — skipped.`);
      continue;
    }
    const count = Math.max(FORCED_COUNT_MIN, Math.min(FORCED_COUNT_MAX, Math.floor(entry.count) || FORCED_COUNT_MIN));
    for (let i = 0; i < count && types.length < trailerLimit; i++) types.push(entry.type);
  }
  if (types.length === 0) {
    const plan = pack(cart, skus, defaultDims, options);
    return { ...plan, warnings: [...warnings, ...plan.warnings] };
  }

  const trailers: PackTrailer[] = [];
  let remaining = cart.filter((l) => l.qty > 0);
  let anyApplied = false;
  let shortened = 0;
  let balance: PackPlan["balance"] = [];

  for (const type of types) {
    if (remaining.length === 0) break;
    const call = pack(remaining, skus, TRAILER_TYPES[type], { ...options, autoDownsize: false, trailerTypeLabel: type });
    if (call.trailers.length === 0) {
      addCallWarnings(call.warnings, () => false, trailers.length, true);
      break;
    }
    const kept: PackTrailer = { ...call.trailers[0], forced: true };
    addCallWarnings(call.warnings, (i) => i === 0, trailers.length, true);
    if (call.consolidation?.applied) {
      anyApplied = true;
      shortened += call.consolidation.shortenedStacks;
    }
    trailers.push(kept);
    remaining = subtract(remaining, placedBySku(kept));
  }

  if (remaining.length > 0) {
    const leftPieces = remaining.reduce((s, l) => s + l.qty, 0);
    const call = pack(remaining, skus, defaultDims, {
      ...options,
      autoDownsize: false,
      trailerTypeLabel: defaultTypeKey,
      trailerLimit: Math.max(1, trailerLimit - trailers.length),
    });
    addCallWarnings(call.warnings, () => true, trailers.length, false);
    if (call.consolidation?.applied) {
      anyApplied = true;
      shortened += call.consolidation.shortenedStacks;
    }
    trailers.push(...call.trailers);
    balance = call.balance;
    if (call.trailers.length > 0) addPlain(`${leftPieces} pieces didn't fit the forced trucks — added ${call.trailers.length} × ${defaultTypeKey}.`);
  }

  const topOffStacks = trailers.reduce((s, t) => s + t.rows.reduce((s2, r) => s2 + r.columns.filter((c) => c.layers.length > 1).length, 0), 0);
  const applied = anyApplied && topOffStacks > 0;
  return {
    trailers,
    balance,
    warnings,
    totalWeight: trailers.reduce((s, t) => s + t.usedWeight, 0),
    totalUnits: trailers.reduce((s, t) => s + t.totalUnits, 0),
    totalStacks: trailers.reduce((s, t) => s + t.totalStacks, 0),
    mixedStacks: trailers.reduce((s, t) => s + t.mixedStacks, 0),
    consolidation: {
      applied,
      trailers: trailers.length,
      pureTrailers: trailers.length,
      topOffStacks,
      shortenedStacks: applied ? shortened : 0,
      note: applied ? `Mixed ${topOffStacks} stacks to fit the trucks you picked` : null,
    },
  };
}
