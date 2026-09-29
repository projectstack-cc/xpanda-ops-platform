// src/lib/productionCsv.selfcheck.ts
// Guarded dev self-check for productionCsv.ts (toCsv only — downloadCsv needs a DOM). Mirrors
// productionNumbering.selfcheck.ts's shape. Not part of the production build path.
import { toCsv } from "./productionCsv";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export function runProductionCsvSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });

  const plain = toCsv(["a", "b"], [["x", 1]]);
  check("plain + CRLF", plain === "a,b\r\nx,1\r\n", JSON.stringify(plain));

  const comma = toCsv(["a"], [["x,y"]]);
  check("comma quoted", comma === 'a\r\n"x,y"\r\n', JSON.stringify(comma));

  const quote = toCsv(["a"], [['say "hi"']]);
  check("embedded quotes doubled", quote === 'a\r\n"say ""hi"""\r\n', JSON.stringify(quote));

  const nl = toCsv(["a"], [["line1\nline2"], ["cr\rx"]]);
  check("newline / CR quoted", nl === 'a\r\n"line1\nline2"\r\n"cr\rx"\r\n', JSON.stringify(nl));

  const nul = toCsv(["a", "b", "c"], [[null, undefined, 0]]);
  check("null/undefined empty, 0 kept", nul === "a,b,c\r\n,,0\r\n", JSON.stringify(nul));

  return { pass: results.every((r) => r.pass), results };
}
