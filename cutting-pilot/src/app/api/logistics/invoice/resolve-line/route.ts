// src/app/api/logistics/invoice/resolve-line/route.ts  →  /v2/api/logistics/invoice/resolve-line
// Manual override for a line that couldn't auto-resolve (no BOL/order match, or mileage
// unavailable) — the Upload results view's "Resolve unmatched" popup posts a hand-entered
// BOL # + street address per stop here. Bypasses the bols/jobs lookup in ../route.ts entirely:
// this is a human attesting to the destination, not a match against stored data. One stop →
// stored `matched` (unchanged path). 2–6 stops (inv-resolve-01) → routed origin → stops in entry
// order and stored exactly like an auto-resolved multi-stop line (`multi_destination`, kept in
// the resolved count but out of the per-mile averages/flags, which filter on `matched`).
import { NextResponse } from "next/server";
import type { D1Database } from "@cloudflare/workers-types";
import { getEnv } from "@/lib/db";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { normalizeAddressKey, composeAddress } from "@/lib/logistics/freightInvoice";
import { FACILITY_ORIGIN_ADDRESS, ORIGIN_CACHE_KEY } from "@/lib/logistics/origin";
import { geocode, drivingMiles, routePathMiles, type GeoPoint } from "@/lib/logistics/ors";
import { computeZipVariance, computeInversions, type FlagRow } from "@/lib/logistics/flags";
import { logActivity } from "@/lib/activityLog";

type MatchStatus = "matched" | "unmatched" | "multi_destination";

interface InBody {
  invoiceNumber: string;
  lineNo: number;
  bolNumber: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  stops?: StopIn[];
}

interface StopIn {
  bolNumber: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

const MAX_STOPS = 6;

interface LineRow {
  invoice_number: string;
  invoice_date: string | null;
  vendor: string;
  line_no: number;
  ship_date: string | null;
  load_number: string | null;
  po_text: string;
  bol_number: string | null;
  bol_numbers: string | null;
  amount: number;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  miles: number | null;
  price_per_mile: number | null;
  match_status: MatchStatus;
  excluded_from_stats: number;
}

// Duplicated from ../route.ts rather than imported (same tradeoff month/route.ts already made
// for its own summary recompute) — keeps this route's only failure mode self-contained and
// never risks the live invoice-ingest path.
async function resolveOrigin(DB: D1Database, apiKey: string): Promise<GeoPoint | null> {
  const cached = await DB.prepare("SELECT lat, lng, status FROM geocode_cache WHERE address_key = ?")
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
  const cached = await DB.prepare("SELECT miles_from_origin, status FROM geocode_cache WHERE address_key = ?")
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

// Copied from ../route.ts (see the note above resolveOrigin) — geocodes one stop for the
// multi-stop path, caching the per-address point; null if geocoding is unavailable.
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

const MILEAGE_ERROR =
  "Could not calculate mileage for that address — check it's a valid US street address, or the mapping service may be temporarily unavailable.";

function bolNumbersFor(row: LineRow): string[] {
  if (row.bol_numbers) {
    try {
      const parsed = JSON.parse(row.bol_numbers);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through to bol_number
    }
  }
  return row.bol_number ? [row.bol_number] : [];
}

function noteFor(status: MatchStatus): string | null {
  if (status === "unmatched") return "No matching BOL on file.";
  if (status === "multi_destination") return "Multiple destinations on this line.";
  return null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<InBody>;
    const invoiceNumber = (body.invoiceNumber ?? "").trim();
    const lineNo = Number(body.lineNo);

    if (!invoiceNumber || !Number.isFinite(lineNo)) {
      return NextResponse.json({ ok: false, error: "Missing invoiceNumber or lineNo." }, { status: 400 });
    }

    // `stops` is optional (inv-resolve-01); absent/empty → one stop from the flat fields, so older
    // clients keep working.
    const rawStops: Partial<StopIn>[] =
      Array.isArray(body.stops) && body.stops.length > 0 ? body.stops : [body];
    if (rawStops.length > MAX_STOPS) {
      return NextResponse.json({ ok: false, error: `Too many stops (max ${MAX_STOPS}).` }, { status: 400 });
    }
    const stops: StopIn[] = rawStops.map((st) => ({
      bolNumber: (st?.bolNumber ?? "").trim(),
      street: (st?.street ?? "").trim(),
      city: (st?.city ?? "").trim(),
      state: (st?.state ?? "").trim(),
      zip: (st?.zip ?? "").trim(),
    }));
    for (let i = 0; i < stops.length; i++) {
      const prefix = stops.length > 1 ? `Stop ${i + 1}: ` : "";
      if (!stops[i].bolNumber) {
        return NextResponse.json({ ok: false, error: `${prefix}BOL # is required.` }, { status: 400 });
      }
      if (!stops[i].city || !stops[i].state || !stops[i].zip) {
        return NextResponse.json({ ok: false, error: `${prefix}City, state, and ZIP are required.` }, { status: 400 });
      }
    }

    const { DB } = await getEnv();

    const existing = await DB.prepare(
      `SELECT amount FROM freight_invoice_lines WHERE invoice_number = ? AND line_no = ?`
    )
      .bind(invoiceNumber, lineNo)
      .first<{ amount: number }>();
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Line not found — re-upload the invoice, then try again." },
        { status: 404 }
      );
    }

