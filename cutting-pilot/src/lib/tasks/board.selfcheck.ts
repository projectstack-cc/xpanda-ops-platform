// tasks-01 selfcheck: `npx tsx src/lib/tasks/board.selfcheck.ts` (from cutting-pilot/).
import {
  normalizeShift, isValidHm, checkSlot, formatHm, formatSlot, shiftStatus, shiftPresets, joinNames, buildBoard,
  type BoardPerson, type BoardTaskInput, type ShiftKey,
} from "./board";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); }
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

// ── 1. normalizeShift ──
check("shift: 1st", normalizeShift("1st") === "1st");
check("shift: ' 2ND '", normalizeShift(" 2ND ") === "2nd");
check("shift: 3rd → null", normalizeShift("3rd") === null);
check("shift: null → null", normalizeShift(null) === null);
check("shift: '' → null", normalizeShift("") === null);

// ── 2. checkSlot / isValidHm ──
check("slot: both empty → ok nulls", eq(checkSlot("", null), { ok: true, start: null, end: null }));
check("slot: one empty → incomplete", eq(checkSlot("06:00", ""), { ok: false, error: "slot_incomplete" }));
check("slot: other empty → incomplete", eq(checkSlot(null, "11:00"), { ok: false, error: "slot_incomplete" }));
check("slot: 6:00 → invalid", eq(checkSlot("6:00", "11:00"), { ok: false, error: "slot_invalid" }));
check("slot: 24:00 → invalid", eq(checkSlot("06:00", "24:00"), { ok: false, error: "slot_invalid" }));
check("slot: end == start → order", eq(checkSlot("06:00", "06:00"), { ok: false, error: "slot_order" }));
check("slot: end < start → order", eq(checkSlot("11:00", "06:00"), { ok: false, error: "slot_order" }));
check("slot: 06:00/11:00 → ok", eq(checkSlot("06:00", "11:00"), { ok: true, start: "06:00", end: "11:00" }));
check("isValidHm: 23:59", isValidHm("23:59"));
check("isValidHm: number → false", !isValidHm(600));

// ── 3. formatHm / formatSlot ──
check("fmt 06:00", formatHm("06:00") === "6:00a");
check("fmt 11:00", formatHm("11:00") === "11:00a");
check("fmt 12:00", formatHm("12:00") === "12:00p");
check("fmt 14:30", formatHm("14:30") === "2:30p");
check("fmt 00:15", formatHm("00:15") === "12:15a");
check("fmt 22:30", formatHm("22:30") === "10:30p");
check("slot label", formatSlot("06:00", "11:00") === "6:00a–11:00a");
check("slot label null pair", formatSlot(null, null) === null);

// ── 4. shiftStatus ──
check("status 05:59 1st upcoming", shiftStatus("1st", hm("05:59")) === "upcoming");
check("status 06:00 1st on", shiftStatus("1st", hm("06:00")) === "on");
check("status 14:15 1st on", shiftStatus("1st", hm("14:15")) === "on");
check("status 14:15 2nd on", shiftStatus("2nd", hm("14:15")) === "on");
check("status 14:30 1st done", shiftStatus("1st", hm("14:30")) === "done");
check("status 14:30 2nd on", shiftStatus("2nd", hm("14:30")) === "on");
check("status 22:30 2nd done", shiftStatus("2nd", hm("22:30")) === "done");
check("status 05:59 2nd upcoming", shiftStatus("2nd", hm("05:59")) === "upcoming");

// ── 5. shiftPresets ──
{
  const p1 = shiftPresets("1st").map(({ key, start, end }) => ({ key, start, end }));
  check("presets 1st exact", eq(p1, [
    { key: "start_of_shift", start: "06:00", end: "07:00" },
    { key: "first_half", start: "06:00", end: "10:15" },
    { key: "second_half", start: "10:15", end: "14:30" },
    { key: "whole_shift", start: "06:00", end: "14:30" },
    { key: "end_of_shift", start: "13:30", end: "14:30" },
  ]), JSON.stringify(p1));
  const w2 = shiftPresets("2nd").find((p) => p.key === "whole_shift");
  check("presets 2nd whole_shift 14:00–22:30", w2?.start === "14:00" && w2?.end === "22:30");
  const h2 = shiftPresets("2nd").find((p) => p.key === "first_half");
  check("presets 2nd first_half 14:00–18:15", h2?.start === "14:00" && h2?.end === "18:15");
}

