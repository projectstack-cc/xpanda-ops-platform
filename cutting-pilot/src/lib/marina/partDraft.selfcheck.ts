// src/lib/marina/partDraft.selfcheck.ts — marina-fix-01
// Self-check for the pure part-editor draft logic (partDraft.ts). No DB, no network.
// Run with: npx tsx src/lib/marina/partDraft.selfcheck.ts   (from cutting-pilot/). Exits 1 on any failure.
import {
  autoOtherName, checkDraft, chipUseCount, dimName, dimsPayload, draftFromPart, firstProblem, newRow, withName,
  type DimRowState, type EditorFields, type PartDraft,
} from "./partDraft";
import type { MarinaPartSummary } from "./types";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}

// Every (draft, fields) built below, for the firstProblem ⇔ checkDraft invariant at the end.
const cases: { name: string; d: PartDraft; f: EditorFields }[] = [];
function fp(name: string, d: PartDraft, f: EditorFields, expected: string | null) {
  cases.push({ name, d, f });
  eq(name, firstProblem(d, f), expected);
}

function rowsOf(n: number): DimRowState[] {
  const dims: DimRowState[] = [];
  for (let i = 0; i < n; i++) dims.push(newRow(dims, String(10 + i)));
  return dims;
}
const draft = (dims: DimRowState[], label = "Part A"): PartDraft => ({ label, notes: "", dims });
const names = (dims: DimRowState[]) => dims.map((r) => `${r.name}/${dimName(r)}`);

// ── newRow: L, W, H, then auto-named Other ───────────────────────────────────────────────────
{
  const dims: DimRowState[] = [];
  for (let i = 0; i < 4; i++) dims.push(newRow(dims));
  eq("4 newRows → L, W, H, Other/Dim 4", names(dims), ["L/L", "W/W", "H/H", "Other/Dim 4"]);
  const blank = draft(dims);
  check("blank values → not ok", !checkDraft(blank, "all").ok);
  cases.push({ name: "blank values", d: blank, f: "all" });
  const filled = draft(dims.map((r, i) => ({ ...r, text: `${12 + i}` })));
  check("4 rows with values → ok", checkDraft(filled, "all").ok);
  fp("4 rows with values → no problem", filled, "all", null);
  eq("dimsPayload sends Dim 4", dimsPayload(filled).map((x) => x.label), ["L", "W", "H", "Dim 4"]);
  const fifth = newRow(dims);
  eq("5th newRow → Dim 5", `${fifth.name}/${dimName(fifth)}`, "Other/Dim 5");
}
{
  const dims = rowsOf(3);
  dims.push({ ...newRow([]), name: "Other", other: "Dim 4", text: "5" });
  const r = newRow(dims);
  eq("Dim 4 taken (index 4 → Dim 5)", dimName(r), "Dim 5");
  // Row at index 3 when "Dim 4" is used elsewhere
  const d2 = rowsOf(3);
  d2[0] = { ...d2[0], name: "Other", other: "dim 4" };
  eq("lowercase dim 4 counts as taken", autoOtherName(d2, 3), "Dim 5");
  const d3 = d2.map((r, i) => (i === 1 ? { ...r, name: "Other" as const, other: "DIM 5" } : r));
  eq("autoOtherName skips several", autoOtherName(d3, 3), "Dim 6");
}

// ── withName ─────────────────────────────────────────────────────────────────────────────────
{
  const dims = rowsOf(3);                                   // L W H
  const k = dims[1].key;
  const a = withName(dims, k, "Other");
  eq("withName → Other prefills empty other", dimName(a[1]), "Dim 2");
  const typed = a.map((r) => (r.key === k ? { ...r, other: "Notch" } : r));
  eq("withName → Other keeps typed", dimName(withName(typed, k, "Other")[1]), "Notch");
  const away = withName(typed, k, "W");
  eq("switch to W → name W", dimName(away[1]), "W");
  eq("switch back to Other keeps typed", dimName(withName(away, k, "Other")[1]), "Notch");
  eq("withName leaves other rows alone", names(withName(dims, k, "Other")).filter((_, i) => i !== 1), ["L/L", "H/H"]);
}

