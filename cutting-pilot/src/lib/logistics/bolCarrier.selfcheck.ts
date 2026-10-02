// src/lib/logistics/bolCarrier.selfcheck.ts
// Guarded dev self-check for bolCarrier.ts (bolc-01). Mirrors latePickup.selfcheck.ts's shape:
// a check()/results table, one exported run*SelfCheck() function. Not part of the production
// build path.
import { normCarrier, effectiveCarrier, stripCarrierOverride, propagateJobCarrierToBols } from "./bolCarrier";
import type { D1Database } from "@cloudflare/workers-types";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

interface Row { id: string; carrier_name: string | null; render_overrides: string | null }

// Minimal in-memory D1 stub: SELECT returns the given rows, UPDATEs are captured.
function fakeDb(rows: Row[]) {
  const updates: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            sql, args,
            async all() { return { results: rows }; },
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

  return { pass: results.every((r) => r.pass), results };
}
