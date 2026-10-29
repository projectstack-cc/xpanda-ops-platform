// scripts/packing-slip-parity.mjs
// slip-parse-04: packing-slip parser harness — runs BOTH parsers on every committed fixture in
// src/lib/packingSlipFixtures.ts (scrubbed raw pdf.js items, no PDFs, no pdf.js, no network):
//   - legacy  jobs/packing-slip-parser.js  (loaded in node:vm, window.PackingSlipParser._internal.parseDoc)
//   - v2      src/lib/packingSlip.ts       (_internal.parseDoc)
// For each fixture it checks the fixture's `expect` against EACH parser, then a legacy↔v2 parity
// check on the normalized line items + doc-level offload-zone output (slip-parse-05). Plus a
// v2-only Holey Board dims check on INV 4466 (hbSlipDims → 48" x 24" x <thk>", Σ bdftPerPiece × qty
// == 5612). Exit code 1 on any failure.
//
// Any change to either packing-slip parser must pass this harness.
//
// Run with: node scripts/packing-slip-parity.mjs   (from cutting-pilot/; Node 22.6+/23.6+ strips the
// fixtures' / packingSlip.ts's TypeScript syntax natively — no build step needed).
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { SLIP_FIXTURES } from "../src/lib/packingSlipFixtures.ts";
import { _internal as v2 } from "../src/lib/packingSlip.ts";
import { hbSlipDims } from "../src/lib/partMatch.ts";
import { bdftPerPiece } from "../src/lib/bdft.ts";

const here = dirname(fileURLToPath(import.meta.url));
const legacyPath = join(here, "..", "..", "jobs", "packing-slip-parser.js");

// ── Load the legacy parser (an IIFE that assigns window.PackingSlipParser) ──
const legacySrc = await readFile(legacyPath, "utf8");
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(legacySrc, ctx, { filename: "packing-slip-parser.js" });
const legacyParseDoc = ctx.window.PackingSlipParser?._internal?.parseDoc;
if (typeof legacyParseDoc !== "function") {
  console.error("FAIL: could not load window.PackingSlipParser._internal.parseDoc from the legacy parser");
  process.exit(1);
}

// Both parsers mutate their input order/objects in places — always hand each a fresh deep copy.
// `page: 1` matches what parsePackingSlip() attaches to every pdf.js item.
const rawCopy = (items) => items.map((it) => ({ ...it, page: 1 }));
// Round-trip through JSON so vm-realm objects compare structurally with this realm's objects.
const plain = (v) => JSON.parse(JSON.stringify(v));

function normItem(li) {
  return {
    category: li.category ?? "",
    description: li.description ?? "",
    dimensions: li.dimensions ?? "",
    quantity: li.quantity,
    qty_unit: li.qty_unit,
    thickness: li.thickness ?? null,
    facer_missing: li.facer_missing ?? false,
    // slip-parse-05: offload zones + density conflicts.
    offload_seq: li.offload_seq ?? null,
    zone_label: li.zone_label ?? null,
    zone_bdft: li.zone_bdft ?? null,
    density_conflict: li.density_conflict ?? null,
  };
}

function normDoc(doc) {
  return {
    invoice_number: doc.invoice_number,
    offload_zones_enabled: doc.offload_zones_enabled ?? 0,
    offload_warnings: doc.offload_warnings ?? [],
    line_items: (doc.line_items || []).map(normItem),
  };
}

const fmt = (v) => JSON.stringify(v);

// Field-level diff between two normalized docs (or expectation vs normalized doc).
function diffDocs(a, b, aName, bName) {
  const out = [];
  for (const k of Object.keys(a)) {
    if (k === "line_items") continue;
    if (fmt(a[k]) !== fmt(b[k])) out.push(`${k}: ${aName}=${fmt(a[k])} ${bName}=${fmt(b[k])}`);
  }
  if (a.line_items.length !== b.line_items.length) {
    out.push(`line_items.length: ${aName}=${a.line_items.length} ${bName}=${b.line_items.length}`);
  }
  const n = Math.min(a.line_items.length, b.line_items.length);
  for (let i = 0; i < n; i++) {
    for (const k of Object.keys(a.line_items[i])) {
      const av = a.line_items[i][k];
      const bv = b.line_items[i][k];
      if (fmt(av) !== fmt(bv)) out.push(`line_items[${i}].${k}: ${aName}=${fmt(av)} ${bName}=${fmt(bv)}`);
    }
  }
  return out;
}

// Check a fixture's `expect` (only the fields it lists) against one parser's normalized output.
function checkExpect(expect, got, who) {
  const out = [];
  for (const k of Object.keys(expect)) {
    if (k === "line_items") continue;
    if (fmt(expect[k]) !== fmt(got[k])) out.push(`[${who}] ${k}: expected ${fmt(expect[k])} got ${fmt(got[k])}`);
  }
  if (expect.line_items.length !== got.line_items.length) {
    out.push(`[${who}] line_items.length: expected ${expect.line_items.length} got ${got.line_items.length}`);
  }
  const n = Math.min(expect.line_items.length, got.line_items.length);
  for (let i = 0; i < n; i++) {
    for (const k of Object.keys(expect.line_items[i])) {
      const ev = expect.line_items[i][k];
      const gv = got.line_items[i][k];
      if (fmt(ev) !== fmt(gv)) out.push(`[${who}] line_items[${i}].${k}: expected ${fmt(ev)} got ${fmt(gv)}`);
    }
  }
  return out;
}

