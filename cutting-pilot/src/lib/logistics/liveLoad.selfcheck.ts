// src/lib/logistics/liveLoad.selfcheck.ts
// Guarded dev self-check for liveLoad.ts (live-01). Mirrors latePickup.selfcheck.ts's shape:
// a check()/results table, one exported run*SelfCheck() function. Not part of the production
// build path. Carrier strings are every real value in D1 as of 2026-10-19.
import { isLiveLoadCarrier, fetchLiveLoadByJob } from "./liveLoad";
import type { D1Database } from "@cloudflare/workers-types";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

// Minimal in-memory D1 stub keyed off the SQL: the jobs query returns `jobs`, the
// job_load_carriers query returns `jlc` (already filtered to load_number <= load_count), the
// job_live_load_times query returns `times` (or throws when `times` is "throw").
function stubDb(
  jobs: Array<{ id: string; carrier: string | null; method: string | null; load_count: number | null }>,
  jlc: Array<{ job_id: string; load_number: number; carrier: string }>,
  times: Array<{ job_id: string; load_number: number; display: string }> | "throw" = []
): D1Database {
  return {
    prepare(sql: string) {
      if (sql.includes("job_live_load_times")) {
        if (times === "throw") throw new Error("no such table: job_live_load_times");
        return { bind: () => ({ all: async () => ({ results: times }) }) };
      }
      const results = sql.includes("job_load_carriers") ? jlc : jobs;
      return { bind: () => ({ all: async () => ({ results }) }) };
    },
  } as unknown as D1Database;
}

export async function runLiveLoadSelfCheck(): Promise<{ pass: boolean; results: CheckResult[] }> {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, got: unknown, want: unknown) =>
    check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

  const notLive = [
    "Seal Express - Dry Van", "SEAL EXPRESS AKA LISMA", "SEAL EXPRESS AKA LISMA + XCT",
    "XPanda truck - 1st stop", "XPanda truck - 2nd stop", "XP TRUCK", "LISMA Dry -Van",
    "CPU", "Courier Pick Up", "Hand Deliver", "", "   ",
  ];
  for (const c of notLive) eq(`not live: ${JSON.stringify(c)}`, isLiveLoadCarrier(c, null), false);
  eq("not live: null carrier", isLiveLoadCarrier(null), false);
  eq("not live: method customer pickup, blank carrier", isLiveLoadCarrier("", "customer pickup"), false);
  eq("not live: method Customer Pickup beats KOF", isLiveLoadCarrier("King of Freight", " Customer Pickup "), false);
  eq("not live: method hand deliver", isLiveLoadCarrier("Priority One", "hand deliver"), false);

  const live = [
    "King of Freight", "KOF", 'KOF "LIVE LOAD WED"', "Priority One", "Third Party Carrier", "LTL carrier",
    "Delivery Co",
  ];
  for (const c of live) eq(`live: ${JSON.stringify(c)}`, isLiveLoadCarrier(c, null), true);
  eq("live: 'live' note beats Seal prefix", isLiveLoadCarrier("Seal - LIVE LOAD", null), true);
  eq("live: method delivery", isLiveLoadCarrier("KOF", "delivery"), true);

  // Per-load: Seal default with load 2 = King of Freight → [2].
  const db = stubDb(
    [
      { id: "a", carrier: "Seal Express - Dry Van", method: "delivery", load_count: 3 },
      { id: "b", carrier: "Seal Express - Dry Van", method: null, load_count: 1 },
      { id: "c", carrier: "KOF", method: null, load_count: null },
      { id: "d", carrier: "KOF", method: "customer pickup", load_count: 2 },
    ],
    [{ job_id: "a", load_number: 2, carrier: "King of Freight" }],
    [
      { job_id: "a", load_number: 2, display: "Mon 10:00 AM" },
      { job_id: "a", load_number: 1, display: "Mon 8:00 AM" }, // load 1 is Seal → not live → dropped
      { job_id: "c", load_number: 1, display: "7:30 AM" },
    ]
  );
  const map = await fetchLiveLoadByJob(db, ["a", "b", "c", "d"]);
  eq("per-load: Seal + L2 KOF (+ L2 time only)", map.get("a"), { live: true, live_loads: [2], live_times: { 2: "Mon 10:00 AM" } });
  eq("per-load: all Seal", map.get("b"), { live: false, live_loads: [], live_times: {} });
  eq("per-load: KOF, null load_count → 1 load", map.get("c"), { live: true, live_loads: [1], live_times: { 1: "7:30 AM" } });
  eq("per-load: customer pickup never live", map.get("d"), { live: false, live_loads: [], live_times: {} });

  // live-03: the times table failing (e.g. migration not run) keeps the flags.
  const origErr = console.error;
  console.error = () => {};
  const noTimes = await fetchLiveLoadByJob(
    stubDb([{ id: "k", carrier: "KOF", method: null, load_count: 1 }], [], "throw"),
    ["k"]
  );
  console.error = origErr;
  eq("times table error → flags kept, no times", noTimes.get("k"), { live: true, live_loads: [1], live_times: {} });

  const broken = { prepare() { throw new Error("boom"); } } as unknown as D1Database;
  const origError = console.error;
  console.error = () => {};
  const empty = await fetchLiveLoadByJob(broken, ["a"]);
  console.error = origError;
  eq("best-effort: error → empty map", empty.size, 0);

  return { pass: results.every((r) => r.pass), results };
}
