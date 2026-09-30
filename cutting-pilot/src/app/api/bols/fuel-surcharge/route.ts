// src/app/api/bols/fuel-surcharge/route.ts  ->  GET /v2/api/bols/fuel-surcharge?date=YYYY-MM-DD
//                                               GET /v2/api/bols/fuel-surcharge?quote=<URI-encoded JSON>
//                                               PUT /v2/api/bols/fuel-surcharge  { date, rate }
// lgx-fuel-02: one per-mile fuel surcharge RATE per calendar date (fuel_rates_per_mile, integer mills =
// $/mile × 1000). The BOL charge is rate × round-trip miles (2 × the ORS one-way driving miles from the
// plant, geocode_cache via routeCache.resolveDestRoute — the dashboard's Distance / ETA figure, ORS only
// on a cache miss with the existing negative-cache backoff). Computed LIVE at every BOL render from the
// BOL's own date + ship-to — never copied onto the bols row or render_overrides.
//   ?date  -> the dashboard control's single-date read.
//   ?quote -> array (max 20) of { date, ship_to_street, ship_to_city, ship_to_state, ship_to_zip }, one
//             per BOL record; returns { lines: (FuelLine|null)[] } in the same order/length, built by
//             lib/logistics/fuelSurcharge.ts buildFuelLine — the ONLY formula + wording source. Both
//             renderers (v2 bolDomGlue.ts and legacy logistics/bol-shared.js, same host + session
//             cookie) only draw these strings. Invalid items / dates with no rate -> null, never a 400.
// The static segment beats the sibling bols/[id]. Gate: middleware /v2/api/bols -> logistics.bol
// (GET -> view, PUT -> edit); PUT additionally requires logistics.dashboard edit (the dashboard control
// is where the rate is entered) and the write fence.
import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getEnv } from "@/lib/db";
import { V2_LOGISTICS_WRITES_ENABLED } from "@/lib/logistics/writeFence";
import { canEditDashboard } from "@/lib/logistics/dashboardPerms";
import { logActivity } from "@/lib/activityLog";
import { resolveOrigin, resolveDestRoute } from "@/lib/logistics/routeCache";
import { normalizeAddressKey } from "@/lib/logistics/freightInvoice";
import { buildFuelLine, dollarsToMills, formatRate, type FuelLine } from "@/lib/logistics/fuelSurcharge";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_QUOTE_ITEMS = 20;

