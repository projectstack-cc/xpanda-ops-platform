// src/lib/schedule-ingest.ts
// Ingests the human-managed Google-Sheet schedule into `schedule_rows` (see
// DB_Migrations/schedule-board.sql). Runs unattended on a Cloudflare Cron Trigger — no
// user session, no X-User-* identity, no cookies.
import type { D1Database } from "@cloudflare/workers-types";
import * as XLSX from "xlsx";
import { getAccessToken, type GoogleAuthEnv } from "./google-auth";

export interface ScheduleEnv extends GoogleAuthEnv {
  DB: D1Database;
  SCHEDULE_SHEET_ID: string;
}

export interface ParsedRow {
  invoice_number: string;
  ship_week: string;
  ship_date: string | null;
  day_of_week: string;
  sort_order: number;
  customer: string | null;
  load_count: number | null;
  method: string | null;
  location: string | null;
  delivery_time: string | null;
  carrier: string | null;
  total_bdft: number | null;
  scrap_pickup: string | null;
  sheet_status: string | null;
}

const DAY_NAMES = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const;
type DayName = (typeof DAY_NAMES)[number];
// PENDING removed from the captured sections by request — see parseSchedule's PENDING
// handling below. The sheet's own PENDING block stays the source of truth for that list.
type Section = DayName;

const INV_REGEX = /INV\s*(\d+)/i;
const CONTINUATION_MARKER = "^^^";
const JOBS_LOOKUP_CHUNK = 90; // D1 100-bound-param ceiling

// ─── Ship-week tab names ──────────────────────────────────────────────────────

/** Monday-anchored `M-D-YY` names for the current and next ship weeks (e.g. "7-20-26"). */
export function currentAndNextShipWeekTabs(now: Date): [string, string] {
  const monday = mondayOf(now);
  const nextMonday = addUtcDays(monday, 7);
  return [formatTabName(monday), formatTabName(nextMonday)];
}

function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  return addUtcDays(d, diff);
}

function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function formatTabName(monday: Date): string {
  const m = monday.getUTCMonth() + 1;
  const d = monday.getUTCDate();
  const y = monday.getUTCFullYear() % 100;
  return `${m}-${d}-${String(y).padStart(2, "0")}`;
}

function parseTabName(tab: string): Date | null {
  const m = tab.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (!m) return null;
  const [, mo, da, yr] = m;
  return new Date(Date.UTC(2000 + Number(yr), Number(mo) - 1, Number(da)));
}

// ─── Drive file fetch + XLSX parse ─────────────────────────────────────────────
//
// The source file is an uploaded Excel workbook kept in "Office compatibility mode" in
// Drive (mimeType application/vnd.openxmlformats-officedocument.spreadsheetml.sheet), NOT a
// converted native Google Sheet — confirmed live: Sheets API v4 flatly refuses it
// (400 FAILED_PRECONDITION "must not be an Office file"). Converting the file once would
// dodge that, but the sheet's human updater habitually re-uploads a fresh .xlsx over the
// same file, which reverts it to Office format and would break the poller again. Reading
// the raw bytes via the Drive API instead is format-agnostic — it doesn't care whether the
// file is a native Sheet or an Office file, so it survives every future re-upload.
// Requires the `drive.readonly` OAuth scope (broader than `spreadsheets.readonly` — see
// google-auth.ts; the token-exchange code itself didn't need to change, only the scope
// baked into the refresh token at consent time).
//
// The live workbook carries 190+ historical tabs (one per ship-week back to late 2024).
// XLSX.read() fully parses every sheet by default — confirmed live via wrangler tail: the
// scheduled handler was hitting Cloudflare's CPU time limit and getting killed before a
// single row was written, every single poll. The `sheets` read option restricts actual
// parsing to the named tabs (SheetNames still lists everything, but only these two get
// decompressed+parsed) — cut local benchmark parse time from ~16s to ~5s for the same file.

/**
 * One Drive API file download (`alt=media`) for the whole workbook, then each requested
 * ship-week tab is looked up as a sheet name within it. A download/parse failure is logged
 * and yields an empty map, so callers skip pruning for both weeks rather than wiping the
 * board on a transient Google error. A single missing tab (e.g. next week not created yet)
 * is NOT a failure — it's simply absent from the map, so only that week skips pruning.
 */
