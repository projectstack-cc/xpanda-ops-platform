// src/lib/logistics/toLoadSheet.ts
// tls-01: pure selection + ordering for the 1st / 2nd shift To-Load sheets (/v2/logistics toolbar).
// No DB, no pdf-lib. The route (api/shipments/to-load-sheet) fetches + labels the rows; the PDF
// builder (toLoadSheetPdf.ts) draws them. Dates are plain YYYY-MM-DD ship days (ET calendar), all
// math via Date.UTC — same convention as addDaysStr in lib/deliveryTime.ts.
import { weekdayShort } from "@/lib/etDateTime";

export type Shift = 1 | 2;

export interface ToLoadRow {
  job_id: string;
  assignment_id: string | null;
  ship_day: string;
  bay_number: number | null;
  location: "bay" | "yard" | null;
  invoice_number: string | null;
  customer: string | null;
  load_number: number;
  load_count: number | null;
  loading_status: string | null;
  city_label: string;
  delivery_label: string;
  pickup_label: string | null;
  pickup_early: boolean;
}

export interface ToLoadDay {
  shipDay: string;
  rows: ToLoadRow[];
}

export interface ToLoadSection {
  kind: "pickups" | "to_load";
  title: string;
  days: ToLoadDay[];
  note: string | null;
}

export interface ToLoadSheet {
  shift: Shift;
  printedOn: string;
  sections: ToLoadSection[];
}

/** Max ship days a to-load section may span (first day included). */
export const TO_LOAD_FALLBACK_CAP = 5;
/** A to-load section keeps appending ship days until it has at least this many rows. */
export const TO_LOAD_MIN_ROWS = 2;

function addDaysStr(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Next Mon–Fri date strictly after `date`. Plant holidays are not modeled. */
export function nextShipDay(date: string): string {
  let d = addDaysStr(date, 1);
  while (weekdayOf(d) === 0 || weekdayOf(d) === 6) d = addDaysStr(d, 1);
  return d;
}

/** "Mon 10/5" for a YYYY-MM-DD date. */
export function shipDayLabel(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${weekdayShort(date)} ${m}/${d}`;
}

export function isLoaded(status: string | null): boolean {
  return status === "loaded" || status === "in_transit" || status === "delivered";
}

/** 0 = bay, 1 = yard, 2 = unassigned. */
export function rowGroup(r: ToLoadRow): 0 | 1 | 2 {
  if (r.location === "yard") return 1;
  if (r.bay_number != null) return 0;
  return 2;
}

function invoiceNum(inv: string | null): number {
  const n = parseInt(String(inv ?? "").trim(), 10);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/** Bays 30 → 20, then Yard, then Unassigned; ties by invoice # (numeric) then load #. */
export function compareRows(a: ToLoadRow, b: ToLoadRow): number {
  const ga = rowGroup(a);
  const gb = rowGroup(b);
  if (ga !== gb) return ga - gb;
  if (ga === 0 && a.bay_number !== b.bay_number) return (b.bay_number as number) - (a.bay_number as number);
  const ia = invoiceNum(a.invoice_number);
  const ib = invoiceNum(b.invoice_number);
  if (ia !== ib) return ia < ib ? -1 : 1;
  const sa = String(a.invoice_number ?? "");
  const sb = String(b.invoice_number ?? "");
  if (sa !== sb) return sa < sb ? -1 : 1;
  return a.load_number - b.load_number;
}

/** Ship days the route must fetch: S1 through the 6th ship day after `printedOn`. */
export function toLoadWindow(printedOn: string): string[] {
  const out: string[] = [];
  let d = printedOn;
  for (let i = 0; i < 1 + TO_LOAD_FALLBACK_CAP; i++) {
    d = nextShipDay(d);
    out.push(d);
  }
  return out;
}

function rowsForDay(rows: ToLoadRow[], shipDay: string, notLoadedOnly: boolean): ToLoadRow[] {
  return rows
    .filter((r) => r.ship_day === shipDay && (!notLoadedOnly || !isLoaded(r.loading_status)))
    .sort(compareRows);
}

function toLoadSection(rows: ToLoadRow[], firstDay: string): ToLoadSection {
  const days: ToLoadDay[] = [];
  let count = 0;
  let day = firstDay;
  let lastDay = firstDay;
  for (let i = 0; i < TO_LOAD_FALLBACK_CAP; i++) {
    if (i > 0) day = nextShipDay(day);
    lastDay = day;
    const dayRows = rowsForDay(rows, day, true);
    if (dayRows.length) {
      days.push({ shipDay: day, rows: dayRows });
      count += dayRows.length;
    }
    if (count >= TO_LOAD_MIN_ROWS) break;
  }
  const note = count < TO_LOAD_MIN_ROWS ? `Nothing else scheduled to load through ${shipDayLabel(lastDay)}.` : null;
  return { kind: "to_load", title: "To load", days, note };
}

export function buildToLoadSheet(rows: ToLoadRow[], shift: Shift, printedOn: string): ToLoadSheet {
  const s1 = nextShipDay(printedOn);
  const sections: ToLoadSection[] = [];
  if (shift === 1) {
    const pickups = rowsForDay(rows, s1, false);
    sections.push({
      kind: "pickups",
      title: `Pickups ${shipDayLabel(s1)}`,
      days: pickups.length ? [{ shipDay: s1, rows: pickups }] : [],
      note: null,
    });
    sections.push(toLoadSection(rows, nextShipDay(s1)));
  } else {
    sections.push(toLoadSection(rows, s1));
  }
  return { shift, printedOn, sections };
}
