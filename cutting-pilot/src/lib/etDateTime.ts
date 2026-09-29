// src/lib/etDateTime.ts
// Stored-timestamp → ET wall-clock display helpers (carrier-03). Timestamps in this codebase come
// in two shapes: JS toISOString() ("2026-09-29T18:14:00.000Z") and SQLite datetime('now')
// ("2026-09-29 18:14:00", UTC with no zone marker). Both are UTC; parse accordingly.

export function parseStoredUtc(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const s = String(ts).trim();
  if (!s) return null;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** "9/29 2:14 PM" (or "Tue 9/29 2:14 PM" with weekday) in America/New_York. */
export function formatEtDateTime(ts: string | null | undefined, opts: { weekday?: boolean } = {}): string | null {
  const ms = parseStoredUtc(ts);
  if (ms == null) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: opts.weekday ? "short" : undefined,
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(ms);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("month")}/${get("day")}`;
  const time = `${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
  return [opts.weekday ? get("weekday") : "", date, time].filter(Boolean).join(" ");
}

/** ET calendar date "YYYY-MM-DD" of a stored UTC timestamp (carrier-06 History day buckets). */
export function etDateKey(ts: string | null | undefined): string | null {
  const ms = parseStoredUtc(ts);
  if (ms == null) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(ms);
}

/** "4:15 AM" from minutes after midnight. */
export function formatClockMinutes(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** "Wed" for a YYYY-MM-DD date string (calendar date, no TZ shift). */
export function weekdayShort(date: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, (mo || 1) - 1, d || 1))
  );
}
