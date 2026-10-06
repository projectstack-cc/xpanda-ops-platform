// src/lib/logistics/splitDays.ts
// split-days-01: per-load ship-day expansion for the /v2/logistics shipment list. Pure -- no D1 access.
// A split shipment stores each load's own day on loading_assignments.ship_date (legacy P318/P319). The list
// API returns one entry per (order, effective ship day) so the dashboard, calendar and week tile can place
// each load on the day it actually ships.
//
// Stale-override rule: a per-load date only takes effect when it actually SPLITS the order across more
// than one day. An unsplit order always sits on shipments.ship_date (legacy P326 parity) -- a lone
// override left behind after the order date moved (live case INV 4386) must not relocate the order.

export interface LoadDayRow { job_id: string; load_number: number | null; ship_date: string | null }

function dayOf(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, 10) : null;
}

/** Expand one shipment list row into one entry per distinct effective ship day.
 *  Loads enumerated = union of 1..max(load_count,1) and any load_number present in `loads`.
 *  Each load's day = its own non-blank ship_date (first 10 chars) else row.ship_date (first 10 chars) else null.
 *  ≤1 distinct day  -> ONE entry: day_date = row.ship_date (ALWAYS the order date, never a lone override),
 *                      day_loads = null, entry_key = row.id
 *  >1 distinct days -> one entry per day: day_loads = sorted load numbers for that day,
 *                      entry_key = `${row.id}@${day ?? "none"}`. */
export function expandShipmentDays<T extends { id: string; ship_date: string | null; load_count: number | null }>(
  row: T, loads: LoadDayRow[]
): Array<T & { day_date: string | null; day_loads: number[] | null; entry_key: string }> {
  const orderDay = dayOf(row.ship_date);
  const ownDay = new Map<number, string | null>();
  for (const l of loads) {
    if (l.load_number == null) continue;
    const n = Number(l.load_number);
    if (!Number.isInteger(n)) continue;
    // Duplicate rows for one load_number: first non-blank date wins.
    if (!ownDay.get(n)) ownDay.set(n, dayOf(l.ship_date));
  }
  const loadNums = new Set<number>();
  const count = Math.max(Number(row.load_count) || 0, 1);
  for (let n = 1; n <= count; n++) loadNums.add(n);
  ownDay.forEach((_d, n) => loadNums.add(n));

  const byDay = new Map<string | null, number[]>();
  for (const n of Array.from(loadNums).sort((a, b) => a - b)) {
    const d = ownDay.get(n) ?? orderDay;
    const list = byDay.get(d) ?? [];
    list.push(n);
    byDay.set(d, list);
  }

  if (byDay.size <= 1) {
    return [{ ...row, day_date: row.ship_date, day_loads: null, entry_key: row.id }];
  }
  const days = Array.from(byDay.keys()).sort((a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1));
  return days.map((d) => ({
    ...row,
    day_date: d,
    day_loads: byDay.get(d)!,
    entry_key: `${row.id}@${d ?? "none"}`,
  }));
}

/** True when day is within [mondayStr, mondayStr + 6 days] (string compare on YYYY-MM-DD, UTC-safe date math). */
export function inWeek(day: string | null, mondayStr: string): boolean {
  const d = dayOf(day);
  if (!d) return false;
  const [y, m, dd] = mondayStr.slice(0, 10).split("-").map(Number);
  if (!y || !m || !dd) return false;
  const end = new Date(Date.UTC(y, m - 1, dd + 6)).toISOString().slice(0, 10);
  return d >= mondayStr.slice(0, 10) && d <= end;
}

/** Stable sort: day_date asc, null last; ties keep input order. */
export function sortEntries<E extends { day_date: string | null }>(entries: E[]): E[] {
  return entries
    .map((e, i) => ({ e, i, d: dayOf(e.day_date) }))
    .sort((a, b) => {
      if (a.d !== b.d) {
        if (a.d === null) return 1;
        if (b.d === null) return -1;
        return a.d < b.d ? -1 : 1;
      }
      return a.i - b.i;
    })
    .map((x) => x.e);
}

/** Week tile numbers from expanded+windowed entries.
 *  orders = distinct row ids.
 *  loads  = sum over groups of MAX(entry loads), where entry loads = day_loads?.length ?? max(load_count,1),
 *           group key = `${trailer_group_id ?? entry_key}|${day_date}` (mirrors lgx-widgets-01's
 *           trailer_group_id collapse, per day). */
export function weekTileCounts(entries: Array<{ id: string; entry_key: string; day_date: string | null;
  day_loads: number[] | null; load_count: number | null; trailer_group_id?: string | null }>): { orders: number; loads: number } {
  const ids = new Set<string>();
  const groups = new Map<string, number>();
  for (const e of entries) {
    ids.add(e.id);
    const n = e.day_loads ? e.day_loads.length : Math.max(Number(e.load_count) || 0, 1);
    const key = `${e.trailer_group_id || e.entry_key}|${e.day_date}`;
    groups.set(key, Math.max(groups.get(key) ?? 0, n));
  }
  let loads = 0;
  groups.forEach((v) => { loads += v; });
  return { orders: ids.size, loads };
}
