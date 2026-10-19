// src/lib/qc/scrap.selfcheck.ts — qc-04
// Self-check for the pure scrap helpers (scrap.ts). No DB.
// Run with: npx tsx src/lib/qc/scrap.selfcheck.ts   (from cutting-pilot/). Exits 1 on any failure.
import {
  defaultShiftForEtMinutes,
  monthName,
  scrapVolume,
  validateScrapEntry,
  weekNumberMondayStart,
} from "./scrap";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}

// Legacy getWeekNumberMondayStart, verbatim from _worker.js/routes/qc.js @ 503cbb4, fed the same
// `${event_date}T00:00:00` local Date legacy built.
function legacyGetWeekNumberMondayStart(date: Date): number {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const dayOffset = (yearStart.getUTCDay() + 6) % 7;
  const diff = Math.floor(((d as any) - (yearStart as any)) / 86400000);
  return Math.floor((diff + dayOffset) / 7) + 1;
}
function legacyWeek(ymd: string): number {
  return legacyGetWeekNumberMondayStart(new Date(`${ymd}T00:00:00`));
}

// ── weekNumberMondayStart ──
const weekDates = [
  "2025-12-28", "2025-12-29", "2025-12-31", "2026-01-01", "2026-01-04", "2026-01-05",
  "2026-03-09", "2026-03-10", "2026-03-31", "2026-07-04", "2026-10-12", "2026-10-16", "2026-10-18",
  "2026-12-31", "2027-01-01", "2027-01-03", "2027-01-04", "2024-02-29",
];
for (const d of weekDates) eq(`week ${d} = legacy`, weekNumberMondayStart(d), legacyWeek(d));
// Year boundary: 2026-01-01 is a Thursday → week 1; Sun 01-04 still week 1; Mon 01-05 → week 2.
eq("week 2026-01-01", weekNumberMondayStart("2026-01-01"), 1);
eq("week 2026-01-04", weekNumberMondayStart("2026-01-04"), 1);
eq("week 2026-01-05", weekNumberMondayStart("2026-01-05"), 2);
eq("week 2025-12-31 (prev year)", weekNumberMondayStart("2025-12-31"), 53);
eq("week 2026-10-16", weekNumberMondayStart("2026-10-16"), 42);

// ── monthName ──
eq("month 2026-10-16", monthName("2026-10-16"), "October");
eq("month 2026-01-01", monthName("2026-01-01"), "January");
eq("month 2026-12-31", monthName("2026-12-31"), "December");

// ── scrapVolume ──
// The qc-04 prompt listed 24,408.375 / 169.503 here; the exact product is 21.75 × 1,122.25 = 24,408.9375
// in³ → 169.5065 bdft, so 24,408.938 / 169.507 at 3 dp (flagged to Steve in the qc-04 report).
eq("vol 6×3.625×33.5×33.5", scrapVolume(6, 3.625, 33.5, 33.5), { cubicIn: 24408.938, boardFt: 169.507 });
eq("vol 1×5×47×96", scrapVolume(1, 5, 47, 96), { cubicIn: 22560, boardFt: 156.667 });
eq("vol zero pieces", scrapVolume(0, 1, 1, 1), null);
eq("vol fractional pieces", scrapVolume(1.5, 1, 1, 1), null);
eq("vol zero dim", scrapVolume(1, 0, 1, 1), null);
eq("vol NaN dim", scrapVolume(1, NaN, 1, 1), null);
eq("vol Infinity dim", scrapVolume(1, Infinity, 1, 1), null);

// ── defaultShiftForEtMinutes ──
const hm = (h: number, m: number) => h * 60 + m;
eq("shift 05:59", defaultShiftForEtMinutes(hm(5, 59)), "3");
eq("shift 06:00", defaultShiftForEtMinutes(hm(6, 0)), "1");
eq("shift 14:15 (overlap → starting 2nd)", defaultShiftForEtMinutes(hm(14, 15)), "2");
eq("shift 14:31", defaultShiftForEtMinutes(hm(14, 31)), "2");
eq("shift 22:10 (overlap → starting 3rd)", defaultShiftForEtMinutes(hm(22, 10)), "3");
eq("shift 23:00", defaultShiftForEtMinutes(hm(23, 0)), "3");
eq("shift 00:00", defaultShiftForEtMinutes(0), "3");
eq("shift 13:59", defaultShiftForEtMinutes(hm(13, 59)), "1");

// ── validateScrapEntry ──
const TODAY = "2026-10-16";
const good = {
  event_date: "2026-10-16",
  shift: "1",
  inv_number: " 4484 ",
  line_machine: "Main Line",
  operator_name: " Luis M. ",
  part_product: "FOAM-H3636-4",
  material_density: "1.0# RC",
  pieces: 6,
  thickness_in: 3.625,
  width_in: 33.5,
  length_in: 33.5,
  scrap_reason: "Incorrect Cut",
};
const okRes = validateScrapEntry(good, TODAY);
check("valid entry ok", okRes.ok === true, JSON.stringify(okRes));
if (okRes.ok) {
  eq("valid entry trimmed inv", okRes.value.inv_number, "4484");
  eq("valid entry trimmed operator", okRes.value.operator_name, "Luis M.");
  eq("valid entry bdft", okRes.value.scrap_board_ft, 169.507);
  eq("valid entry notes null", okRes.value.notes, null);
}
const other = validateScrapEntry({ ...good, scrap_reason: "Other", notes: "   " }, TODAY);
check("Other without a note rejected", !other.ok && other.errors.includes("Notes are required when the reason is Other."), JSON.stringify(other));
const otherOk = validateScrapEntry({ ...good, scrap_reason: "Other", notes: "Bag tore" }, TODAY);
check("Other with a note ok", otherOk.ok === true, JSON.stringify(otherOk));
const future = validateScrapEntry({ ...good, event_date: "2026-10-17" }, TODAY);
check("future date rejected", !future.ok && future.errors.includes("Date can't be in the future."), JSON.stringify(future));
const zero = validateScrapEntry({ ...good, pieces: 0 }, TODAY);
check("zero pieces rejected", !zero.ok && zero.errors.includes("Pieces must be a whole number of at least 1."), JSON.stringify(zero));
const badLine = validateScrapEntry({ ...good, line_machine: "Saw" }, TODAY);
check("unknown line rejected", !badLine.ok, JSON.stringify(badLine));
const laminate = validateScrapEntry({ ...good, line_machine: "Laminate" }, TODAY);
check("Laminate allowed", laminate.ok === true, JSON.stringify(laminate));
const longNotes = validateScrapEntry({ ...good, notes: "x".repeat(600) }, TODAY);
check("notes capped at 500", longNotes.ok && longNotes.value.notes?.length === 500, JSON.stringify(longNotes.ok));
const badDate = validateScrapEntry({ ...good, event_date: "2026-02-30" }, TODAY);
check("impossible date rejected", !badDate.ok, JSON.stringify(badDate));

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
