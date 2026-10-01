// src/lib/qb/parts.ts
// qb-01: server-side parts library load for the QuickBooks mapper. Mirrors legacy GET /api/parts
// ordering exactly — matchLineItemToPart takes the first hit, so match order matters.
import type { D1Database } from "@cloudflare/workers-types";
import type { Part } from "@/lib/partMatch";

export async function loadPartsServer(db: D1Database): Promise<Part[]> {
  const rows = await db.prepare(
    `SELECT * FROM parts ORDER BY category ASC, sort_order ASC, part_number ASC`
  ).all<Part>();
  return (rows.results ?? []) as Part[];
}