export async function fetchSheetTabs(
  env: ScheduleEnv,
  token: string,
  tabs: string[]
): Promise<Map<string, string[][]>> {
  const result = new Map<string, string[][]>();
  const url = `https://www.googleapis.com/drive/v3/files/${env.SCHEDULE_SHEET_ID}?alt=media`;

  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const text = await res.text();
      console.error(`schedule-ingest: Drive file download failed (${res.status}): ${text}`);
      return result;
    }

    const bytes = await res.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: "array", sheets: tabs });

    for (const tab of tabs) {
      const sheet = workbook.Sheets[tab];
      if (!sheet) continue; // tab not created yet — absent from map, not a failure
      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1,
        raw: false,
        defval: "",
      });
      result.set(tab, rows);
    }
  } catch (err) {
    console.error("schedule-ingest: Drive file download/parse threw", err);
  }

  return result;
}

// ─── Sheet parsing ────────────────────────────────────────────────────────────

function cell(row: string[], index: number): string {
  return (row[index] ?? "").toString().trim();
}

function textOrNull(raw: string): string | null {
  if (!raw || raw === CONTINUATION_MARKER) return null;
  return raw;
}

function numOrNull(raw: string): number | null {
  if (!raw || raw === CONTINUATION_MARKER) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function shipDateFor(shipWeek: string, day: Section): string | null {
  const monday = parseTabName(shipWeek);
  if (!monday) return null;
  const offset = DAY_NAMES.indexOf(day);
  return addUtcDays(monday, offset).toISOString().slice(0, 10);
}

// Confirmed against live data: a totals row above the real MONDAY header reads "PENDING
// DELIVERIES @ BOTTOM" — a bare `includes("PENDING")` matches that too. Harmless today (the
// real MONDAY header on the very next row overrides it before any order row is processed),
// but fragile. The real section header reads "PENDING DATE OF DELIVERY PER SALES LEAD
// LISTED's customer listed" — match that specific phrase instead.
const PENDING_HEADER_PHRASE = "PENDING DATE OF DELIVERY";

/** A day-section header, the PENDING boundary, or null (an order row / anything else). */
function sectionHeader(row: string[]): DayName | "PENDING" | null {
  for (const raw of row) {
    const v = (raw ?? "").toString().trim().toUpperCase();
    if (!v) continue;
    if ((DAY_NAMES as readonly string[]).includes(v)) return v as DayName;
    if (v.includes(PENDING_HEADER_PHRASE)) return "PENDING";
  }
  return null;
}

/**
 * Section-header state machine: MONDAY..FRIDAY rows open a day section; order rows
 * underneath belong to whichever section is currently open. A PENDING DATE OF DELIVERY row
 * closes capture for the rest of the tab — those orders have no confirmed ship date and are
 * intentionally not shown on the board (removed by request; the sheet itself stays the
 * source of truth for that list). Rows with no parseable INV# are skipped — they can't join
 * and can't key `schedule_rows`.
 */
export function parseSchedule(rows: string[][], shipWeek: string): ParsedRow[] {
  const out: ParsedRow[] = [];
  let currentSection: Section | null = null;
  let sortOrder = 0;

  for (const row of rows) {
    const header = sectionHeader(row);
    if (header === "PENDING") {
      currentSection = null; // stop capturing for the rest of this tab
      continue;
    }
    if (header) {
      currentSection = header;
      sortOrder = 0;
      continue;
    }
    if (!currentSection) continue; // nothing captured before the first section header, or past PENDING

    const rawDeliveryTime = cell(row, 5); // col F
    const invMatch = rawDeliveryTime.match(INV_REGEX);
    if (!invMatch) continue; // no INV# — can't join, can't key

    out.push({
      invoice_number: invMatch[1],
      ship_week: shipWeek,
      ship_date: shipDateFor(shipWeek, currentSection),
      day_of_week: currentSection,
      sort_order: sortOrder++,
      customer: textOrNull(cell(row, 1)),
      load_count: numOrNull(cell(row, 2)),
      method: textOrNull(cell(row, 3)),
      location: textOrNull(cell(row, 4)),
      delivery_time: rawDeliveryTime || null,
      carrier: textOrNull(cell(row, 6)),
      total_bdft: numOrNull(cell(row, 7)),
      scrap_pickup: textOrNull(cell(row, 8)),
      sheet_status: textOrNull(cell(row, 9)),
    });
  }

  return out;
}

// ─── Match + upsert ───────────────────────────────────────────────────────────

interface JobLookupRow {
  id: string;
  invoice_number: string;
}

/**
 * Matches parsed rows to `jobs.invoice_number`, upserts into `schedule_rows` by
 * (invoice_number, ship_week, day_of_week), and prunes rows no longer present for weeks
 * actually fetched this run. The key includes `day_of_week` — NOT just (invoice_number,
 * ship_week) — because a single large order routinely splits its base invoice across
 * multiple delivery days within the same week (confirmed live: "INV 4203-001 thru 003" on
 * Tuesday and "INV 4203-004 thru 007" on Wednesday both reduce to base invoice 4203 under the
 * `INV\s*(\d+)` regex; a two-field key would have silently dropped one row every poll).
 * `schedule_rows` has no UNIQUE constraint for this (see 1/5), so the upsert is done in
 * application code (select-then-insert/update) rather than SQL ON CONFLICT. Pruning uses a
 * mark-and-sweep: every row touched this run gets the same `last_seen_at`; anything older for
 * a fetched week is stale and deleted.
 */
export async function matchAndUpsert(
  db: D1Database,
  parsedRows: ParsedRow[],
  fetchedShipWeeks: string[]
): Promise<void> {
  const pollTimestamp = new Date().toISOString();
  const jobIdByInvoice = await lookupJobIds(db, parsedRows.map((r) => r.invoice_number));

  for (const row of parsedRows) {
    const matchJobId = jobIdByInvoice.get(row.invoice_number) ?? null;
    await upsertRow(db, row, matchJobId, pollTimestamp);
  }

  for (const shipWeek of fetchedShipWeeks) {
    await db
      .prepare(`DELETE FROM schedule_rows WHERE ship_week = ? AND last_seen_at < ?`)
      .bind(shipWeek, pollTimestamp)
      .run();
  }
}

async function lookupJobIds(db: D1Database, invoiceNumbers: string[]): Promise<Map<string, string>> {
  const jobIdByInvoice = new Map<string, string>();
  const distinct = Array.from(new Set(invoiceNumbers));

  for (let i = 0; i < distinct.length; i += JOBS_LOOKUP_CHUNK) {
    const chunk = distinct.slice(i, i + JOBS_LOOKUP_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT id, invoice_number FROM jobs WHERE invoice_number IN (${placeholders})`)
      .bind(...chunk)
      .all<JobLookupRow>();
    for (const row of results ?? []) {
      jobIdByInvoice.set(row.invoice_number.trim(), row.id);
    }
  }

  return jobIdByInvoice;
}

async function upsertRow(
  db: D1Database,
  row: ParsedRow,
  matchJobId: string | null,
  lastSeenAt: string
): Promise<void> {
  const existing = await db
    .prepare(
      `SELECT id FROM schedule_rows WHERE invoice_number = ? AND ship_week = ? AND day_of_week = ?`
    )
    .bind(row.invoice_number, row.ship_week, row.day_of_week)
    .first<{ id: number }>();

  if (existing) {
    await db
      .prepare(
        `UPDATE schedule_rows SET
           ship_date = ?, day_of_week = ?, sort_order = ?, customer = ?, load_count = ?,
           method = ?, location = ?, delivery_time = ?, carrier = ?, total_bdft = ?,
           scrap_pickup = ?, sheet_status = ?, match_job_id = ?, last_seen_at = ?
         WHERE id = ?`
      )
      .bind(
        row.ship_date,
        row.day_of_week,
        row.sort_order,
        row.customer,
        row.load_count,
        row.method,
        row.location,
        row.delivery_time,
        row.carrier,
        row.total_bdft,
        row.scrap_pickup,
        row.sheet_status,
        matchJobId,
        lastSeenAt,
        existing.id
      )
      .run();
    return;
  }

  await db
    .prepare(
      `INSERT INTO schedule_rows
         (invoice_number, ship_week, ship_date, day_of_week, sort_order, customer,
          load_count, method, location, delivery_time, carrier, total_bdft,
          scrap_pickup, sheet_status, match_job_id, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.invoice_number,
      row.ship_week,
      row.ship_date,
      row.day_of_week,
      row.sort_order,
      row.customer,
      row.load_count,
      row.method,
      row.location,
      row.delivery_time,
      row.carrier,
      row.total_bdft,
      row.scrap_pickup,
      row.sheet_status,
      matchJobId,
      lastSeenAt
    )
    .run();
}

// ─── Orchestration ────────────────────────────────────────────────────────────

/** Full poll run: refresh token → fetch both tabs → parse → match/upsert/prune. */
export async function runSchedulePoll(env: ScheduleEnv): Promise<void> {
  const token = await getAccessToken(env);
  const tabs = currentAndNextShipWeekTabs(new Date());
  const sheetData = await fetchSheetTabs(env, token, tabs);

  const parsedRows: ParsedRow[] = [];
  for (const [tab, rows] of Array.from(sheetData.entries())) {
    parsedRows.push(...parseSchedule(rows, tab));
  }

  await matchAndUpsert(env.DB, parsedRows, Array.from(sheetData.keys()));
}
