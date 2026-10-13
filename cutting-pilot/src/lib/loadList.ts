// src/lib/loadList.ts
// lbr-08: the load list — the cart the engine packs, as the Load tab's picker and list card edit it.
// Pure helpers only (no React, no fetch). Every helper returns a NEW array, never mutates its input,
// keeps line order stable (a merged line stays where it was; a new line goes on the end) and drops
// any line whose qty ends up <= 0.
import type { CartLine, PackSku } from "./packEngine";

function clean(qty: number): number {
  return Number.isFinite(qty) ? Math.floor(qty) : 0;
}

/** Adds `qty` of `sku`, merging into the existing line for the same skuId. */
export function addLine(list: CartLine[], sku: Pick<PackSku, "id">, qty = 1): CartLine[] {
  const n = clean(qty);
  const found = list.some((c) => c.skuId === sku.id);
  const next = found ? list.map((c) => (c.skuId === sku.id ? { ...c, qty: c.qty + n } : { ...c })) : [...list.map((c) => ({ ...c })), { skuId: sku.id, qty: n }];
  return next.filter((c) => c.qty > 0);
}

/** Sets a line's qty (0 or less removes it). An unknown skuId with a positive qty is appended. */
export function setQty(list: CartLine[], skuId: string, qty: number): CartLine[] {
  const n = clean(qty);
  const found = list.some((c) => c.skuId === skuId);
  const next = found ? list.map((c) => (c.skuId === skuId ? { ...c, qty: n } : { ...c })) : [...list.map((c) => ({ ...c })), { skuId, qty: n }];
  return next.filter((c) => c.qty > 0);
}

/** Steps a line up or down by one. Stepping up an absent line adds it at 1. */
export function step(list: CartLine[], skuId: string, delta: 1 | -1): CartLine[] {
  const current = list.find((c) => c.skuId === skuId)?.qty ?? 0;
  return setQty(list, skuId, current + delta);
}

export function clear(_list: CartLine[]): CartLine[] {
  return [];
}

export interface LoadListDiff {
  skuId: string;
  orderQty: number;
  listQty: number;
}

/** Lines where the list differs from the order: changed or removed (in order-cart order), then
 * added (in list order). Empty when they match. */
export function diffFromOrder(orderCart: CartLine[], list: CartLine[]): LoadListDiff[] {
  const sum = (cart: CartLine[]) => {
    const m = new Map<string, number>();
    for (const c of cart) m.set(c.skuId, (m.get(c.skuId) ?? 0) + c.qty);
    return m;
  };
  const order = sum(orderCart);
  const listed = sum(list);
  const out: LoadListDiff[] = [];
  order.forEach((orderQty, skuId) => {
    const listQty = listed.get(skuId) ?? 0;
    if (listQty !== orderQty) out.push({ skuId, orderQty, listQty });
  });
  listed.forEach((listQty, skuId) => {
    if (!order.has(skuId)) out.push({ skuId, orderQty: 0, listQty });
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
