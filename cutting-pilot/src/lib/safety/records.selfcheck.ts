// saf-01 selfcheck: `npx tsx src/lib/safety/records.selfcheck.ts` (from cutting-pilot/).
import {
  latestByUserBlock, summarize, toCsv, csvCell, CSV_HEADER, isValidYmd, etToday, canManageSafety, insertSelfIfAbsentStmt,
  type CompletionRow, type CsvRow,
} from "./records";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); }
};

let seq = 0;
const row = (o: Partial<CompletionRow>): CompletionRow => ({
  id: `c${++seq}`, user_id: "u1", user_name: "User One", block_id: "block-01", completed_on: "2026-11-01",
  source: "self", recorded_by_id: "u1", recorded_by_name: "User One", note: null, attested: 1,
  voided_at: null, voided_by_name: null, void_reason: null, created_at: "2026-11-01 12:00:00", ...o,
});

// ── latestByUserBlock ──
{
  const rows = [
    row({ id: "old", completed_on: "2026-10-01", created_at: "2026-11-10 09:00:00" }),
    row({ id: "new", completed_on: "2026-11-05", created_at: "2026-11-05 09:00:00", source: "group" }),
    row({ id: "mid", completed_on: "2026-10-20", created_at: "2026-11-12 09:00:00" }),
  ];
  const l = latestByUserBlock(rows);
  check("latest: newest completed_on wins (not newest created_at)", l.get("u1")!.get("block-01")!.id === "new");
  check("latest: source carried", l.get("u1")!.get("block-01")!.source === "group");

  const tie = latestByUserBlock([
    row({ id: "t1", completed_on: "2026-11-05", created_at: "2026-11-05 08:00:00" }),
    row({ id: "t2", completed_on: "2026-11-05", created_at: "2026-11-05 10:00:00" }),
    row({ id: "t0", completed_on: "2026-11-05", created_at: "2026-11-05 09:00:00" }),
  ]);
  check("latest: completed_on tie → newest created_at", tie.get("u1")!.get("block-01")!.id === "t2");

  const v = latestByUserBlock([
    row({ id: "keep", completed_on: "2026-10-01" }),
    row({ id: "void", completed_on: "2026-11-09", voided_at: "2026-11-09 10:00:00" }),
  ]);
  check("latest: voided row ignored", v.get("u1")!.get("block-01")!.id === "keep");
  const onlyVoid = latestByUserBlock([row({ user_id: "u9", voided_at: "x" })]);
  check("latest: user with only voided rows absent", !onlyVoid.has("u9"));

  const multi = latestByUserBlock([
    row({ user_id: "u1", block_id: "block-01" }), row({ user_id: "u1", block_id: "block-02" }),
    row({ user_id: "u2", block_id: "block-01" }),
  ]);
  check("latest: per user × block", multi.get("u1")!.size === 2 && multi.get("u2")!.size === 1);
}

// ── summarize ──
{
  const ready = ["block-01", "block-02", "block-03", "block-04"];
  const rows: CompletionRow[] = [
    ...ready.map((b) => row({ user_id: "a", block_id: b, completed_on: "2026-11-03" })),
    row({ user_id: "b", block_id: "block-01", completed_on: "2026-11-04", source: "group" }),
    row({ user_id: "b", block_id: "block-02", completed_on: "2026-10-30", source: "group" }),
    row({ user_id: "c", block_id: "block-01", completed_on: "2026-11-05", voided_at: "v" }),
    row({ user_id: "outsider", block_id: "block-01", completed_on: "2026-11-05" }),
    row({ user_id: "b", block_id: "block-05", completed_on: "2026-11-06" }),
  ];
  const people = [{ user_id: "a" }, { user_id: "b" }, { user_id: "c" }, { user_id: "d" }];
  const s = summarize(people, latestByUserBlock(rows), ready, "2026-11", rows);
  check("summary people", s.people === 4, JSON.stringify(s));
  check("summary allDone (a)", s.allDone === 1, JSON.stringify(s));
  check("summary noneYet (c voided, d nothing)", s.noneYet === 2, JSON.stringify(s));
  check("summary thisMonth completions (a×4 + b×1; voided, outsider, Oct, not-ready excluded)", s.thisMonth.completions === 5, JSON.stringify(s));
  check("summary thisMonth group", s.thisMonth.group === 1, JSON.stringify(s));
  const empty = summarize([], new Map(), ready, "2026-11");
  check("summary empty", empty.people === 0 && empty.allDone === 0 && empty.noneYet === 0 && empty.thisMonth.completions === 0);
}

