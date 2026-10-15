// src/app/api/logistics/invoice/route.ts  →  /v2/api/logistics/invoice
// Ingest + resolve + persist + return a parsed freight invoice (PXXX invoice-analytics -c).
// Gated admin-only by middleware's logistics.v2 rule. Addresses come only from `bols` — the
// invoice is never read for addresses, a BOL is never parsed here (that's -d's client-side PDF
// parse, which only extracts {lineNo, shipDate, loadNumber, poText, amount} rows).
import { NextResponse } from "next/server";
import type { D1Database } from "@cloudflare/workers-types";
import { getEnv } from "@/lib/db";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { extractBolTokens, normalizeAddressKey, composeAddress } from "@/lib/logistics/freightInvoice";
import { FACILITY_ORIGIN_ADDRESS, ORIGIN_CACHE_KEY } from "@/lib/logistics/origin";
import { geocode, drivingMiles, routePathMiles, type GeoPoint } from "@/lib/logistics/ors";
import { computeZipVariance, computeInversions, type FlagRow } from "@/lib/logistics/flags";
import { lookupBolDestinations, type DestRow } from "@/lib/logistics/bolLookup";
import { logActivity } from "@/lib/activityLog";

interface InLine {
  lineNo: number;
  shipDate?: string;
  loadNumber?: string;
  poText: string;
  amount: number;
}

interface InBody {
  vendor: string;
  invoiceNumber: string;
  invoiceDate?: string;
  lines: InLine[];
  confirm?: boolean;
}

interface ResolvedLine {
  lineNo: number;
  shipDate: string | null;
  loadNumber: string | null;
  poText: string;
  amount: number;
  bolNumbers: string[];
  bolNumber: string | null;
  matchStatus: "matched" | "unmatched" | "multi_destination";
  excludedFromStats: boolean;
  shipTo: { city: string; state: string; zip: string } | null;
  miles: number | null;
  pricePerMile: number | null;
  note: string | undefined;
}

function distinctZips(rows: DestRow[]): string[] {
  return Array.from(new Set(rows.map((r) => r.ship_to_zip).filter((zip) => (zip ?? "").trim() !== "")));
}

// Resolves one destination address's geocoded point, using geocode_cache. Returns null if
// geocoding is unavailable rather than crashing the invoice ingest.
async function resolveStopPoint(
  DB: D1Database,
  apiKey: string,
  street: string,
  city: string,
  state: string,
  zip: string
): Promise<GeoPoint | null> {
  const key = normalizeAddressKey(street, city, state, zip);
  const cached = await DB.prepare(
    "SELECT lat, lng, status FROM geocode_cache WHERE address_key = ?"
  )
    .bind(key)
    .first<{ lat: number | null; lng: number | null; status: string }>();

  if (cached && cached.status === "ok" && cached.lat != null && cached.lng != null) {
    return { lat: cached.lat, lng: cached.lng };
  }

  const address = composeAddress(street, city, state, zip);
  const point = await geocode(address, apiKey);
  const now = new Date().toISOString();
  await DB.prepare(
    `INSERT INTO geocode_cache (address_key, raw_address, lat, lng, miles_from_origin, ors_label, confidence, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
     ON CONFLICT(address_key) DO UPDATE SET
       raw_address = excluded.raw_address, lat = excluded.lat, lng = excluded.lng,
       ors_label = excluded.ors_label, confidence = excluded.confidence, status = excluded.status,
       updated_at = excluded.updated_at`
  )
    .bind(
      key,
      address,
      point?.lat ?? null,
      point?.lng ?? null,
      point?.label ?? null,
      point?.confidence ?? null,
      point ? "ok" : "geocode_failed",
      now,
      now
    )
    .run();

  return point;
}