// ── 6. joinNames ──
check("join 1", joinNames(["A"]) === "A");
check("join 2", joinNames(["A", "B"]) === "A & B");
check("join 3", joinNames(["A", "B", "C"]) === "A, B & C");
check("join 0", joinNames([]) === "");

// ── buildBoard fixtures ──
const P = (id: string, name: string, shift: ShiftKey | null): BoardPerson => ({ id, name, shift });
const ann = P("u-ann", "Ann", "1st");
const bob = P("u-bob", "Bob", "1st");
const cat = P("u-cat", "Cat", "2nd");
const dan = P("u-dan", "Dan", "2nd");
const eve = P("u-eve", "Eve", null);
const fay = P("u-fay", "Fay", null);
const isr = P("u-isr", "Israel", normalizeShift("3rd"));

let seq = 0;
const T = (o: Partial<BoardTaskInput> & { assignees: BoardPerson[] }): BoardTaskInput => ({
  id: `t${++seq}`, title: `Task ${seq}`, slot_start: null, slot_end: null, sort_order: seq,
  template_id: null, crew_name: null, jobs: [], ...o,
});
const g = (b: ReturnType<typeof buildBoard>, s: ShiftKey | null) => b.groups.find((x) => x.shift === s);

// ── 7. single assignee → individual ──
{
  const b = buildBoard("2026-11-17", [T({ assignees: [ann] })], 0, false);
  check("solo → individual", g(b, "1st")!.individuals.length === 1 && g(b, "1st")!.teams.length === 0);
  check("solo → person id", g(b, "1st")!.individuals[0].user_id === "u-ann");
}

// ── 8. same pair, reversed order → one team block, ordered by slot ──
{
  const b = buildBoard("2026-11-17", [
    T({ id: "late", title: "Late", assignees: [bob, ann], slot_start: "10:00", slot_end: "11:00",
        jobs: [{ job_id: "j1", invoice_number: "12345", customer: "Acme" }, { job_id: "j2", invoice_number: null, customer: null }] }),
    T({ id: "early", title: "Early", assignees: [ann, bob], slot_start: "06:00", slot_end: "08:00", template_id: "tpl" }),
  ], 0, false);
  const teams = g(b, "1st")!.teams;
  check("pair: one block", teams.length === 1);
  check("pair: two tasks ordered by slot", eq(teams[0].tasks.map((t) => t.id), ["early", "late"]));
  check("pair: key sorted ids", teams[0].key === "u-ann|u-bob");
  check("pair: names", teams[0].names === "Ann & Bob");
  check("pair: invoices non-null only", eq(teams[0].tasks[1].invoices, ["12345"]));
  check("pair: repeatable flag", teams[0].tasks[0].repeatable === true && teams[0].tasks[1].repeatable === false);
  check("pair: slot_label", teams[0].tasks[0].slot_label === "6:00a–8:00a");
  check("pair: no sort_order leak", !("sort_order" in (teams[0].tasks[0] as object)));
}

// ── 9. person in a team task and a solo task → both blocks ──
{
  const b = buildBoard("2026-11-17", [T({ assignees: [ann, bob] }), T({ assignees: [ann] })], 0, false);
  check("both: team block", g(b, "1st")!.teams.length === 1);
  check("both: own block", g(b, "1st")!.individuals.map((p) => p.user_id).join() === "u-ann");
  check("both: counts", b.task_count === 2 && b.people_count === 2);
}

// ── 10. mixed-shift team → 1st group, members 1st then 2nd ──
{
  const b = buildBoard("2026-11-17", [T({ assignees: [cat, ann] })], 0, false);
  const t = g(b, "1st")!.teams;
  check("mixed: in 1st", t.length === 1 && g(b, "2nd")!.teams.length === 0);
  check("mixed: members order", eq(t[0].members.map((m) => m.id), ["u-ann", "u-cat"]));
  check("mixed: shifts", eq(t[0].shifts, ["1st", "2nd"]));
}

// ── 11. all-2nd team → 2nd; two no-shift → No shift set ──
{
  const b = buildBoard("2026-11-17", [T({ assignees: [dan, cat] }), T({ assignees: [eve, fay] })], 0, false);
  check("all-2nd: in 2nd", g(b, "2nd")!.teams.length === 1 && g(b, "2nd")!.teams[0].names === "Cat & Dan");
  const none = g(b, null);
  check("no-shift team: null group", !!none && none.teams.length === 1 && none.label === "No shift set" && none.hours === null);
  check("groups order 1st, 2nd, none", eq(b.groups.map((x) => x.shift), ["1st", "2nd", null]));
}