// ── CSV ──
{
  check("csv header order", CSV_HEADER.join(",") ===
    "completion_id,completed_on,person,username,roles,block_id,block_title,source,recorded_by,note,recorded_at_utc,voided_at,void_reason");
  check("csv plain", csvCell("abc") === "abc");
  check("csv comma quoted", csvCell("a,b") === '"a,b"');
  check("csv quote doubled", csvCell('say "hi"') === '"say ""hi"""');
  check("csv newline quoted", csvCell("a\nb") === '"a\nb"');
  check("csv null → empty", csvCell(null) === "");
  for (const c of ["=", "+", "-", "@"]) check(`csv guard ${c}`, csvCell(`${c}SUM(A1)`) === `'${c}SUM(A1)`, csvCell(`${c}SUM(A1)`));
  check("csv guard + quoting", csvCell("=HYPERLINK(\"x\",1)") === `"'=HYPERLINK(""x"",1)"`, csvCell("=HYPERLINK(\"x\",1)"));
  check("csv mid-string = not guarded", csvCell("a=b") === "a=b");

  const r: CsvRow = { ...row({ id: "c-x", note: "=cmd|' /C calc'!A0", user_name: "Doe, Jane" }), username: "jdoe", roles: "Loading Team, Read Only" };
  const csv = toCsv([r]);
  const lines = csv.split("\r\n");
  check("csv CRLF + trailing newline", lines.length === 3 && lines[2] === "");
  check("csv header line", lines[0] === CSV_HEADER.join(","));
  check("csv row content", lines[1].startsWith('c-x,2026-11-01,"Doe, Jane",jdoe,"Loading Team, Read Only",block-01,Block 01 — New Hire Core Orientation,self,User One,'), lines[1]);
  check("csv row note guarded", lines[1].includes(`'=cmd|' /C calc'!A0`), lines[1]);
}

// ── misc ──
check("ymd valid", isValidYmd("2026-02-28") && !isValidYmd("2026-02-30") && !isValidYmd("2026-1-5") && !isValidYmd(20261105));
check("etToday ET date (UTC 03:00 Nov 17 → Nov 16 ET)", etToday(Date.UTC(2026, 10, 17, 3, 0)) === "2026-11-16");
const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
check("canManageSafety header", canManageSafety(h({ "X-User-Can-Manage-Safety": "1" })));
check("canManageSafety admin", canManageSafety(h({ "X-User-Is-Admin": "1" })));
check("canManageSafety neither", !canManageSafety(h({ "X-User-Can-Manage-Safety": "0", "X-User-Is-Admin": "0" })));

// ── saf-02: insertSelfIfAbsentStmt against an in-memory SQLite copy of the saf-01 DDL ──
// node:sqlite (Node ≥ 22.5) has no @types here, so it's loaded by a computed specifier; a 6-line D1 shim adapts it.
const STC_DDL = `CREATE TABLE safety_training_completions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_name TEXT NOT NULL, block_id TEXT NOT NULL, completed_on TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('self','group')), recorded_by_id TEXT NOT NULL, recorded_by_name TEXT NOT NULL,
  note TEXT, attested INTEGER NOT NULL DEFAULT 1 CHECK (attested IN (0,1)), voided_at TEXT, voided_by_name TEXT,
  void_reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_stc_user_block ON safety_training_completions(user_id, block_id);
CREATE INDEX idx_stc_block_date ON safety_training_completions(block_id, completed_on);`;

async function sqliteChecks() {
  const spec = "node:sqlite";
  const { DatabaseSync } = (await import(spec)) as any;
  const mem = new DatabaseSync(":memory:");
  mem.exec(STC_DDL);
  const d1: any = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        run: async () => ({ meta: { changes: Number(mem.prepare(sql).run(...args).changes) } }),
      }),
    }),
  };
  let n = 0;
  const ins = (completed_on: string, user_id = "u1", block_id = "block-01") =>
    insertSelfIfAbsentStmt(d1, {
      id: `s${++n}`, user_id, user_name: "User One", block_id, completed_on, recorded_by_id: user_id, recorded_by_name: "User One",
    }).run();
  const count = () => Number(mem.prepare("SELECT count(*) AS c FROM safety_training_completions").get().c);

  check("race: first insert changes 1", (await ins("2026-11-16")).meta.changes === 1);
  check("race: same user/block/date changes 0", (await ins("2026-11-16")).meta.changes === 0);
  check("race: different date changes 1", (await ins("2026-11-17")).meta.changes === 1);
  check("race: other block same date changes 1", (await ins("2026-11-16", "u1", "block-02")).meta.changes === 1);
  check("race: other user same block/date changes 1", (await ins("2026-11-16", "u2")).meta.changes === 1);
  const parallel = await Promise.all([ins("2026-11-20"), ins("2026-11-20")]);
  check("race: two parallel → exactly one inserted", parallel.map((r) => r.meta.changes).sort().join(",") === "0,1");
  check("race: inserted row is source self, attested, no note",
    (() => { const r = mem.prepare("SELECT source, attested, note FROM safety_training_completions WHERE id = 's1'").get(); return r.source === "self" && r.attested === 1 && r.note === null; })());
  mem.exec("INSERT INTO safety_training_completions (id,user_id,user_name,block_id,completed_on,source,recorded_by_id,recorded_by_name) VALUES ('g1','u3','U3','block-01','2026-11-16','group','m','M')");
  check("race: an existing GROUP row doesn't block a self row", (await ins("2026-11-16", "u3")).meta.changes === 1);
  mem.exec("UPDATE safety_training_completions SET voided_at = '2026-11-16 12:00:00' WHERE id = 's1'");
  check("race: a VOIDED self row doesn't block a new one", (await ins("2026-11-16")).meta.changes === 1);
  check("race: row count", count() === 8, String(count()));
}

sqliteChecks()
  .catch((e) => { fail++; console.log(`FAIL sqlite checks threw ${String(e)}`); })
  .finally(() => {
    console.log(`records selfcheck: ${pass}/${pass + fail} passed`);
    if (fail) process.exit(1);
  });
