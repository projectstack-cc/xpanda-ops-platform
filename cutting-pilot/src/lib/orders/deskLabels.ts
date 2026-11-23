// src/lib/orders/deskLabels.ts — ord-dash-02
// The one rule → label map for the Orders desk (GET /v2/api/orders/desk, src/types/ordersDesk.ts).
// The needs-attention panel, the per-row badges and ord-dash-03's batch upload all read from here.
import type { AttentionRule } from "@/types/ordersDesk";
import { shipDayLabel } from "@/lib/logistics/toLoadSheet";

export interface RuleLabel {
  /** Panel group heading. */
  label: string;
  /** Compact badge text on a Recent row (the full label goes in aria-label/title). */
  short: string;
}

export const RULE_LABELS: Record<AttentionRule, RuleLabel> = {
  schedule_gap: { label: "On schedule, not entered", short: "Not entered" },
  no_ship_date: { label: "No ship date", short: "No date" },
  no_processes: { label: "No cutting lines", short: "No lines" },
  blank_dims: { label: "Blank dimensions", short: "Dims" },
  address_unverified: { label: "Address not verified", short: "Address" },
};

/** Panel group order (matches the scope: gaps first). */
export const RULE_ORDER: AttentionRule[] = [
  "schedule_gap",
  "no_ship_date",
  "no_processes",
  "blank_dims",
  "address_unverified",
];

const ADDRESS_DETAIL: Record<string, string> = {
  unverified: "Not checked",
  unverifiable: "Couldn't verify",
};

/** Human `detail` for an attention item: blank_dims shows "Lines 2, 5"; address shows its humanized
 *  state (a null stored value counts as "Not checked"); other rules show nothing. */
export function ruleDetail(rule: AttentionRule, detail: string | null): string | null {
  if (rule === "blank_dims") return detail;
  if (rule === "address_unverified") return ADDRESS_DETAIL[detail ?? "unverified"] ?? detail;
  return null;
}

/** "Mon 11/24", or "No date" for null / blank / malformed ship dates. */
export function deskShipDay(date: string | null | undefined): string {
  const d = (date ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? shipDayLabel(d) : "No date";
}

export const SOURCE_OPTIONS = [
  { value: "packing_slip", label: "Packing slip" },
  { value: "manual", label: "Manual" },
];