// Ensures the fixed facility origin is geocoded + cached, returns its point or null if ORS is
// unavailable/misconfigured (callers then skip mileage resolution for this request entirely).
async function resolveOrigin(DB: D1Database, apiKey: string): Promise<GeoPoint | null> {
  const cached = await DB.prepare(
    "SELECT lat, lng, status FROM geocode_cache WHERE address_key = ?"
  )
    .bind(ORIGIN_CACHE_KEY)
    .first<{ lat: number | null; lng: number | null; status: string }>();

  if (cached && cached.status === "ok" && cached.lat != null && cached.lng != null) {
    return { lat: cached.lat, lng: cached.lng };
  }

  const point = await geocode(FACILITY_ORIGIN_ADDRESS, apiKey);
  const now = new Date().toISOString();
  await DB.prepare(
    `INSERT INTO geocode_cache (address_key, raw_address, lat, lng, miles_from_origin, ors_label, confidence, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
     ON CONFLICT(address_key) DO UPDATE SET
       raw_address = excluded.raw_address, lat = excluded.lat, lng = excluded.lng,
       ors_label = excluded.ors_label, confidence = excluded.confidence, status = excluded.status,
       updated_at = excluded.updated_at`
  )
    .bind(
      ORIGIN_CACHE_KEY,
      FACILITY_ORIGIN_ADDRESS,
      point?.lat ?? null,
      point?.lng ?? null,
      point?.label ?? null,
      point?.confidence ?? null,
      point ? "ok" : "geocode_failed",
      now,
      now
    )
    .run();

  return point;
}

// Resolves one destination address's one-way driving miles from the facility origin, using
// geocode_cache. Returns null if geocoding/routing is unavailable — caller treats the line as
// unmatched (BOL found, mileage temporarily unavailable) rather than crashing.
async function resolveMiles(
  DB: D1Database,
  origin: GeoPoint | null,
  apiKey: string,
  street: string,
  city: string,
  state: string,
  zip: string
): Promise<number | null> {
  const key = normalizeAddressKey(street, city, state, zip);
  const cached = await DB.prepare(
    "SELECT miles_from_origin, status FROM geocode_cache WHERE address_key = ?"
  )
    .bind(key)
    .first<{ miles_from_origin: number | null; status: string }>();

  if (cached && cached.status === "ok" && cached.miles_from_origin != null) {
    return cached.miles_from_origin;
  }

  if (!origin) return null;

  const address = composeAddress(street, city, state, zip);
  const dest = await geocode(address, apiKey);
  let miles: number | null = null;
  let status = "geocode_failed";
  if (dest) {
    miles = await drivingMiles(origin, dest, apiKey);
    status = miles != null ? "ok" : "route_failed";
  }

  const now = new Date().toISOString();
  await DB.prepare(
    `INSERT INTO geocode_cache (address_key, raw_address, lat, lng, miles_from_origin, ors_label, confidence, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(address_key) DO UPDATE SET
       raw_address = excluded.raw_address, lat = excluded.lat, lng = excluded.lng,
       miles_from_origin = excluded.miles_from_origin, ors_label = excluded.ors_label,
       confidence = excluded.confidence, status = excluded.status, updated_at = excluded.updated_at`
  )
    .bind(
      key,
      address,
      dest?.lat ?? null,
      dest?.lng ?? null,
      miles,
      dest?.label ?? null,
      dest?.confidence ?? null,
      status,
      now,
      now
    )
    .run();

  return miles;
}