    const { env } = await getCloudflareContext();
    const apiKey = (env as any).ORS_API_KEY ?? "";

    const origin = await resolveOrigin(DB, apiKey);
    const actorId = req.headers.get("X-User-Id") || null;

    if (stops.length === 1) {
      const { bolNumber, street, city, state, zip } = stops[0];
      const miles = await resolveMiles(DB, origin, apiKey, street, city, state, zip);
      if (miles == null || miles <= 0) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Could not calculate mileage for that address — check it's a valid US street address, or the mapping service may be temporarily unavailable.",
          },
          { status: 422 }
        );
      }

      const updateResult = await DB.prepare(
        `UPDATE freight_invoice_lines
         SET bol_number = ?, bol_numbers = ?, ship_to_zip = ?, ship_to_city = ?, ship_to_state = ?,
             miles = ?, price_per_mile = ?, match_status = 'matched', excluded_from_stats = 0
         WHERE invoice_number = ? AND line_no = ?`
      )
        .bind(bolNumber, JSON.stringify([bolNumber]), zip, city, state, miles, existing.amount / miles, invoiceNumber, lineNo)
        .run();

      // Guards a race where the line was deleted/renumbered (e.g. a Replace re-upload) between the
      // existence check above and this write — without this, a 0-row UPDATE would still return a
      // 200 with a "successful" recomputed result that silently doesn't include the fix.
      if ((updateResult.meta?.changes ?? 0) !== 1) {
        return NextResponse.json(
          { ok: false, error: "Line not found — it may have changed since this page loaded. Re-upload the invoice and try again." },
          { status: 404 }
        );
      }

      await logActivity(
        DB,
        "update",
        "freight_invoice_line",
        `${invoiceNumber}:${lineNo}`,
        `Manually resolved invoice line — BOL ${bolNumber}, ${city}, ${state} ${zip}`,
        { invoiceNumber, lineNo, bolNumber, street, city, state, zip, miles },
        actorId
      );
    } else {
      // Multi-stop (inv-resolve-01): same row shape the auto-resolver writes for a multi-destination
      // line. Stops are routed in the order entered; no PATH: cache row (one-off human entries),
      // per-address geocodes are still cached by resolveStopPoint.
      if (!origin) {
        return NextResponse.json({ ok: false, error: MILEAGE_ERROR }, { status: 422 });
      }
      const points: GeoPoint[] = [];
      for (let i = 0; i < stops.length; i++) {
        const st = stops[i];
        const point = await resolveStopPoint(DB, apiKey, st.street, st.city, st.state, st.zip);
        if (!point) {
          return NextResponse.json(
            {
              ok: false,
              error: `Could not locate stop ${i + 1} — check it's a valid US street address, or the mapping service may be temporarily unavailable.`,
            },
            { status: 422 }
          );
        }
        points.push(point);
      }
      const miles = await routePathMiles([origin, ...points], apiKey);
      if (miles == null || miles <= 0) {
        return NextResponse.json({ ok: false, error: MILEAGE_ERROR }, { status: 422 });
      }

      const bols = stops.map((st) => st.bolNumber);
      const last = stops[stops.length - 1];
      const updateResult = await DB.prepare(
        `UPDATE freight_invoice_lines
         SET bol_number = ?, bol_numbers = ?, ship_to_zip = ?, ship_to_city = ?, ship_to_state = ?,
             miles = ?, price_per_mile = ?, match_status = 'multi_destination', excluded_from_stats = 0
         WHERE invoice_number = ? AND line_no = ?`
      )
        .bind(bols[0], JSON.stringify(bols), last.zip, last.city, last.state, miles, existing.amount / miles, invoiceNumber, lineNo)
        .run();

      // Same race guard as the single-stop path.
      if ((updateResult.meta?.changes ?? 0) !== 1) {
        return NextResponse.json(
          { ok: false, error: "Line not found — it may have changed since this page loaded. Re-upload the invoice and try again." },
          { status: 404 }
        );
      }

      await logActivity(
        DB,
        "update",
        "freight_invoice_line",
        `${invoiceNumber}:${lineNo}`,
        `Manually resolved multi-stop invoice line — ${stops.length} stops, BOLs ${bols.join(", ")}`,
        { invoiceNumber, lineNo, stops, miles },
        actorId
      );
    }

    const lineRows = await DB.prepare(
      `SELECT invoice_number, invoice_date, vendor, line_no, ship_date, load_number, po_text,
              bol_number, bol_numbers, amount, ship_to_city, ship_to_state, ship_to_zip, miles,
              price_per_mile, match_status, excluded_from_stats
       FROM freight_invoice_lines
       WHERE invoice_number = ?
       ORDER BY line_no ASC`
    )
      .bind(invoiceNumber)
      .all<LineRow>();
    const rows = lineRows.results ?? [];

    const lines = rows.map((r) => ({
      lineNo: r.line_no,
      shipDate: r.ship_date,
      loadNumber: r.load_number,
      poText: r.po_text,
      bolNumbers: bolNumbersFor(r),
      matchStatus: r.match_status,
      shipTo: r.ship_to_zip ? { city: r.ship_to_city ?? "", state: r.ship_to_state ?? "", zip: r.ship_to_zip } : null,
      miles: r.miles,
      amount: r.amount,
      pricePerMile: r.price_per_mile,
      excludedFromStats: r.excluded_from_stats === 1,
      note: noteFor(r.match_status),
    }));

    const matchedCount = rows.filter((r) => r.match_status === "matched").length;
    const unmatchedCount = rows.filter((r) => r.match_status === "unmatched").length;
    const multiDestCount = rows.filter((r) => r.match_status === "multi_destination").length;
    const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
    const matchedRows = rows.filter((r) => r.match_status === "matched" && r.miles != null);
    const avgMiles = matchedRows.length ? matchedRows.reduce((s, r) => s + (r.miles ?? 0), 0) / matchedRows.length : 0;
    const avgPrice = matchedRows.length ? matchedRows.reduce((s, r) => s + r.amount, 0) / matchedRows.length : 0;
    const avgPricePerMile = matchedRows.length
      ? matchedRows.reduce((s, r) => s + (r.price_per_mile ?? 0), 0) / matchedRows.length
      : 0;

    // Cross-invoice flags, same unscoped query POST /invoice uses — same-ZIP variance history
    // isn't limited to this one invoice.
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

    const first = rows[0];
    return NextResponse.json({
      ok: true,
      invoice: {
        vendor: first?.vendor ?? "",
        invoiceNumber,
        invoiceDate: first?.invoice_date ?? null,
      },
      summary: {
        lineCount: rows.length,
        matchedCount,
        unmatchedCount,
        multiDestCount,
        totalAmount,
        avgMiles,
        avgPrice,
        avgPricePerMile,
      },
      lines,
      flags: {
        zipVariance: computeZipVariance(historyRows),
        inversions: computeInversions(historyRows),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
