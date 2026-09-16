// src/lib/savedLoad.selfcheck.ts
// Guarded dev self-check for savedLoad.ts (lb-ui-04 Part D). Mirrors jobPull.selfcheck.ts's shape.
// Pure -- no network calls.
import {
  buildSnapshot,
  serializeSnapshot,
  deserializeSnapshot,
  defaultSaveName,
  buildSavePayload,
  type SavedLoadSnapshot,
} from "./savedLoad";
import type { PackPlan } from "./packEngine";
import type { PulledLoadSource } from "@/components/logistics/JobPullModal";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function makePlan(overrides: Partial<PackPlan> = {}): PackPlan {
  return {
    trailers: [],
    balance: [{ skuId: "SKU-1", remaining: 4 }],
    warnings: [],
    totalWeight: 100,
    totalUnits: 12,
    totalStacks: 3,
    mixedStacks: 0,
    ...overrides,
  };
}

function makePulledSource(overrides: Partial<PulledLoadSource> = {}): PulledLoadSource {
  return {
    id: "job-abc",
    jobId: "abc",
    invoiceNumber: "INV-1",
    customer: "AccuDock",
    label: "INV# INV-1 — AccuDock",
    cart: [{ skuId: "SKU-1", qty: 10 }],
    skus: [{ id: "SKU-1", name: "Block", sku: "SKU-1", length: 48, width: 24, height: 8, weight: 10, category: "Blocks", allowRotation: true }],
    unmatchedCount: 0,
    unmatchedDescriptions: [],
    ...overrides,
  };
}

export function runSavedLoadSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  // 1. Round-trip: fixture source, no manual edits (editedPlan null) -- deep-equal to the original.
  {
    const snapshot = buildSnapshot({
      fixtureId: "inv-4202",
      pulledSource: null,
      trailerTypeKey: "53ft Standard",
      runnerHeight: 3,
      editedPlan: null,
    });
    const raw = serializeSnapshot(snapshot);
    const result = deserializeSnapshot(raw);
    check(
      "round-trip: fixture source, no edits",
      result.ok === true && JSON.stringify(result.snapshot) === JSON.stringify(snapshot),
      JSON.stringify(result)
    );
  }

  // 2. Round-trip: pulled-job source with a materialized editedPlan -- deep-equal to the original.
  {
    const pulled = makePulledSource();
    const plan = makePlan({ trailers: [] });
    const snapshot = buildSnapshot({
      fixtureId: "inv-4202",
      pulledSource: pulled,
      trailerTypeKey: "48ft",
      runnerHeight: 0,
      editedPlan: plan,
    });
    const raw = serializeSnapshot(snapshot);
    const result = deserializeSnapshot(raw);
    check(
      "round-trip: pulled source + materialized editedPlan",
      result.ok === true && JSON.stringify(result.snapshot) === JSON.stringify(snapshot),
      JSON.stringify(result)
    );
  }

  // 3. deserializeSnapshot rejects corrupt (non-JSON) input with a reason, not a throw.
  {
    let threw = false;
    let result: ReturnType<typeof deserializeSnapshot> | null = null;
    try {
      result = deserializeSnapshot("{not json");
    } catch {
      threw = true;
    }
    check(
      "deserializeSnapshot: corrupt JSON rejected without throwing",
      !threw && result !== null && result.ok === false && result.reason === "Corrupt save data.",
      JSON.stringify(result)
    );
  }

  // 4. deserializeSnapshot rejects a legacy-shaped state_json (real key set from
  //    load-builder.html's saveLoad(), no `version`/`source`/`trailerTypeKey` fields) with a
  //    reason, not a throw or a garbage "successful" parse.
  {
    const legacyShape = {
      trailerType: "53ft Standard",
      trailerInvNumbers: {},
      runnerHeight: 0,
      autoDownsize: false,
      forcedTrailers: null,
      forcedMode: false,
      variant: 0,
      manualRowsByTrailer: {},
      committedTrailers: null,
      committedSig: null,
      skus: [],
      cart: [],
      prefillJobId: null,
    };
    let threw = false;
    let result: ReturnType<typeof deserializeSnapshot> | null = null;
    try {
      result = deserializeSnapshot(JSON.stringify(legacyShape));
    } catch {
      threw = true;
    }
    check(
      "deserializeSnapshot: legacy-authored state_json rejected without throwing",
      !threw && result !== null && result.ok === false && result.reason.includes("legacy"),
      JSON.stringify(result)
    );
  }

  // 5. deserializeSnapshot rejects a wrong-version snapshot (forward-compat guard).
  {
    const snapshot = buildSnapshot({
      fixtureId: "inv-4202",
      pulledSource: null,
      trailerTypeKey: "53ft Standard",
      runnerHeight: 0,
      editedPlan: null,
    });
    const tampered = { ...snapshot, version: 2 } as unknown as SavedLoadSnapshot;
    const result = deserializeSnapshot(JSON.stringify(tampered));
    check("deserializeSnapshot: wrong version rejected", result.ok === false, JSON.stringify(result));
  }

  // 6. defaultSaveName: matches legacy's own format exactly, falls back to bare date when no
  //    customer.
  {
    const withCustomer = defaultSaveName("AccuDock");
    const withoutCustomer = defaultSaveName("");
    check(
      "defaultSaveName: customer -> 'Customer — Date' format",
      withCustomer.startsWith("AccuDock — ") && withCustomer.length > "AccuDock — ".length,
      withCustomer
    );
    check("defaultSaveName: blank customer -> bare date, no leading separator", !withoutCustomer.startsWith("—"), withoutCustomer);
  }

  // 7. buildSavePayload: job_id populated from a pulled source, null for a fixture source; blank
  //    name falls back to the default.
  {
    const pulled = makePulledSource({ jobId: "job-77" });
    const pulledSnapshot = buildSnapshot({ fixtureId: "inv-4202", pulledSource: pulled, trailerTypeKey: "53ft Standard", runnerHeight: 0, editedPlan: null });
    const pulledPayload = buildSavePayload("  My Load  ", "AccuDock", pulledSnapshot);
    check(
      "buildSavePayload: job_id from pulled source, name trimmed",
      pulledPayload.job_id === "job-77" && pulledPayload.name === "My Load",
      JSON.stringify(pulledPayload)
    );

    const fixtureSnapshot = buildSnapshot({ fixtureId: "inv-4202", pulledSource: null, trailerTypeKey: "53ft Standard", runnerHeight: 0, editedPlan: null });
    const fixturePayload = buildSavePayload("   ", "AccuDock", fixtureSnapshot);
    check(
      "buildSavePayload: job_id null for fixture source, blank name -> default",
      fixturePayload.job_id === null && fixturePayload.name === defaultSaveName("AccuDock"),
      JSON.stringify(fixturePayload)
    );
  }

  return { pass: results.every((r) => r.pass), results };
}
