// src/lib/logistics/bolEmail.ts — bem-01. Server helpers for the v2 BOL Email Queue
// (/v2/api/bol-email/*), ported verbatim from legacy _worker.js/routes/bol-email.js.
import { NextResponse, type NextRequest } from "next/server";
import type { D1Database } from "@cloudflare/workers-types";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** bem-01 Decision 1: the whole queue (GETs included) requires logistics.bol EDIT. */
export function requireBolEdit(request: NextRequest): NextResponse | null {
  if (request.headers.get("X-User-Can-Edit-Bol") === "1") return null;
  return NextResponse.json({ ok: false, error: "BOL Email requires BOL Generator edit access." }, { status: 403 });
}

export function etDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

// Day-of-week for a plain YYYY-MM-DD calendar date (0=Sun … 6=Sat), TZ-drift-free.
export function dowOfDateStr(ds: string): number {
  return new Date(ds + "T12:00:00Z").getUTCDay();
}

// Next shipping day (ET): the soonest future date that is not a weekend and not a plant holiday.
export async function nextShippingDateStr(db: D1Database): Promise<string> {
  let holidays = new Set<string>();
  try {
    const hr = await db.prepare("SELECT holiday_date FROM plant_holidays").all();
    holidays = new Set(((hr.results || []) as any[]).map((r) => String(r.holiday_date)));
  } catch {
    // plant_holidays not present yet → degrade to weekdays-only rather than 500
  }
  for (let off = 1; off <= 30; off++) {
    const ds = etDateStr(off);
    const dow = dowOfDateStr(ds);
    if (dow !== 0 && dow !== 6 && !holidays.has(ds)) return ds;
  }
  return etDateStr(1);
}
