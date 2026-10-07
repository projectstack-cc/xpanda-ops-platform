// src/lib/offloadZones.ts
// jb-07 — offload-zone validation, ported verbatim from legacy jobs/index.html validateZoneRows()
// (same check order, same English messages as the en jobs.zoneError* strings). Every line needs a
// non-empty label, every label needs a numeric order, and those per-label orders must be contiguous
// starting at 1. offload_seq may arrive as a DB integer, a string from an <input>, or
// null/undefined/'' — Number(null) is 0 (finite!), so null/''/undefined must be caught before the
// isFinite check (same pitfall as the worker's nullableInt()). Returns null when valid.

export interface ZoneRow {
  zone_label?: string | null;
  offload_seq?: number | string | null;
}

export function validateZoneRows(rows: ZoneRow[]): string | null {
  if (!Array.isArray(rows) || !rows.length) return "Add line items before enabling offload zones.";
  const orderByLabel = new Map<string, number>();
  const labelsInOrder: string[] = [];
  for (const r of rows) {
    const label = (r.zone_label || "").toString().trim();
    if (!label) return "Every line item needs a zone label.";
    const raw = r.offload_seq;
    if (raw === null || raw === undefined || raw === "") return "Every zone needs a delivery order.";
    const order = Number(raw);
    if (!Number.isFinite(order)) return "Every zone needs a delivery order.";
    if (!orderByLabel.has(label)) {
      orderByLabel.set(label, order);
      labelsInOrder.push(label);
    } else if (orderByLabel.get(label) !== order) {
      return "Lines sharing a zone label must share the same delivery order.";
    }
  }
  const orders = labelsInOrder.map((l) => orderByLabel.get(l) as number).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] !== i + 1) return "Delivery orders must be contiguous starting at 1.";
  }
  return null;
}
