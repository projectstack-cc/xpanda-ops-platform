// src/lib/logistics/bolLookup.ts
// inv-resolve-02: the BOL → destination linkage, moved verbatim out of resolveLine() in
// app/api/logistics/invoice/route.ts so the invoice ingest and the Resolve modal's
// GET /v2/api/logistics/invoice/bol-lookup share ONE implementation and can never disagree.
// Per token: newest `bols` row with a ZIP (pickBest); if none / blank ZIP, fall back to `jobs`
// by invoice_number = bolBase(token) (the part before the first "-"), recording fallbackBase.
import type { D1Database } from "@cloudflare/workers-types";

export interface DestRow {
  key: string;
  ship_to_street: string;
  ship_to_city: string;
  ship_to_state: string;
  ship_to_zip: string;
  created_at: string | null;
  source: "bol" | "job";
}

export interface ResolvedDestination {
  row: DestRow;
  fallbackBase: string | null;
}

export function bolBase(token: string): string {
  const dash = token.indexOf("-");
  return dash > 0 ? token.slice(0, dash) : token;
}

export function pickBest(rows: DestRow[]): DestRow | null {
  const nonBlank = rows.filter((r) => (r.ship_to_zip ?? "").trim() !== "");
  const pool = nonBlank.length ? nonBlank : rows;
  if (!pool.length) return null;
  return [...pool].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
}

export async function lookupBolDestinations(
  DB: D1Database,
  tokens: string[]
): Promise<{ resolved: ResolvedDestination[]; bolTokensFound: Set<string> }> {
  if (tokens.length === 0) return { resolved: [], bolTokensFound: new Set() };

  const bolPlaceholders = tokens.map(() => "?").join(",");
  const bolFound = await DB.prepare(
    `SELECT bol_number AS key, ship_to_street, ship_to_city, ship_to_state, ship_to_zip, created_at
     FROM bols WHERE bol_number IN (${bolPlaceholders})`
  )
    .bind(...tokens)
    .all<{
      key: string;
      ship_to_street: string | null;
      ship_to_city: string | null;
      ship_to_state: string | null;
      ship_to_zip: string | null;
      created_at: string | null;
    }>();

  const bolRowsByKey = new Map<string, DestRow[]>();
  for (const row of bolFound.results ?? []) {
    const key = row.key ?? "";
    const rows = bolRowsByKey.get(key) ?? [];
    rows.push({
      key,
      ship_to_street: row.ship_to_street ?? "",
      ship_to_city: row.ship_to_city ?? "",
      ship_to_state: row.ship_to_state ?? "",
      ship_to_zip: row.ship_to_zip ?? "",
      created_at: row.created_at,
      source: "bol",
    });
    bolRowsByKey.set(key, rows);
  }

  const bolByToken = new Map<string, DestRow | null>();
  const unresolvedTokens: string[] = [];
  for (const token of tokens) {
    const best = pickBest(bolRowsByKey.get(token) ?? []);
    bolByToken.set(token, best);
    if (!best || (best.ship_to_zip ?? "").trim() === "") unresolvedTokens.push(token);
  }

  const bases = Array.from(new Set(unresolvedTokens.map((token) => bolBase(token))));
  const jobByBase = new Map<string, DestRow | null>();
  if (bases.length > 0) {
    const jobPlaceholders = bases.map(() => "?").join(",");
    const jobFound = await DB.prepare(
      `SELECT invoice_number AS key, ship_to_street, ship_to_city, ship_to_state, ship_to_zip, created_at
       FROM jobs WHERE invoice_number IN (${jobPlaceholders})`
    )
      .bind(...bases)
      .all<{
        key: string;
        ship_to_street: string | null;
        ship_to_city: string | null;
        ship_to_state: string | null;
        ship_to_zip: string | null;
        created_at: string | null;
      }>();

    const jobRowsByKey = new Map<string, DestRow[]>();
    for (const row of jobFound.results ?? []) {
      const key = row.key ?? "";
      const rows = jobRowsByKey.get(key) ?? [];
      rows.push({
        key,
        ship_to_street: row.ship_to_street ?? "",
        ship_to_city: row.ship_to_city ?? "",
        ship_to_state: row.ship_to_state ?? "",
        ship_to_zip: row.ship_to_zip ?? "",
        created_at: row.created_at,
        source: "job",
      });
      jobRowsByKey.set(key, rows);
    }

    for (const baseNumber of bases) {
      jobByBase.set(baseNumber, pickBest(jobRowsByKey.get(baseNumber) ?? []));
    }
  }

  const resolved: ResolvedDestination[] = [];
  for (const token of tokens) {
    const bolDest = bolByToken.get(token) ?? null;
    if (bolDest && (bolDest.ship_to_zip ?? "").trim() !== "") {
      resolved.push({ row: bolDest, fallbackBase: null });
      continue;
    }

    const baseNumber = bolBase(token);
    const jobDest = jobByBase.get(baseNumber) ?? null;
    if (jobDest && (jobDest.ship_to_zip ?? "").trim() !== "") {
      resolved.push({ row: jobDest, fallbackBase: baseNumber });
    }
  }

  return { resolved, bolTokensFound: new Set(bolRowsByKey.keys()) };
}
