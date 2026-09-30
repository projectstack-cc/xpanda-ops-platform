// src/app/api/bols/fuel-surcharge/route.ts  ->  GET /v2/api/bols/fuel-surcharge?dates=a,b,… | ?date=YYYY-MM-DD
//                                               PUT /v2/api/bols/fuel-surcharge  { date, amount }
// lgx-fuel-01: one flat fuel surcharge per calendar date (fuel_surcharge_rates). Looked up LIVE at
// BOL render time by the BOL's own `date` — never copied onto the bols row or render_overrides.
// The static segment beats the sibling bols/[id]. Gate: middleware /v2/api/bols -> logistics.bol
// (GET -> view, PUT -> edit); PUT additionally requires logistics.dashboard edit (the dashboard
// control is where the rate is entered). Legacy's read twin: _worker.js/routes/bols.js
// handleApiBolFuelSurcharge (same `dates` parsing + cap).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { V2_LOGISTICS_WRITES_ENABLED } from "@/lib/logistics/writeFence";
import { canEditDashboard } from "@/lib/logistics/dashboardPerms";
import { logActivity } from "@/lib/activityLog";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_RE = /^(\d+(\.\d{0,2})?|\.\d{1,2})$/; // same as api/carrier/charges/route.ts
const MAX_DATES = 31;

async function readSingle(DB: any, date: string) {
  const row = await DB.prepare(
    "SELECT amount_cents, entered_by_name, updated_at FROM fuel_surcharge_rates WHERE rate_date = ?"
  ).bind(date).first();
  return {
    ok: true,
    date,
    amount_cents: row ? Number(row.amount_cents) : null,
    entered_by_name: row?.entered_by_name ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const url = new URL(request.url);
  const single = url.searchParams.get("date");

  try {
    if (single != null) {
      const date = single.trim();
      if (!DATE_RE.test(date)) {
        return NextResponse.json({ ok: false, error: "invalid_date", detail: `Got "${date}"` }, { status: 400 });
      }
      return NextResponse.json(await readSingle(DB, date));
    }

    const dates = Array.from(new Set(
      (url.searchParams.get("dates") || "")
        .split(",")
        .map((d) => d.trim())
        .filter((d) => DATE_RE.test(d))
    )).slice(0, MAX_DATES);
    if (!dates.length) return NextResponse.json({ ok: true, rates: {} });

    const ph = dates.map(() => "?").join(",");
    const res = await DB.prepare(
      `SELECT rate_date, amount_cents FROM fuel_surcharge_rates WHERE rate_date IN (${ph})`
    ).bind(...dates).all();
    const rates: Record<string, number> = {};
    for (const r of (res.results ?? []) as any[]) rates[r.rate_date] = Number(r.amount_cents);
    return NextResponse.json({ ok: true, rates });
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

  const rawAmount = payload?.amount == null ? "" : String(payload.amount).replace(/[$,]/g, "").trim();

  try {
    if (rawAmount === "") {
      // Empty amount clears the rate for that date.
      await DB.prepare("DELETE FROM fuel_surcharge_rates WHERE rate_date = ?").bind(date).run();
      await logActivity(
        DB, "delete", "fuel_surcharge", date, `Cleared fuel surcharge for ${date}`,
        { date, amount_cents: null }, actorId
      );
      return NextResponse.json(await readSingle(DB, date));
    }

    if (!AMOUNT_RE.test(rawAmount)) {
      return NextResponse.json(
        { ok: false, error: "invalid_amount", detail: "Enter a dollar amount like 45.00." },
        { status: 400 }
      );
    }
    const amountCents = Math.round(parseFloat(rawAmount) * 100);
    const now = new Date().toISOString();

    await DB.prepare(
      `INSERT INTO fuel_surcharge_rates (rate_date, amount_cents, entered_by, entered_by_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(rate_date) DO UPDATE SET
         amount_cents = excluded.amount_cents,
         entered_by = excluded.entered_by,
         entered_by_name = excluded.entered_by_name,
         updated_at = excluded.updated_at`
    ).bind(date, amountCents, actorId, actorName, now, now).run();

    await logActivity(
      DB, "update", "fuel_surcharge", date,
      `Set fuel surcharge for ${date} to $${(amountCents / 100).toFixed(2)}`,
      { date, amount_cents: amountCents }, actorId
    );
    return NextResponse.json(await readSingle(DB, date));
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
