// src/lib/money.ts
// Integer cents → "$1,234.50" (carrier-04 carrier_charges display, shared by the carrier view,
// the v2 logistics board, and the charges route's notification text).
export function formatUsdCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