// ── 12. '3rd' user solo → No shift set ──
{
  const b = buildBoard("2026-11-17", [T({ assignees: [isr] })], hm("07:00"), true);
  check("3rd: null group", g(b, null)?.individuals[0]?.user_id === "u-isr");
  check("3rd: null group status null", g(b, null)?.status === null);
}

// ── 13. crew_name ──
{
  const b1 = buildBoard("d", [T({ assignees: [ann, bob], crew_name: "Pack crew" }), T({ assignees: [bob, ann], crew_name: "Pack crew" })], 0, false);
  check("crew: all same → set", g(b1, "1st")!.teams[0].crew_name === "Pack crew");
  const b2 = buildBoard("d", [T({ assignees: [ann, bob], crew_name: "Pack crew" }), T({ assignees: [ann, bob] })], 0, false);
  check("crew: one missing → null", g(b2, "1st")!.teams[0].crew_name === null);
  const b3 = buildBoard("d", [T({ assignees: [ann, bob], crew_name: "A" }), T({ assignees: [ann, bob], crew_name: "B" })], 0, false);
  check("crew: differing → null", g(b3, "1st")!.teams[0].crew_name === null);
}

// ── 14. NULL slots last; team order earliest slot then names ──
{
  const b = buildBoard("d", [
    T({ id: "n1", title: "Zed", assignees: [ann] }),
    T({ id: "s1", title: "Slot", assignees: [ann], slot_start: "09:00", slot_end: "10:00" }),
    T({ id: "n0", title: "Alpha", assignees: [ann], sort_order: 999 }),
    // team ann+bob: no slot; team ann+cat: 08:00; team bob+cat: 08:00 (names tie-break: "Ann & Cat" < "Bob & Cat")
    T({ id: "ab", assignees: [ann, bob] }),
    T({ id: "bc", assignees: [bob, cat], slot_start: "08:00", slot_end: "09:00" }),
    T({ id: "ac", assignees: [ann, cat], slot_start: "08:00", slot_end: "09:00" }),
  ], 0, false);
  const ind = g(b, "1st")!.individuals[0];
  check("null slot last", eq(ind.tasks.map((t) => t.id), ["s1", "n1", "n0"]), JSON.stringify(ind.tasks.map((t) => t.id)));
  check("team order", eq(g(b, "1st")!.teams.map((t) => t.names), ["Ann & Cat", "Bob & Cat", "Ann & Bob"]),
    JSON.stringify(g(b, "1st")!.teams.map((t) => t.names)));
}

// ── individual order by name, case-insensitive ──
{
  const b = buildBoard("d", [T({ assignees: [P("z", "zack", "1st")] }), T({ assignees: [P("y", "Amy", "1st")] }), T({ assignees: [P("x", "bea", "1st")] })], 0, false);
  check("individuals by name ci", eq(g(b, "1st")!.individuals.map((p) => p.name), ["Amy", "bea", "zack"]));
}

// ── 15. empty input ──
{
  const b = buildBoard("2026-11-21", [], hm("07:00"), true);
  check("empty: 2 groups", eq(b.groups.map((x) => x.shift), ["1st", "2nd"]));
  check("empty: blocks empty", b.groups.every((x) => x.teams.length === 0 && x.individuals.length === 0));
  check("empty: counts 0", b.task_count === 0 && b.people_count === 0);
  check("empty: today statuses", b.groups[0].status === "on" && b.groups[1].status === "upcoming");
  check("hours label", b.groups[0].hours === "6:00a – 2:30p" && b.groups[1].hours === "2:00p – 10:30p");
}

// ── 16. isToday=false → statuses null ──
{
  const b = buildBoard("d", [T({ assignees: [ann] }), T({ assignees: [cat] }), T({ assignees: [eve] })], hm("07:00"), false);
  check("not today: all statuses null", b.groups.length === 3 && b.groups.every((x) => x.status === null));
}

// ── 17. zero-assignee task skipped ──
{
  let threw = false;
  let b: ReturnType<typeof buildBoard> | null = null;
  try { b = buildBoard("d", [T({ assignees: [] }), T({ assignees: [ann] })], 0, false); } catch { threw = true; }
  check("zero assignees: no throw", !threw);
  check("zero assignees: skipped", !!b && b.task_count === 1 && b.people_count === 1);
}

console.log(`board selfcheck: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
