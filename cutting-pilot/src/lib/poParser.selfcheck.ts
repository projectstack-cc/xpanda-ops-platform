// Guarded dev self-check for the PO parser (P323). Not part of the production build path —
// invoked once from BlocksApp in a NODE_ENV !== "production" effect and logged to console.
//
// IMPORTANT LIMITATION: the real "PO#1" spreadsheet this format was hand-validated against
// (expected per-density baseline: 1# = 18 SKUs / 302 pcs, 1.5# = 13 SKUs / 74 pcs,
// 2# = 16 SKUs / 59 pcs) is not present in this repo. This self-check verifies every messy
// variant case called out in the P323 prompt text, plus the combine/normalize behavior those
// counts depend on, against hand-built fixtures — it does NOT reproduce the exact PO#1 totals,
// and does not claim to. Feed the real PO#1 file through the parser once available to confirm
// the baseline numbers.
import { parsePoRows, parseSkuDescription } from "./poParser";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function approxEq(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

export function runPoParserSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];

  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  // --- Messy variant parsing (verbatim cases from the P323 prompt) ---
  const cases: Array<{
    desc: string;
    expect: { width: number; length: number; tlo: number; thi: number; density: number } | null;
  }> = [
    {
      desc: "50 x (2 x 4) x 96 - 1.5#",
      expect: { width: 50, length: 96, tlo: 2, thi: 4, density: 1.5 },
    },
    {
      desc: "40 X ( 3x5 ) X 90 - 2#",
      expect: { width: 40, length: 90, tlo: 3, thi: 5, density: 2 },
    },
    {
      // Missing the "x" before D — length still parses as 84.25.
      desc: '41.25 X (4X2) 84.25 - 1.5#',
      expect: { width: 41.25, length: 84.25, tlo: 2, thi: 4, density: 1.5 },
    },
    {
      // No "#".
      desc: "46.13 x (3x4) x 92.25 - 1.5",
      expect: { width: 46.13, length: 92.25, tlo: 3, thi: 4, density: 1.5 },
    },
    {
      // No "#", short density.
      desc: "40 x (3x4) x 90 - 2",
      expect: { width: 40, length: 90, tlo: 3, thi: 4, density: 2 },
    },
    {
      // Trailing notes / newline after density — must be ignored.
      desc: "39.25 X (4X2) X 80.25 - 2#\nSchedule pickup Monday",
      expect: { width: 39.25, length: 80.25, tlo: 2, thi: 4, density: 2 },
    },
    {
      // Trailing (MISC) suffix — must be ignored.
      desc: "40 x (4x2) x 90 - 2#(MISC)",
      expect: { width: 40, length: 90, tlo: 2, thi: 4, density: 2 },
    },
    {
      // Genuinely undecodable — must fall back to null (unparsed), not throw/guess.
      desc: "N/A — see attached spec sheet",
      expect: null,
    },
  ];

  for (const c of cases) {
    const got = parseSkuDescription(c.desc);
    if (c.expect === null) {
      check(`parse: "${c.desc.slice(0, 40)}..."`, got === null, got ? JSON.stringify(got) : undefined);
      continue;
    }
    const ok =
      !!got &&
      approxEq(got.width, c.expect.width) &&
      approxEq(got.length, c.expect.length) &&
      approxEq(got.tlo, c.expect.tlo) &&
      approxEq(got.thi, c.expect.thi) &&
      approxEq(got.density, c.expect.density);
    check(
      `parse: "${c.desc.slice(0, 40).replace(/\n/g, "\\n")}..."`,
      ok,
      ok ? undefined : `got ${JSON.stringify(got)}, expected ${JSON.stringify(c.expect)}`
    );
  }

  // --- Combine/normalize: a taper-order flip (4x2 vs 2x4) is the same SKU, qty sums ---
  const combined = parsePoRows([
    { item: "A1", desc: "40 x (4 x 2) x 90 - 2#", qty: 3 },
    { item: "A1", desc: "40 x (2 x 4) x 90 - 2#", qty: 5 },
  ]);
  check(
    "combine: 4x2 and 2x4 normalize to one SKU, qty sums",
    combined.length === 1 && combined[0].qty === 8 && combined[0].tlo === 2 && combined[0].thi === 4,
    JSON.stringify(combined)
  );

  // --- Unparsed rows are kept individually, never dropped ---
  const withUnparsed = parsePoRows([
    { item: "B1", desc: "50 x (2 x 4) x 96 - 1.5#", qty: 2 },
    { item: "B2", desc: "garbage row, no format match", qty: 4 },
  ]);
  check(
    "unparsed rows kept (not dropped) and flagged",
    withUnparsed.length === 2 && withUnparsed.some((r) => !r.parsed && r.qty === 4),
    JSON.stringify(withUnparsed)
  );

  // --- PO#1 exact baseline (1# = 18/302, 1.5# = 13/74, 2# = 16/59) — NOT checked here.
  // See the file-level comment: the real PO#1 spreadsheet isn't available in this repo.
  check(
    "PO#1 baseline reconciliation (18/302, 13/74, 16/59)",
    true,
    "SKIPPED — real PO#1 file not available; not asserted against fabricated data"
  );

  return { pass: results.every((r) => r.pass), results };
}
