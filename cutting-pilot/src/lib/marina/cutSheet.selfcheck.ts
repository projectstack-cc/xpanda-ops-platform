// src/lib/marina/cutSheet.selfcheck.ts — marina-05
// Self-check for the cut-sheet suggestion rules (cutSheet.ts), run on the REAL fixtures (pdf.js text
// items dumped from Piper's sheets — text only, never the PDFs). No DB, no network.
// Run with: npx tsx src/lib/marina/cutSheet.selfcheck.ts   (from cutting-pilot/). Exits 1 on any failure.
import { fallbackLabelFor, suggestFromPage, textItemsFromContent, type PageSuggestion, type TextItem } from "./cutSheet";
import d6l from "./fixtures/d6-l.json";
import d7cr from "./fixtures/d7-cr.json";
import d7l from "./fixtures/d7-l.json";
import mt2095 from "./fixtures/marinetek-2095.json";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}

interface Fixture { file: string; pages: { page_no: number; items: TextItem[] }[]; }
const FIXTURES: { fx: Fixture; prefix: string }[] = [
  { fx: d7cr, prefix: "BMM D7 CR" },
  { fx: d7l, prefix: "BMM D7 L" },
  { fx: d6l, prefix: "BMM D6 L" },
  { fx: mt2095, prefix: "2095" },
];

const suggest = (fx: Fixture, n: number): PageSuggestion => {
  const page = fx.pages.find((p) => p.page_no === n)!;
  return suggestFromPage(page.items, fallbackLabelFor(fx.file, n));
};
const values = (s: PageSuggestion) => s.chips.map((c) => c.value_in);
const hasValue = (s: PageSuggestion, v: number) => s.chips.some((c) => Math.abs(c.value_in - v) < 1e-9);

// ── Every fixture page ───────────────────────────────────────────────────────────────────────
for (const { fx, prefix } of FIXTURES) {
  for (const page of fx.pages) {
    const s = suggest(fx, page.page_no);
    const tag = `${fx.file} p${page.page_no}`;
    eq(`${tag}: label read from text`, [s.label, s.labelFromText], [`${prefix} ${page.page_no}`, true]);
    check(`${tag}: hasText`, s.hasText);
    check(`${tag}: has chips`, s.chips.length > 0, JSON.stringify(s.chips));
    // No chip from a letter-bearing item: every chip's text must equal a letter-free item (or merge of two).
    const letterFree = new Set(page.items.map((i) => i.str.replace(/\s+/g, " ").trim()).filter((t) => t && !/[a-z]/i.test(t)));
    check(`${tag}: no chip from a letter-bearing item`, s.chips.every((c) => letterFree.has(c.text)), JSON.stringify(s.chips));
    const labelNums = s.label.split(" ").filter((p) => /^\d+$/.test(p)).map(Number);
    check(`${tag}: no label number as a chip`, labelNums.every((n) => !hasValue(s, n)), JSON.stringify({ labelNums, chips: values(s) }));
    eq(`${tag}: chips sorted descending`, values(s), [...values(s)].sort((a, b) => b - a));
  }
}

// ── Named pages ──────────────────────────────────────────────────────────────────────────────
{
  const s = suggest(d7l, 1);
  eq("BMM D7 L 1: label", s.label, "BMM D7 L 1");
  eq("BMM D7 L 1: chips are exactly {147.5, 56, 41.375}", values(s), [147.5, 56, 41.375]);
  eq("BMM D7 L 1: chip texts as printed", s.chips.map((c) => c.text), ["147 1/2", "56", "41 3/8"]);
  eq("BMM D7 L 1: no notes", s.notes, "");
}
{
  const s = suggest(mt2095, 1);
  eq("2095 1: label (not the TOP2 view)", s.label, "2095 1");
  for (const v of [36.5, 22.5, 5, 36]) check(`2095 1: chips include ${v}`, hasValue(s, v), JSON.stringify(values(s)));
  check("2095 1: 2095 and 1 are not chips", !hasValue(s, 2095) && !hasValue(s, 1));
}
{
  const s = suggest(mt2095, 3);
  eq("2095 3: label despite CUT TIME on the same baseline", s.label, "2095 3");
  check("2095 3: notes contain REPLACE", /REPLACE/.test(s.notes), s.notes);
  eq("2095 3: notes deduped, print order", s.notes, "REPLACE 6\nREPLACE 6 1/2");
  check("2095 3: REPLACE 6 1/2 is not a 6.5 chip", !hasValue(s, 6.5), JSON.stringify(values(s)));
  check("2095 3: 3 (label) is not a chip", !hasValue(s, 3));
}
eq("BMM D7 CR 2: OCR 'NO FIRE' becomes a note", suggest(d7cr, 2).notes, "NO FIRE");
eq("BMM D6 L 2: 'NO FILE' becomes a note", suggest(d6l, 2).notes, "NO FILE");
eq("BMM D7 CR 1: OCR 'CUT TIRE' ignored (no notes)", suggest(d7cr, 1).notes, "");

