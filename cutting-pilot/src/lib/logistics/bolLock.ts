// src/lib/logistics/bolLock.ts — per-load BOL edit lock (bol-lock-01).
// Mirrored inline in legacy _worker.js/routes/bols.js (PUT) and logistics/index.html
// (viewBolForJob). Keep all three in lockstep. The server is authoritative.
//
// A BOL is locked when:
//   1. the job's outbound shipment is archived/cancelled (whole-job states), or
//   2. it has a load_number with a matching non-archived loading_assignments row, and that
//      load is in_transit/delivered (loads ship independently), or
//   3. fallback (null load_number / no matching row): the shipment is in_transit, delivered,
//      archived or cancelled -- the pre-bol-lock-01 job-level rule.
// `loaded` stays editable.

const JOB_LOCKED = ["archived", "cancelled"];
const LOAD_LOCKED = ["in_transit", "delivered"];
const FALLBACK_LOCKED = ["in_transit", "delivered", "archived", "cancelled"];

export function isBolLocked({
  loadNumber,
  assignmentStatus,
  shipmentStatus,
}: {
  loadNumber: number | string | null | undefined;
  assignmentStatus: string | null | undefined;
  shipmentStatus: string | null | undefined;
}): boolean {
  const ship = String(shipmentStatus ?? "");
  if (JOB_LOCKED.includes(ship)) return true;
  if (loadNumber != null && loadNumber !== "" && assignmentStatus != null) {
    return LOAD_LOCKED.includes(String(assignmentStatus));
  }
  return FALLBACK_LOCKED.includes(ship);
}
