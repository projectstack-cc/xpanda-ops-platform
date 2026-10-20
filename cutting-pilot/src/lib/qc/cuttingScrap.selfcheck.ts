// src/lib/qc/cuttingScrap.selfcheck.ts — qc-05
// Self-check for the cutting-board scrap draft helpers (cuttingScrap.ts). No DB, no React.
// Run with: npx tsx src/lib/qc/cuttingScrap.selfcheck.ts   (from cutting-pilot/). Exits 1 on any failure.
import {
  OTHER_PART,
  blankScrapEntry,
  cuttingScrapProblems,
  emptyCuttingScrapDraft,
  toCuttingScrapEntries,
  type CuttingScrapDraft,
  type DraftEntry,
} from "./cuttingScrap";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}

// 2026-10-20 15:00 ET (19:00Z, EDT) → 2nd shift.
const NOW = Date.UTC(2026, 9, 20, 19, 0);

function entry(o: Partial<DraftEntry> = {}): DraftEntry {
  return {
    ...blankScrapEntry(),
    lineItemId: "li-1",
    part: "1.5# taper",
    pieces: "2",
    t: "2.5",
    w: "39",
    l: "80",
    density: "1.5# Virgin",
    reason: "Setup Error",
    notes: "",
    ...o,
  };
}
const draft = (entries: DraftEntry[], o: Partial<CuttingScrapDraft> = {}): CuttingScrapDraft => ({ open: true, shift: "2", entries, ...o });

// emptyCuttingScrapDraft
const empty = emptyCuttingScrapDraft(NOW);
eq("empty: closed", empty.open, false);
eq("empty: no entries", empty.entries, []);
eq("empty: shift from ET now (15:00 → 2)", empty.shift, "2");
eq("empty: 07:00 ET → 1", emptyCuttingScrapDraft(Date.UTC(2026, 9, 20, 11, 0)).shift, "1");
eq("empty: 23:00 ET → 3", emptyCuttingScrapDraft(Date.UTC(2026, 9, 21, 3, 0)).shift, "3");
check("blank entries get distinct keys", blankScrapEntry().key !== blankScrapEntry().key);

// cuttingScrapProblems — closed / empty never block
eq("problems: closed draft", cuttingScrapProblems(empty, NOW), []);
eq("problems: closed with entries", cuttingScrapProblems(draft([entry({ reason: "" })], { open: false }), NOW), []);
eq("problems: open, no entries", cuttingScrapProblems(draft([]), NOW), []);
eq("problems: valid entry", cuttingScrapProblems(draft([entry()]), NOW), []);
eq("problems: Other with note is fine", cuttingScrapProblems(draft([entry({ reason: "Other", notes: "trim" })]), NOW), []);
eq(
  "problems: Other without a note on entry 2",
  cuttingScrapProblems(draft([entry(), entry({ reason: "Other" })]), NOW),
  ["Scrap entry 2: reason Other needs a note"]
);
eq(
  "problems: nothing picked",
  cuttingScrapProblems(draft([{ ...blankScrapEntry() }]), NOW),
  ["Scrap entry 1: pick a part, reason is required, pieces must be a whole number of at least 1, thickness, width and length must be greater than 0"]
);
eq("problems: Other part with no text", cuttingScrapProblems(draft([entry({ lineItemId: OTHER_PART, part: "" })]), NOW), ["Scrap entry 1: part is required"]);
eq("problems: Other part typed is fine", cuttingScrapProblems(draft([entry({ lineItemId: OTHER_PART, part: "offcut" })]), NOW), []);
eq("problems: fractional pieces", cuttingScrapProblems(draft([entry({ pieces: "1.5" })]), NOW), ["Scrap entry 1: pieces must be a whole number of at least 1"]);
eq("problems: zero length", cuttingScrapProblems(draft([entry({ l: "0" })]), NOW), ["Scrap entry 1: thickness, width and length must be greater than 0"]);

// toCuttingScrapEntries
eq("entries: closed → []", toCuttingScrapEntries(draft([entry()], { open: false })), []);
eq("entries: picked part", toCuttingScrapEntries(draft([entry()])), [
  {
    line_item_id: "li-1",
    part_product: "1.5# taper",
    material_density: "1.5# Virgin",
    pieces: 2,
    thickness_in: 2.5,
    width_in: 39,
    length_in: 80,
    scrap_reason: "Setup Error",
    notes: "",
  },
]);
const other = toCuttingScrapEntries(draft([entry({ lineItemId: OTHER_PART, part: "  offcut  ", density: " 2# " })]))[0];
eq("entries: Other part → no line_item_id", other.line_item_id, null);
eq("entries: typed part trimmed", other.part_product, "offcut");
eq("entries: density trimmed", other.material_density, "2#");
check("entries: blank numbers → NaN", Number.isNaN(toCuttingScrapEntries(draft([entry({ t: "" })]))[0].thickness_in));
eq("entries: no server-filled fields", Object.keys(other).filter((k) => ["operator_name", "inv_number", "event_date", "line_machine", "shift"].includes(k)), []);

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  — ${r.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