// ── Synthetic ────────────────────────────────────────────────────────────────────────────────
{
  const s = suggestFromPage([], "D7 CR 3");
  eq("empty items → no text, no chips, fallback label", s, { label: "D7 CR 3", labelFromText: false, chips: [], notes: "", hasText: false });
  const ws = suggestFromPage([{ str: " ", x: 0, y: 0, w: 900, h: 10 }, { str: "", x: 5, y: 5, w: 0, h: 0 }], "X 1");
  eq("whitespace-only items → hasText false", [ws.hasText, ws.chips.length, ws.labelFromText], [false, 0, false]);
}
{
  const h = 16;
  const it = (str: string, x: number, w: number, y = 100): TextItem => ({ str, x, y, w, h });
  // Merge: "41" ends at 116, "3/8" starts at 120 (gap 4 ≤ h) → "41 3/8".
  const m = suggestFromPage([it("41", 100, 16), it("3/8", 120, 24)], "P 1");
  eq("merge: 41 + 3/8 → 41 3/8", m.chips, [{ value_in: 41.375, text: "41 3/8" }]);
  // Too far apart (gap 40 > h) → two separate chips; the bare fraction parses as 3/8.
  const far = suggestFromPage([it("41", 100, 16), it("3/8", 156, 24)], "P 1");
  eq("merge: fraction beyond 1×h stays separate", far.chips.map((c) => c.text), ["41", "3/8"]);
  // Different baseline → no merge.
  const off = suggestFromPage([it("41", 100, 16), it("3/8", 120, 24, 60)], "P 1");
  eq("merge: other baseline stays separate", off.chips.map((c) => c.text), ["41", "3/8"]);
  // Hyphen form + decimal + dedupe by 1/16 (first printed wins) + > 2000 and 0 dropped + letters never chips.
  const mix = suggestFromPage([
    it("12-1/2", 10, 40, 300), it("12.5", 10, 30, 260), it("2500", 10, 30, 220), it("0", 10, 8, 180),
    it("6 in", 10, 30, 140), it("A12", 10, 30, 120),
  ], "P 1");
  eq("hyphen normalized, 1/16 dedupe, 0 / >2000 / letters dropped", mix.chips, [{ value_in: 12.5, text: "12 1/2" }]);
  // Label: needs whitespace before TOP; DESKTOP is not a label.
  eq("label needs whitespace before TOP", suggestFromPage([it("DESKTOP", 10, 60)], "F 2").labelFromText, false);
  eq("label inner spaces collapsed", suggestFromPage([it("HM  D7   L 4 TOP", 10, 120)], "F 4").label, "HM D7 L 4");
}

// ── fallbackLabelFor / textItemsFromContent ──────────────────────────────────────────────────
eq("fallbackLabelFor D7 CR.pdf 3", fallbackLabelFor("D7 CR.pdf", 3), "D7 CR 3");
eq("fallbackLabelFor .PDF + spaces", fallbackLabelFor("  BMM  D6 L.PDF ", 2), "BMM D6 L 2");
eq("fallbackLabelFor null", fallbackLabelFor(null, 1), "Page 1");
eq("textItemsFromContent maps + rounds, skips marked content",
  textItemsFromContent([
    { str: "41 3/8", transform: [16.1, 0, 0, 16.1, 906.6249, 459.83], width: 42.41, height: 0 },
    { type: "beginMarkedContent" },
  ]),
  [{ str: "41 3/8", x: 906.6, y: 459.8, w: 42.4, h: 16.1 }]);

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  (${r.detail})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
