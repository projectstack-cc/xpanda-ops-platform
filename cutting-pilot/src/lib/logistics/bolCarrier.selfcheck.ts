// src/lib/logistics/bolCarrier.selfcheck.ts
// Guarded dev self-check for bolCarrier.ts (bolc-01, bolc-02). Mirrors latePickup.selfcheck.ts's shape:
// a check()/results table, one exported run*SelfCheck() function. Not part of the production
// build path.
import {
  normCarrier, effectiveCarrier, stripCarrierOverride, promoteCarrierOverride,
  propagateJobCarrierToBols, propagateLoadCarrierToBols,
} from "./bolCarrier";
import type { D1Database } from "@cloudflare/workers-types";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

interface Row { id: string; carrier_name: string | null; render_overrides: string | null; load_number?: number | null }

// Minimal in-memory D1 stub: SELECT returns the given rows, UPDATEs are captured. mlc-01: keys off
// the SQL — the job-level query drops rows on `overriddenLoads`, the per-load query keeps only the
// bound load_number.
function fakeDb(rows: Row[], overriddenLoads: number[] = []) {
  const updates: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            sql, args,
            async all() {
              if (sql.includes("NOT IN (SELECT load_number FROM job_load_carriers")) {
                return { results: rows.filter((r) => r.load_number == null || !overriddenLoads.includes(r.load_number)) };
              }
              if (sql.includes("AND load_number = ?")) {
                return { results: rows.filter((r) => r.load_number === args[1]) };
              }
              return { results: rows };
            },
            async run() { return {}; },
          };
        },
      };
    },
    async batch(stmts: { sql: string; args: unknown[] }[]) {
      for (const s of stmts) if (s.sql.startsWith("UPDATE bols")) updates.push(s.args);
      return [];
    },
  };
  return { db: db as unknown as D1Database, updates };
}

export async function runBolCarrierSelfCheck(): Promise<{ pass: boolean; results: CheckResult[] }> {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, got: unknown, want: unknown) =>
    check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

  eq("norm trims + lowercases", normCarrier("  Seal Express "), "seal express");
  eq("norm null", normCarrier(null), "");

  eq("non-empty override is effective", effectiveCarrier("XPanda truck", '{"carrierName":"Seal Express"}'), "Seal Express");
  eq("blank override not effective", effectiveCarrier("XPanda truck", '{"carrierName":""}'), "XPanda truck");
  eq("whitespace override not effective", effectiveCarrier("XPanda truck", '{"carrierName":"  "}'), "XPanda truck");
  eq("invalid JSON → carrier_name", effectiveCarrier("XPanda truck", "{nope"), "XPanda truck");

  eq("strip non-empty, keep _pos", stripCarrierOverride('{"carrierName":"X","_pos":{"a":1}}'), '{"_pos":{"a":1}}');
  eq("strip keeps blank", stripCarrierOverride('{"carrierName":""}'), '{"carrierName":""}');
  eq("strip only key → null", stripCarrierOverride('{"carrierName":"X"}'), null);
  eq("strip null → null", stripCarrierOverride(null), null);

  // bolc-02: promoteCarrierOverride.
  eq("promote non-empty, key removed, _pos kept",
    promoteCarrierOverride('{"carrierName":" Seal Express ","_pos":{"a":1}}', "XPanda truck"),
    { carrier_name: "Seal Express", render_overrides: '{"_pos":{"a":1}}' });
  eq("promote blank untouched", promoteCarrierOverride('{"carrierName":""}', "Lisma"),
    { carrier_name: "Lisma", render_overrides: '{"carrierName":""}' });
  eq("promote only key → null", promoteCarrierOverride('{"carrierName":"Lisma"}', "XPanda truck"),
    { carrier_name: "Lisma", render_overrides: null });
  eq("promote invalid JSON unchanged", promoteCarrierOverride("{nope", "XPanda truck"),
    { carrier_name: "XPanda truck", render_overrides: "{nope" });
  eq("promote null unchanged", promoteCarrierOverride(null, "XPanda truck"),
    { carrier_name: "XPanda truck", render_overrides: null });

  // Equal carriers (case/whitespace-insensitive) → no-op.
  {
    const { db, updates } = fakeDb([{ id: "b1", carrier_name: "XPanda truck", render_overrides: null }]);
    eq("equal carriers no-op", await propagateJobCarrierToBols(db, "j1", "XPanda Truck", " xpanda truck ", null), 0);
    eq("equal carriers no updates", updates.length, 0);
  }

  // Mixed rows.
  {
    const { db, updates } = fakeDb([
      { id: "plain", carrier_name: " xpanda TRUCK ", render_overrides: null },
      { id: "other", carrier_name: "Lisma", render_overrides: null },
      { id: "ovr-old", carrier_name: "Lisma", render_overrides: '{"carrierName":"XPanda truck","_pos":{"x":2}}' },
      { id: "ovr-new", carrier_name: "XPanda truck", render_overrides: '{"carrierName":"Lisma"}' },
      { id: "blank", carrier_name: "XPanda truck", render_overrides: '{"carrierName":"","_pos":{"y":1}}' },
    ]);
    const n = await propagateJobCarrierToBols(db, "j1", "XPanda truck", "Seal Express - Dry Van", null);
    eq("propagated count", n, 3);
    eq("case/whitespace-insensitive match", updates[0], ["Seal Express - Dry Van", null, "plain"]);
    eq("override used as effective carrier; stripped, _pos kept", updates[1],
      ["Seal Express - Dry Van", '{"_pos":{"x":2}}', "ovr-old"]);
    eq("blank override ignored for match and preserved", updates[2],
      ["Seal Express - Dry Van", '{"carrierName":"","_pos":{"y":1}}', "blank"]);
  }

  // mlc-01: the job-level query skips loads that have a job_load_carriers override.
  {
    const { db, updates } = fakeDb([
      { id: "l1", carrier_name: "Seal Express", render_overrides: null, load_number: 1 },
      { id: "l2", carrier_name: "XPanda truck", render_overrides: null, load_number: 2 },
      { id: "nul", carrier_name: "Seal Express", render_overrides: null, load_number: null },
    ], [2]);
    const n = await propagateJobCarrierToBols(db, "j1", "Seal Express", "Lisma", null);
    eq("job-level: overridden load skipped", n, 2);
    eq("job-level: updated ids", updates.map((u) => u[2]), ["l1", "nul"]);
  }

  // mlc-01: propagateLoadCarrierToBols — one load only, old-effective match only.
  {
    const { db, updates } = fakeDb([
      { id: "l1", carrier_name: "Seal Express", render_overrides: null, load_number: 1 },
      { id: "l2", carrier_name: "seal express ", render_overrides: '{"carrierName":"","_pos":{"z":3}}', load_number: 2 },
      { id: "l2-hand", carrier_name: "Seal Express", render_overrides: '{"carrierName":"Lisma"}', load_number: 2 },
    ]);
    const n = await propagateLoadCarrierToBols(db, "j1", 2, "Seal Express", "XPanda truck", null);
    eq("per-load: count", n, 1);
    eq("per-load: only load 2, hand-edited skipped", updates, [["XPanda truck", '{"carrierName":"","_pos":{"z":3}}', "l2"]]);
  }
  {
    const { db, updates } = fakeDb([{ id: "l2", carrier_name: "XPanda truck", render_overrides: null, load_number: 2 }]);
    eq("per-load: equal no-op", await propagateLoadCarrierToBols(db, "j1", 2, "XPanda Truck", "xpanda truck", null), 0);
    eq("per-load: equal no updates", updates.length, 0);
  }

  return { pass: results.every((r) => r.pass), results };
}
