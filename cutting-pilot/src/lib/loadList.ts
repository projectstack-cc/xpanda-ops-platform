// src/lib/loadList.ts
// lbr-08: the load list — the cart the engine packs, as the Load tab's picker and list card edit it.
// Pure helpers only (no React, no fetch). Every helper returns a NEW array, never mutates its input,
// keeps line order stable (a merged line stays where it was; a new line goes on the end) and drops
// any line whose qty ends up <= 0.
import type { CartLine, PackSku } from "./packEngine";

function clean(qty: number): number {
  return Number.isFinite(qty) ? Math.floor(qty) : 0;
}

/** lbz-v2-02: which zone a list edit targets. Omitted = the line with no zone (on a non-zoned load,
 * every line), which is exactly the pre-zone behavior. */
export interface LineZone {
  offloadSeq?: number | null;
  zoneLabel?: string | null;
}

function zoneLabelOf(z: LineZone | undefined): string | null {
  const s = (z?.zoneLabel ?? "").toString().trim();
  return s ? s : null;
}

/** True when `line` is `skuId` in `zone` (no zone argument / no label = a line with no zone). */
export function sameLine(line: CartLine, skuId: string, zone?: LineZone): boolean {
  if (line.skuId !== skuId) return false;
  const want = zoneLabelOf(zone);
  const have = zoneLabelOf(line);
  if (want === null) return have === null;
  return have === want && (line.offloadSeq ?? null) === (zone?.offloadSeq ?? null);
}

function newLine(skuId: string, qty: number, zone?: LineZone): CartLine {
  const label = zoneLabelOf(zone);
  return label === null ? { skuId, qty } : { skuId, qty, offloadSeq: zone?.offloadSeq ?? null, zoneLabel: label };
}

/** Adds `qty` of `sku`, merging into the existing line for the same skuId (and zone). */
export function addLine(list: CartLine[], sku: Pick<PackSku, "id">, qty = 1, zone?: LineZone): CartLine[] {
  const n = clean(qty);
  const found = list.some((c) => sameLine(c, sku.id, zone));
  const next = found ? list.map((c) => (sameLine(c, sku.id, zone) ? { ...c, qty: c.qty + n } : { ...c })) : [...list.map((c) => ({ ...c })), newLine(sku.id, n, zone)];
  return next.filter((c) => c.qty > 0);
}

/** Sets a line's qty (0 or less removes it). An unknown skuId (or zone) with a positive qty is appended. */
export function setQty(list: CartLine[], skuId: string, qty: number, zone?: LineZone): CartLine[] {
  const n = clean(qty);
  const found = list.some((c) => sameLine(c, skuId, zone));
  const next = found ? list.map((c) => (sameLine(c, skuId, zone) ? { ...c, qty: n } : { ...c })) : [...list.map((c) => ({ ...c })), newLine(skuId, n, zone)];
  return next.filter((c) => c.qty > 0);
}

/** Steps a line up or down by one. Stepping up an absent line adds it at 1. */
export function step(list: CartLine[], skuId: string, delta: 1 | -1, zone?: LineZone): CartLine[] {
  const current = list.find((c) => sameLine(c, skuId, zone))?.qty ?? 0;
  return setQty(list, skuId, current + delta, zone);
}

export function clear(_list: CartLine[]): CartLine[] {
  return [];
}

export interface LoadListDiff {
  skuId: string;
  orderQty: number;
  listQty: number;
  // lbz-v2-02: set only for a zoned line (absent on a non-zoned diff, which keeps its old shape).
  offloadSeq?: number | null;
  zoneLabel?: string;
}

/** Lines where the list differs from the order: changed or removed (in order-cart order), then
 * added (in list order). Empty when they match. Summed by SKU and zone, so moving pieces between
 * zones never nets out to "no change". */
export function diffFromOrder(orderCart: CartLine[], list: CartLine[]): LoadListDiff[] {
  const keyOf = (c: CartLine) => {
    const label = zoneLabelOf(c);
    return label === null ? c.skuId : JSON.stringify([c.skuId, c.offloadSeq ?? null, label]);
  };
  const sum = (cart: CartLine[]) => {
    const m = new Map<string, { line: CartLine; qty: number }>();
    for (const c of cart) {
      const k = keyOf(c);
      const e = m.get(k);
      if (e) e.qty += c.qty;
      else m.set(k, { line: c, qty: c.qty });
    }
    return m;
  };
  const diff = (line: CartLine, orderQty: number, listQty: number): LoadListDiff => {
    const label = zoneLabelOf(line);
    return label === null ? { skuId: line.skuId, orderQty, listQty } : { skuId: line.skuId, orderQty, listQty, offloadSeq: line.offloadSeq ?? null, zoneLabel: label };
  };
  const order = sum(orderCart);
  const listed = sum(list);
  const out: LoadListDiff[] = [];
  order.forEach((o, k) => {
    const listQty = listed.get(k)?.qty ?? 0;
    if (listQty !== o.qty) out.push(diff(o.line, o.qty, listQty));
  });
  listed.forEach((l, k) => {
    if (!order.has(k)) out.push(diff(l.line, 0, l.qty));
  });
  return out;
}

/** A library record narrowed to PackSku's own fields (drops picker-only extras like parentGroup),
 * so nothing new reaches pack() or a saved snapshot. */
export function toPackSku(s: PackSku): PackSku {
  const out: PackSku = { id: s.id, name: s.name, sku: s.sku, length: s.length, width: s.width, height: s.height, weight: s.weight, allowRotation: s.allowRotation };
  if (s.category !== undefined) out.category = s.category;
  if (s.bundleQty !== undefined) out.bundleQty = s.bundleQty;
  return out;
}

/** Appends `sku` to a SKU set when its id isn't there yet (append-only, deduped by id). */
export function withSku(skus: PackSku[], sku: PackSku): PackSku[] {
  return skus.some((s) => s.id === sku.id) ? skus : [...skus, toPackSku(sku)];
}
