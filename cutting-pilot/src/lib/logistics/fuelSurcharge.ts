// src/lib/logistics/fuelSurcharge.ts
// lgx-fuel-02: per-mile daily fuel surcharge — pure formula + BOL wording, no I/O. The ONE place the
// surcharge is computed and worded: the server (GET /v2/api/bols/fuel-surcharge?quote=) builds each
// BOL's line with buildFuelLine and both renderers (legacy logistics/bol-shared.js, v2 bolShared.ts)
// only draw the strings, so legacy and v2 can never disagree.
//
// Charge = rate × round-trip miles, round trip = 2 × the ORS one-way driving miles from the Orlando
// plant (geocode_cache, same figure as the dashboard's Distance / ETA column). Rates are stored as
// integer mills ($/mile × 1000). Wording per Steve: the BOL shows only the total —
// "Fuel Surcharge - $4.00". If a rate is set but mileage can't be resolved, it shows the rate
// instead ("Fuel Surcharge - $0.10/mi") so the carrier still gets it; never a guessed number.
// `detail` is kept on FuelLine (renderers draw it when non-null) but is always null today.

export const RATE_RE = /^(\d+(\.\d{0,3})?|\.\d{1,3})$/;

/** "$0.10" / "0.125" / ".1" -> mills (100 / 125 / 100). Strips "$" and ","; null when invalid or empty. */
export function dollarsToMills(input: string): number | null {
  const v = String(input ?? "").replace(/[$,]/g, "").trim();
  if (!v || !RATE_RE.test(v)) return null;
  return Math.round(Number(v) * 1000);
}

/** 100 -> "$0.10", 125 -> "$0.125" (2 decimals unless the 3rd digit is nonzero). */
export function formatRate(mills: number): string {
  const dollars = mills / 1000;
  return "$" + (mills % 10 === 0 ? dollars.toFixed(2) : dollars.toFixed(3));
}

export function roundTripMiles(oneWay: number): number {
  return Math.round(oneWay * 2);
}

export function surchargeCents(mills: number, rtMiles: number): number {
  return Math.round((mills * rtMiles) / 10);
}

export interface FuelLine {
  main: string;
  detail: string | null;
}

export function buildFuelLine(mills: number | null, oneWayMiles: number | null): FuelLine | null {
  if (mills == null) return null;
  if (oneWayMiles == null || !Number.isFinite(oneWayMiles)) {
    return { main: `Fuel Surcharge - ${formatRate(mills)}/mi`, detail: null };
  }
  const cents = surchargeCents(mills, roundTripMiles(oneWayMiles));
  return { main: `Fuel Surcharge - $${(cents / 100).toFixed(2)}`, detail: null };
}