const rows = [];
let failed = false;

for (const fx of SLIP_FIXTURES) {
  const legacy = normDoc(plain(legacyParseDoc(rawCopy(fx.items))));
  const v2Doc = plain(v2.parseDoc(rawCopy(fx.items)));
  const next = normDoc(v2Doc);

  const expLegacy = checkExpect(fx.expect, legacy, "legacy");
  const expV2 = checkExpect(fx.expect, next, "v2");
  const parity = diffDocs(legacy, next, "legacy", "v2");

  const extra = [];
  let hbChecked = false;
  // v2-only HB dims check on the real 4466 slip (not the bad-checksum variant).
  if (fx.expect.invoice_number === "4466" && fx.expect.line_items.length === 4) {
    hbChecked = true;
    let total = 0;
    v2Doc.line_items.forEach((li, i) => {
      const dims = hbSlipDims(li);
      const want = `48" x 24" x ${li.thickness}"`;
      if (dims !== want) extra.push(`[v2 hbSlipDims] line_items[${i}]: expected ${fmt(want)} got ${fmt(dims)}`);
      total += (bdftPerPiece(dims) ?? 0) * li.quantity;
    });
    if (Math.round(total) !== 5612) extra.push(`[v2 hbSlipDims] Σ bdft×qty: expected 5612 got ${total}`);
  }

  const ok = !expLegacy.length && !expV2.length && !parity.length && !extra.length;
  if (!ok) failed = true;
  rows.push({
    name: fx.name,
    items: `${legacy.line_items.length}/${next.line_items.length}`,
    legacy: expLegacy.length ? "FAIL" : "PASS",
    v2: expV2.length ? "FAIL" : "PASS",
    parity: parity.length ? "FAIL" : "PASS",
    extra: !hbChecked ? "-" : extra.length ? "FAIL" : "PASS",
    details: [...expLegacy, ...expV2, ...parity.map((d) => `[parity] ${d}`), ...extra],
  });
}

// ── slip-parse-07: spaced-fraction unit cases ──
// Each case swaps the text of INV 4550's `FOAM-HT4040-4 ~ 37.5X37.5X2 1/4` line (qty 200, line_items[4])
// and checks that line's dimensions from BOTH parsers. "TAPERED" in the text makes withTaperLead apply.
const fx4550 = SLIP_FIXTURES.find((f) => f.expect.invoice_number === "4550");
const UNIT_CASES = [
  ["41 3/8 x 48 x 96", "41-3/8 x 48 x 96"],
  ['54-3/4" x 90-3/4" x 8"', '54-3/4" x 90-3/4" x 8"'],
  ["33.5 X 45.5 X 2.625", "33.5 X 45.5 X 2.625"],
  ["39.5X39.5X2.625", "39.5X39.5X2.625"],
  ['TAPERED 2.5" - 4" x 39" x 80"', '2.5>4" x 39" x 80"'],
  ['TAPERED 2 1/2" - 4" x 39" x 80"', '2-1/2>4" x 39" x 80"'],
];
for (const [text, want] of UNIT_CASES) {
  const items = fx4550.items.map((it) => (it.text === "FOAM-HT4040-4 ~ 37.5X37.5X2 1/4" ? { ...it, text } : it));
  const gotL = plain(legacyParseDoc(rawCopy(items))).line_items[4]?.dimensions;
  const gotV = plain(v2.parseDoc(rawCopy(items))).line_items[4]?.dimensions;
  const details = [];
  if (gotL !== want) details.push(`[legacy] expected ${fmt(want)} got ${fmt(gotL)}`);
  if (gotV !== want) details.push(`[v2] expected ${fmt(want)} got ${fmt(gotV)}`);
  if (details.length) failed = true;
  rows.push({
    name: `unit: ${text}`,
    items: "1/1",
    legacy: gotL === want ? "PASS" : "FAIL",
    v2: gotV === want ? "PASS" : "FAIL",
    parity: gotL === gotV ? "PASS" : "FAIL",
    extra: "-",
    details,
  });
}

// ── Report ──
const cols = ["name", "items", "legacy", "v2", "parity", "extra"];
const heads = { name: "fixture", items: "items L/v2", legacy: "expect:legacy", v2: "expect:v2", parity: "parity", extra: "hb-dims" };
const widths = Object.fromEntries(cols.map((c) => [c, Math.max(heads[c].length, ...rows.map((r) => String(r[c]).length))]));
const line = (r) => cols.map((c) => String(r[c]).padEnd(widths[c])).join(" | ");
console.log(line(heads));
console.log(cols.map((c) => "-".repeat(widths[c])).join("-+-"));
for (const r of rows) {
  console.log(line(r));
  for (const d of r.details) console.log(`    ${d}`);
}
console.log(failed ? "\nFAIL" : `\nPASS — ${rows.length} fixtures`);
process.exit(failed ? 1 : 0);