async function resolveLine(
  DB: D1Database,
  origin: GeoPoint | null,
  apiKey: string,
  line: InLine
): Promise<ResolvedLine> {
  const base = {
    lineNo: line.lineNo,
    shipDate: line.shipDate ?? null,
    loadNumber: line.loadNumber ?? null,
    poText: line.poText ?? "",
    amount: Number(line.amount) || 0,
  };

  const tokens = extractBolTokens(line.poText ?? "");
  if (tokens.length === 0) {
    return {
      ...base,
      bolNumbers: [],
      bolNumber: null,
      matchStatus: "unmatched",
      excludedFromStats: true,
      shipTo: null,
      miles: null,
      pricePerMile: null,
      note: "No BOL number found in PO text.",
    };
  }

  const { resolved, bolTokensFound } = await lookupBolDestinations(DB, tokens);

  if (resolved.length === 0) {
    return {
      ...base,
      bolNumbers: tokens,
      bolNumber: tokens[0],
      matchStatus: "unmatched",
      excludedFromStats: true,
      shipTo: null,
      miles: null,
      pricePerMile: null,
      note: "No matching BOL or order INV# on file.",
    };
  }

  const resolvedRows = resolved.map((item) => item.row);
  const zips = distinctZips(resolvedRows);
  const missing = tokens.filter((token) => !bolTokensFound.has(token));
  const fallbackBases = Array.from(
    new Set(resolved.filter((item) => item.fallbackBase !== null).map((item) => item.fallbackBase as string))
  );
  const fallbackNote = fallbackBases.length > 0 ? `address via order INV# ${fallbackBases.join(", ")}.` : "";

  if (zips.length === 1) {
    const chosen = resolved[0];
    const dest = chosen.row;
    const miles = await resolveMiles(
      DB,
      origin,
      apiKey,
      dest.ship_to_street,
      dest.ship_to_city,
      dest.ship_to_state,
      dest.ship_to_zip
    );

    const shipTo = {
      city: dest.ship_to_city ?? "",
      state: dest.ship_to_state ?? "",
      zip: dest.ship_to_zip ?? "",
    };

    if (miles == null || miles <= 0) {
      const note = [
        missing.length > 0
          ? `BOL matched (${missing.length} of ${tokens.length} tokens not found); mileage temporarily unavailable.`
          : "BOL matched; mileage temporarily unavailable.",
        chosen.fallbackBase ? `address via order INV# ${chosen.fallbackBase}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return {
        ...base,
        bolNumbers: tokens,
        bolNumber: tokens[0],
        matchStatus: "unmatched",
        excludedFromStats: true,
        shipTo,
        miles: null,
        pricePerMile: null,
        note,
      };
    }

    const bolNote =
      missing.length > 0 ? `${missing.length} of ${tokens.length} BOL tokens not found on file.` : "";
    const note = [bolNote, fallbackNote].filter(Boolean).join(" ") || undefined;
    return {
      ...base,
      bolNumbers: tokens,
      bolNumber: tokens[0],
      matchStatus: "matched",
      excludedFromStats: false,
      shipTo,
      miles,
      pricePerMile: base.amount / miles,
      note,
    };
  }

  const stops: DestRow[] = [];
  const stopZips: string[] = [];
  const seenZips = new Set<string>();
  for (const item of resolved) {
    const zip = item.row.ship_to_zip ?? "";
    if (seenZips.has(zip)) continue;
    seenZips.add(zip);
    stops.push(item.row);
    stopZips.push(zip);
  }

  const pathKey = `PATH:${stopZips.join(">")}`;
  const cachedPath = await DB.prepare(
    "SELECT miles_from_origin, status FROM geocode_cache WHERE address_key = ?"
  )
    .bind(pathKey)
    .first<{ miles_from_origin: number | null; status: string }>();

  let pathMiles: number | null =
    cachedPath && cachedPath.status === "ok" && cachedPath.miles_from_origin != null
      ? cachedPath.miles_from_origin
      : null;

  if (pathMiles == null && origin) {
    const stopPoints: GeoPoint[] = [];
    let canRoute = true;
    for (const stop of stops) {
      const point = await resolveStopPoint(
        DB,
        apiKey,
        stop.ship_to_street,
        stop.ship_to_city,
        stop.ship_to_state,
        stop.ship_to_zip
      );
      if (!point) {
        canRoute = false;
        break;
      }
      stopPoints.push(point);
    }

    if (canRoute) {
      const routedMiles = await routePathMiles([origin, ...stopPoints], apiKey);
      if (routedMiles != null && routedMiles > 0) {
        pathMiles = routedMiles;
        const now = new Date().toISOString();
        await DB.prepare(
          `INSERT INTO geocode_cache (address_key, raw_address, lat, lng, miles_from_origin, ors_label, confidence, status, created_at, updated_at)
           VALUES (?, ?, NULL, NULL, ?, NULL, NULL, ?, ?, ?)
           ON CONFLICT(address_key) DO UPDATE SET
             raw_address = excluded.raw_address, miles_from_origin = excluded.miles_from_origin,
             status = excluded.status, updated_at = excluded.updated_at`
        )
          .bind(pathKey, `PATH: ${stopZips.join(" -> ")}`, pathMiles, "ok", now, now)
          .run();
      }
    }
  }

  const finalStop = stops[stops.length - 1];
  const shipTo = {
    city: finalStop.ship_to_city ?? "",
    state: finalStop.ship_to_state ?? "",
    zip: finalStop.ship_to_zip ?? "",
  };
  const routeNote = `${stops.length}-stop path: ${stopZips.join(" → ")}; ${pathMiles?.toFixed(1) ?? "0.0"} mi`;
  const note = [routeNote, fallbackNote].filter(Boolean).join(" ") || undefined;

  if (pathMiles == null || pathMiles <= 0) {
    return {
      ...base,
      bolNumbers: tokens,
      bolNumber: tokens[0],
      matchStatus: "multi_destination",
      excludedFromStats: true,
      shipTo,
      miles: null,
      pricePerMile: null,
      note: ["multi-stop; routing temporarily unavailable", fallbackNote].filter(Boolean).join(" "),
    };
  }

  return {
    ...base,
    bolNumbers: tokens,
    bolNumber: tokens[0],
    matchStatus: "multi_destination",
    excludedFromStats: false,
    shipTo,
    miles: pathMiles,
    pricePerMile: base.amount / pathMiles,
    note,
  };
}

async function persistLine(DB: D1Database, invoice: InBody, r: ResolvedLine): Promise<void> {
  await DB.prepare(
    `INSERT INTO freight_invoice_lines (
       id, vendor, invoice_number, invoice_date, line_no, ship_date, load_number, po_text,
       bol_number, bol_numbers, amount, ship_to_zip, ship_to_city, ship_to_state, miles,
       price_per_mile, match_status, excluded_from_stats, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(invoice_number, line_no) DO UPDATE SET
       vendor = excluded.vendor, invoice_date = excluded.invoice_date, ship_date = excluded.ship_date,
       load_number = excluded.load_number, po_text = excluded.po_text, bol_number = excluded.bol_number,
       bol_numbers = excluded.bol_numbers, amount = excluded.amount, ship_to_zip = excluded.ship_to_zip,
       ship_to_city = excluded.ship_to_city, ship_to_state = excluded.ship_to_state, miles = excluded.miles,
       price_per_mile = excluded.price_per_mile, match_status = excluded.match_status,
       excluded_from_stats = excluded.excluded_from_stats`
  )
    .bind(
      crypto.randomUUID(),
      invoice.vendor ?? "",
      invoice.invoiceNumber,
      invoice.invoiceDate ?? null,
      r.lineNo,
      r.shipDate,
      r.loadNumber,
      r.poText,
      r.bolNumber,
      JSON.stringify(r.bolNumbers),
      r.amount,
      r.shipTo?.zip ?? null,
      r.shipTo?.city ?? null,
      r.shipTo?.state ?? null,
      r.miles,
      r.pricePerMile,
      r.matchStatus,
      r.excludedFromStats ? 1 : 0,
      new Date().toISOString()
    )
    .run();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as InBody;
    if (!body?.invoiceNumber || !Array.isArray(body.lines)) {
      return NextResponse.json({ ok: false, error: "Missing invoiceNumber or lines." }, { status: 400 });
    }

    const { DB } = await getEnv();

    if (body.confirm !== true) {
      const dup = await DB.prepare(
        `SELECT COUNT(*) AS n, SUM(amount) AS total, MAX(created_at) AS last_at,
                MIN(invoice_date) AS invoice_date, MIN(vendor) AS vendor
         FROM freight_invoice_lines WHERE invoice_number = ?`
      )
        .bind(body.invoiceNumber)
        .first<{ n: number; total: number | null; last_at: string | null; invoice_date: string | null; vendor: string | null }>();

      if (dup && dup.n > 0) {
        return NextResponse.json({
          ok: true,
          duplicate: {
            invoiceNumber: body.invoiceNumber,
            vendor: dup.vendor,
            invoiceDate: dup.invoice_date,
            existingLineCount: dup.n,
            existingTotalAmount: dup.total,
            existingIngestedAt: dup.last_at,
            incomingLineCount: body.lines.length,
          },
        });
      }
    }

    const { env } = await getCloudflareContext();
    const apiKey = (env as any).ORS_API_KEY ?? "";

    const needsMileage = body.lines.length > 0;
    const origin = needsMileage ? await resolveOrigin(DB, apiKey) : null;

    const resolved: ResolvedLine[] = [];
    for (const line of body.lines) {
      resolved.push(await resolveLine(DB, origin, apiKey, line));
    }

    if (body.confirm === true) {
      // inv-dup-02: snapshot stored matched lines before the delete so a Replace keeps resolutions the
      // fresh ingest can't reproduce (e.g. fixed by hand via resolve-line). Keyed by carrier load #
      // (stable per shipment), falling back to line # when there is no load #.
      const snapshot = await DB.prepare(
        `SELECT line_no, load_number, bol_number, bol_numbers, ship_to_city, ship_to_state, ship_to_zip, miles, match_status
         FROM freight_invoice_lines
         WHERE invoice_number = ? AND match_status IN ('matched', 'multi_destination') AND excluded_from_stats = 0 AND miles IS NOT NULL AND miles > 0`
      )
        .bind(body.invoiceNumber)
        .all<{
          line_no: number;
          load_number: string | null;
          bol_number: string | null;
          bol_numbers: string | null;
          ship_to_city: string | null;
          ship_to_state: string | null;
          ship_to_zip: string | null;
          miles: number;
          match_status: "matched" | "multi_destination";
        }>();
      const countRow = await DB.prepare(`SELECT COUNT(*) AS n FROM freight_invoice_lines WHERE invoice_number = ?`)
        .bind(body.invoiceNumber)
        .first<{ n: number }>();
      const deletedLineCount = countRow?.n ?? 0;

      const keyOf = (loadNumber: string | null | undefined, lineNo: number) =>
        loadNumber && loadNumber.trim() !== "" ? `load:${loadNumber.trim()}` : `line:${lineNo}`;
      const prior = new Map<string, (typeof snapshot.results)[number]>();
      for (const row of snapshot.results ?? []) prior.set(keyOf(row.load_number, row.line_no), row);

      // Fresh auto-resolutions (matched or multi_destination) always win; a stored manual resolution
      // (single or multi-stop, inv-resolve-01) is restored only when the fresh ingest is unmatched.
      const carried: number[] = [];
      for (const r of resolved) {
        if (r.matchStatus !== "unmatched") continue;
        const hit = prior.get(keyOf(r.loadNumber, r.lineNo));
        if (!hit) continue;
        let bolNumbers: string[];
        try {
          bolNumbers = JSON.parse(hit.bol_numbers ?? "");
          if (!Array.isArray(bolNumbers)) throw new Error("not an array");
        } catch {
          bolNumbers = hit.bol_number ? [hit.bol_number] : [];
        }
        r.bolNumber = hit.bol_number;
        r.bolNumbers = bolNumbers;
        r.shipTo = { city: hit.ship_to_city ?? "", state: hit.ship_to_state ?? "", zip: hit.ship_to_zip ?? "" };
        r.miles = hit.miles;
        r.pricePerMile = r.amount / hit.miles;
        r.matchStatus = hit.match_status;
        r.excludedFromStats = false;
        r.note = "Kept manual resolution from previous ingest.";
        carried.push(r.lineNo);
      }

      await DB.prepare(`DELETE FROM freight_invoice_lines WHERE invoice_number = ?`).bind(body.invoiceNumber).run();

      await logActivity(
        DB,
        "replace",
        "freight_invoice",
        body.invoiceNumber,
        `Replaced invoice ${body.invoiceNumber} — ${deletedLineCount} stored line(s) → ${resolved.length} incoming; kept ${carried.length} manual resolution(s)`,
        {
          vendor: body.vendor ?? "",
          deletedLineCount,
          incomingLineCount: resolved.length,
          carriedForwardLineNos: carried,
        },
        req.headers.get("X-User-Id") || null
      );
    }

    for (const r of resolved) {
      await persistLine(DB, body, r);
    }

    const matchedCount = resolved.filter((r) => r.matchStatus === "matched").length;
    const unmatchedCount = resolved.filter((r) => r.matchStatus === "unmatched").length;
    const multiDestCount = resolved.filter((r) => r.matchStatus === "multi_destination").length;
    const totalAmount = resolved.reduce((s, r) => s + r.amount, 0);
    const matchedRows = resolved.filter((r) => r.matchStatus === "matched" && r.miles != null);
    const avgMiles = matchedRows.length
      ? matchedRows.reduce((s, r) => s + (r.miles ?? 0), 0) / matchedRows.length
      : 0;
    const avgPrice = matchedRows.length ? matchedRows.reduce((s, r) => s + r.amount, 0) / matchedRows.length : 0;
    const avgPricePerMile = matchedRows.length
      ? matchedRows.reduce((s, r) => s + (r.pricePerMile ?? 0), 0) / matchedRows.length
      : 0;

    const flagRows = await DB.prepare(
      `SELECT ship_to_zip, ship_to_city, amount, miles FROM freight_invoice_lines
       WHERE match_status = 'matched' AND ship_to_zip IS NOT NULL AND miles IS NOT NULL`
    ).all<{ ship_to_zip: string; ship_to_city: string; amount: number; miles: number }>();
    const historyRows: FlagRow[] = (flagRows.results ?? []).map((r) => ({
      zip: r.ship_to_zip,
      city: r.ship_to_city,
      amount: r.amount,
      miles: r.miles,
    }));

    return NextResponse.json({
      ok: true,
      invoice: { vendor: body.vendor ?? "", invoiceNumber: body.invoiceNumber, invoiceDate: body.invoiceDate ?? null },
      summary: {
        lineCount: resolved.length,
        matchedCount,
        unmatchedCount,
        multiDestCount,
        totalAmount,
        avgMiles,
        avgPrice,
        avgPricePerMile,
      },
      lines: resolved.map((r) => ({
        lineNo: r.lineNo,
        shipDate: r.shipDate,
        loadNumber: r.loadNumber,
        poText: r.poText,
        bolNumbers: r.bolNumbers,
        matchStatus: r.matchStatus,
        shipTo: r.shipTo,
        miles: r.miles,
        amount: r.amount,
        pricePerMile: r.pricePerMile,
        excludedFromStats: r.excludedFromStats,
        note: r.note ?? null,
      })),
      flags: {
        zipVariance: computeZipVariance(historyRows),
        inversions: computeInversions(historyRows),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const { DB } = await getEnv();
    const rows = await DB.prepare(
      `SELECT vendor, invoice_number, invoice_date, COUNT(*) AS line_count, SUM(amount) AS total_amount,
              MIN(created_at) AS created_at
       FROM freight_invoice_lines
       GROUP BY invoice_number
       ORDER BY MIN(created_at) DESC`
    ).all<{
      vendor: string;
      invoice_number: string;
      invoice_date: string | null;
      line_count: number;
      total_amount: number;
      created_at: string;
    }>();

    const invoices = (rows.results ?? []).map((r) => ({
      vendor: r.vendor,
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date,
      lineCount: r.line_count,
      totalAmount: r.total_amount,
      createdAt: r.created_at,
    }));

    return NextResponse.json({ ok: true, invoices });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
