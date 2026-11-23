// src/lib/cutting/blockIds.selfcheck.ts — cc-blocks-01
// Self-check for blockIds.ts. Run with: npx tsx cutting-pilot/src/lib/cutting/blockIds.selfcheck.ts
// (any cwd). Exits 1 on any failure.
import { BLOCK_ID_HINT, checkBlockIdsBody, normalizeBlockId, parseBlockIdList } from "./blockIds";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  results.push({ name, pass: a === e, detail: `got ${a}, expected ${e}` });
}

eq("hint", BLOCK_ID_HINT, "MM/DD-XX");
eq("canonical 11/20-07", normalizeBlockId("11/20-07"), "11/20-07");
eq("pads 1/5-3", normalizeBlockId("1/5-3"), "01/05-03");
eq("spaces 11/20 - 7", normalizeBlockId("11/20 - 7"), "11/20-07");
eq("trims", normalizeBlockId("  11/20-07 \n"), "11/20-07");
eq("3-digit seq kept", normalizeBlockId("11/20-123"), "11/20-123");
eq("month 13 → null", normalizeBlockId("13/01-01"), null);
eq("month 0 → null", normalizeBlockId("00/01-01"), null);
eq("day 32 → null", normalizeBlockId("11/32-01"), null);
eq("day 0 → null", normalizeBlockId("11/00-01"), null);
eq("seq 0 → null", normalizeBlockId("11/20-0"), null);
eq("seq 4 digits → null", normalizeBlockId("11/20-1234"), null);
eq("no seq 11/20 → null", normalizeBlockId("11/20"), null);
eq("empty → null", normalizeBlockId(""), null);
eq("bare 123 → null", normalizeBlockId("123"), null);
eq("letters → null", normalizeBlockId("ab/cd-ef"), null);

{
  const r = parseBlockIdList("11/20-07, 11/20-8\n11/20-07; junk 1/5-3  11/20 - 9 123 junk");
  eq("list ids normalized + de-duped in order", r.ids, ["11/20-07", "11/20-08", "01/05-03", "11/20-09"]);
  eq("list invalid de-duped", r.invalid, ["junk", "123"]);
}
eq("empty list", parseBlockIdList(""), { ids: [], invalid: [] });
eq("whitespace list", parseBlockIdList("  \n ,; "), { ids: [], invalid: [] });

eq("body missing → []", checkBlockIdsBody(undefined), { ok: true, ids: [] });
eq("body valid normalized", checkBlockIdsBody(["11/20-7", "1/5-3"]), { ok: true, ids: ["11/20-07", "01/05-03"] });
eq("body invalid listed", checkBlockIdsBody(["11/20-07", "11/32-01", 5]), { ok: false, error: "invalid_block_id", invalid: ["11/32-01", "5"] });
eq("body dupes after normalize", checkBlockIdsBody(["11/20-7", "11/20-07"]), { ok: false, error: "duplicate_in_request", duplicates: ["11/20-07"] });
eq("body non-array", checkBlockIdsBody("11/20-07"), { ok: false, error: "invalid_block_id", invalid: ["11/20-07"] });

const failed = results.filter((r) => !r.pass);
for (const f of failed) console.log(`FAIL ${f.name}: ${f.detail}`);
console.log(`blockIds selfcheck: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