async function readSingle(DB: any, date: string) {
  const row = await DB.prepare(
    "SELECT rate_mills, entered_by_name, updated_at FROM fuel_rates_per_mile WHERE rate_date = ?"
  ).bind(date).first();
  const mills = row ? Number(row.rate_mills) : null;
  return {
    ok: true,
    date,
    rate_mills: mills,
    rate_display: mills == null ? null : formatRate(mills),
    entered_by_name: row?.entered_by_name ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

interface QuoteItem {
  date: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

function parseQuoteItem(raw: any): QuoteItem | null {
  if (!raw || typeof raw !== "object") return null;
  const date = String(raw.date ?? "").trim().slice(0, 10);
  if (!DATE_RE.test(date)) return null;
  const str = (v: unknown) => String(v ?? "").trim();
  return {
    date,
    street: str(raw.ship_to_street),
    city: str(raw.ship_to_city),
    state: str(raw.ship_to_state),
    zip: str(raw.ship_to_zip),
  };
}

async function quote(DB: any, rawItems: any[]): Promise<(FuelLine | null)[]> {
  const items = rawItems.map(parseQuoteItem);

  // Batch the rate lookup for the distinct valid dates.
  const dates = Array.from(new Set(items.filter((i): i is QuoteItem => !!i).map((i) => i.date)));
  const rates: Record<string, number> = {};
  if (dates.length) {
    const res = await DB.prepare(
      `SELECT rate_date, rate_mills FROM fuel_rates_per_mile WHERE rate_date IN (${dates.map(() => "?").join(",")})`
    ).bind(...dates).all();
    for (const r of (res.results ?? []) as any[]) rates[r.rate_date] = Number(r.rate_mills);
  }

  // Resolve miles only for items whose date has a rate; each distinct address once. No zip or an
  // unresolvable address -> null miles (buildFuelLine then prints the rate, never a guess).
  const needMiles = items.filter((i): i is QuoteItem => !!i && rates[i.date] != null && !!i.zip);
  const milesByKey = new Map<string, number | null>();
  if (needMiles.length) {
    const { env } = await getCloudflareContext();
    const apiKey = (env as any).ORS_API_KEY ?? "";
    if (apiKey) {
      const origin = await resolveOrigin(DB, apiKey);
      // Sequential, not Promise.all -- same deliberate pattern as api/shipments/distances.
      for (const i of needMiles) {
        const key = normalizeAddressKey(i.street, i.city, i.state, i.zip);
        if (milesByKey.has(key)) continue;
        try {
          const { miles } = await resolveDestRoute(DB, origin, apiKey, i.street, i.city, i.state, i.zip);
          milesByKey.set(key, miles);
        } catch (e) {
          console.error("Fuel surcharge mileage lookup failed:", e);
          milesByKey.set(key, null);
        }
      }
    }
  }

  return items.map((i) => {
    if (!i) return null;
    const mills = rates[i.date];
    if (mills == null) return null;
    const oneWay = i.zip ? milesByKey.get(normalizeAddressKey(i.street, i.city, i.state, i.zip)) ?? null : null;
    return buildFuelLine(mills, oneWay);
  });
}

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const url = new URL(request.url);
  const single = url.searchParams.get("date");
  const quoteParam = url.searchParams.get("quote");

  try {
    if (quoteParam != null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(quoteParam);
      } catch {
        return NextResponse.json({ ok: false, error: "invalid_quote", detail: "quote must be a JSON array." }, { status: 400 });
      }
      if (!Array.isArray(parsed) || parsed.length > MAX_QUOTE_ITEMS) {
        return NextResponse.json(
          { ok: false, error: "invalid_quote", detail: `quote must be a JSON array of at most ${MAX_QUOTE_ITEMS} items.` },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true, lines: await quote(DB, parsed) });
    }

    if (single != null) {
      const date = single.trim();
      if (!DATE_RE.test(date)) {
        return NextResponse.json({ ok: false, error: "invalid_date", detail: `Got "${date}"` }, { status: 400 });
      }
      return NextResponse.json(await readSingle(DB, date));
    }

    return NextResponse.json({ ok: false, error: "Provide date or quote.", detail: "Missing query" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (!V2_LOGISTICS_WRITES_ENABLED) {
    return NextResponse.json(
      { ok: false, error: "v2 logistics writes disabled (read-only migration phase)" },
      { status: 501 }
    );
  }

  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const actorName = request.headers.get("X-User-Name") || null;

  if (!canEditDashboard(request)) {
    return NextResponse.json(
      { ok: false, error: "You do not have permission to set the fuel surcharge." },
      { status: 403 }
    );
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const date = String(payload?.date ?? "").trim();
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ ok: false, error: "invalid_date", detail: "date must be YYYY-MM-DD." }, { status: 400 });
  }

  const rawRate = payload?.rate == null ? "" : String(payload.rate).replace(/[$,]/g, "").trim();

  try {
    if (rawRate === "") {
      // Empty rate clears the rate for that date.
      await DB.prepare("DELETE FROM fuel_rates_per_mile WHERE rate_date = ?").bind(date).run();
      await logActivity(
        DB, "delete", "fuel_surcharge", date, `Cleared fuel surcharge for ${date}`,
        { date, rate_mills: null }, actorId
      );
      return NextResponse.json(await readSingle(DB, date));
    }

    const mills = dollarsToMills(rawRate);
    if (mills == null) {
      return NextResponse.json(
        { ok: false, error: "invalid_rate", detail: "Enter a rate like 0.10 or 0.125 dollars per mile." },
        { status: 400 }
      );
    }
    const now = new Date().toISOString();

    await DB.prepare(
      `INSERT INTO fuel_rates_per_mile (rate_date, rate_mills, entered_by, entered_by_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(rate_date) DO UPDATE SET
         rate_mills = excluded.rate_mills,
         entered_by = excluded.entered_by,
         entered_by_name = excluded.entered_by_name,
         updated_at = excluded.updated_at`
    ).bind(date, mills, actorId, actorName, now, now).run();

    await logActivity(
      DB, "update", "fuel_surcharge", date,
      `Set fuel surcharge for ${date} to ${formatRate(mills)}/mi`,
      { date, rate_mills: mills }, actorId
    );
    return NextResponse.json(await readSingle(DB, date));
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
