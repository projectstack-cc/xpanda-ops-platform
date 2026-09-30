// src/lib/logistics/address.ts
// Shared ship-to formatting. singleLineAddress moved verbatim from lib/carrier/rows.ts (lgx-minimap-01) --
// it's the exact string DestinationMiniMap uses for its Google Maps link, now used by both the Carrier
// View rows and the /v2/logistics drill-down (GET /v2/api/shipments/:id `dest`).

// Single-line ship-to incl. street2 (composeAddress-style, but tolerant of missing parts).
export function singleLineAddress(r: any): string | null {
  const streetLine = [r.ship_to_street, r.ship_to_street2].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ");
  const stateZip = [r.ship_to_state, r.ship_to_zip].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ");
  const cityLine = [String(r.ship_to_city ?? "").trim(), stateZip].filter(Boolean).join(", ");
  return [streetLine, cityLine].filter(Boolean).join(", ") || null;
}