// ── chipUseCount ─────────────────────────────────────────────────────────────────────────────
{
  const dims: DimRowState[] = [];
  eq("chipUseCount 0", chipUseCount(dims, "12"), 0);
  dims.push(newRow(dims, "12", "12"));
  eq("chipUseCount 1", chipUseCount(dims, "12"), 1);
  dims.push(newRow(dims, "12", "12"));
  eq("chipUseCount 2", chipUseCount(dims, "12"), 2);
  eq("two equal chip dims → L, W", names(dims), ["L/L", "W/W"]);
  check("two equal chip dims → ok", checkDraft(draft(dims), "all").ok);
}

// ── draftFromPart ────────────────────────────────────────────────────────────────────────────
{
  const part = {
    label: "P1", notes: null,
    dims: [{ label: "L", nominal_in: 12, nominal_text: "12" }, { label: "Dim 4", nominal_in: 3.5, nominal_text: "3 1/2" }],
  } as unknown as MarinaPartSummary;
  const d = draftFromPart(part);
  eq("draftFromPart L → L", `${d.dims[0].name}/${dimName(d.dims[0])}`, "L/L");
  eq("draftFromPart Dim 4 → Other/Dim 4", `${d.dims[1].name}/${dimName(d.dims[1])}`, "Other/Dim 4");
  eq("draftFromPart round-trips payload", dimsPayload(d), [{ label: "L", nominal_text: "12" }, { label: "Dim 4", nominal_text: "3 1/2" }]);
}

// ── firstProblem: every message, in order ────────────────────────────────────────────────────
{
  const good = rowsOf(4);
  const set = (i: number, patch: Partial<DimRowState>) => good.map((r, j) => (j === i ? { ...r, ...patch } : r));
  fp("label blank", draft(good, "  "), "all", "Label is required.");
  fp("label beats dims", draft([], ""), "all", "Label is required.");
  fp("label ignored for dims", draft(good, ""), "dims", null);
  fp("no dims", draft([]), "all", "Add at least one dim.");
  fp("no dims (dims only)", draft([], ""), "dims", "Add at least one dim.");
  fp("blank Other name", draft(set(3, { other: "  " })), "all", "Dim 4 needs a name.");
  fp("blank size", draft(set(1, { text: " " })), "all", "Dim 2 needs a size.");
  fp("bad size", draft(set(2, { text: "abc" })), "all", 'Dim 3: "abc" isn\'t a measurement.');
  fp("zero size", draft(set(0, { text: "0" })), "all", 'Dim 1: "0" isn\'t a measurement.');
  fp("rows in display order", draft(set(1, { text: "" }).map((r, j) => (j === 3 ? { ...r, other: "" } : r))), "all", "Dim 2 needs a size.");
  fp("name before size on same row", draft(set(3, { other: "", text: "" })), "all", "Dim 4 needs a name.");
  fp("row problem before dup", draft(set(3, { other: "w", text: "x" })), "all", 'Dim 4: "x" isn\'t a measurement.');
  fp("dup names", draft(set(3, { other: "w" })), "all", 'Two dims are named "W".');
  const many = rowsOf(21).map((r, i) => (i >= 3 ? { ...r, other: `Dim ${i + 1}` } : r));
  fp("21 dims", draft(many), "all", "At most 20 dims.");
  fp("20 dims ok", draft(many.slice(0, 20)), "all", null);
  fp("dims ignored for labelNotes", draft([], "P"), "labelNotes", null);
  fp("bad dims ignored for labelNotes", draft(set(1, { text: "" }), "P"), "labelNotes", null);
  fp("label still checked for labelNotes", draft([], ""), "labelNotes", "Label is required.");
}

// ── invariant: firstProblem is null exactly when checkDraft().ok ─────────────────────────────
for (const c of cases) {
  check(`invariant: ${c.name}`, (firstProblem(c.d, c.f) === null) === checkDraft(c.d, c.f).ok);
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  (${r.detail})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
