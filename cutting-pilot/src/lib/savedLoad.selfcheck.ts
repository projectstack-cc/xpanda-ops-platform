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
import { LOAD_BUILDER_FIXTURES } from "./loadBuilderFixtures";

// 2026-09-16: deserializeSnapshot now checks a "fixture"-kind source's fixtureId against
// LOAD_BUILDER_FIXTURES (savedLoad.ts) rather than accepting any string, so every fixture-source
// test below needs a REAL id, not an arbitrary placeholder — using the bundled list's own first
// entry rather than hardcoding one of its ids keeps these tests correct if that list's contents
// ever change. If LOAD_BUILDER_FIXTURES is ever emptied entirely, every round-trip test below
// fails by design (no fixtureId can resolve, so every fixture-kind row becomes unloadable) — that's
// not a bug in this file, it's this suite correctly reporting a real consequence for anyone who
// still has a "fixture"-kind saved_loads row.
const REAL_FIXTURE_ID = LOAD_BUILDER_FIXTURES[0].id;

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
      fixtureId: REAL_FIXTURE_ID,
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
      fixtureId: REAL_FIXTURE_ID,
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
      fixtureId: REAL_FIXTURE_ID,
      pulledSource: null,
      trailerTypeKey: "53ft Standard",
      runnerHeight: 0,
      editedPlan: null,
    });
    const tampered = { ...snapshot, version: 2 } as unknown as SavedLoadSnapshot;
    const result = deserializeSnapshot(JSON.stringify(tampered));
    check("deserializeSnapshot: wrong version rejected", result.ok === false, JSON.stringify(result));
  }

  // 5b. 2026-09-16: LoadPlanView.tsx dropped its fixture picker, but a "fixture"-kind row saved
  //     while it still existed can name a fixtureId LOAD_BUILDER_FIXTURES no longer has (the
  //     picker's own three ids, or any hand-edited id). deserializeSnapshot must reject that
  //     specifically -- not fall through to the generic "may have been saved from legacy" message,
  //     which would be actively wrong for a well-formed, current-version, v2-authored row.
  {
    const staleRow = {
      version: 1,
      source: { kind: "fixture", fixtureId: "FIXTURE_NO_LONGER_BUNDLED" },
      trailerTypeKey: "53ft Standard",
      runnerHeight: 0,
      editedPlan: null,
    };
    const result = deserializeSnapshot(JSON.stringify(staleRow));
    check(
      "deserializeSnapshot: fixture-kind row with an unresolvable fixtureId is rejected, not silently accepted",
      result.ok === false && result.reason.includes("no longer available"),
      JSON.stringify(result)
    );
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
    const pulledSnapshot = buildSnapshot({ fixtureId: REAL_FIXTURE_ID, pulledSource: pulled, trailerTypeKey: "53ft Standard", runnerHeight: 0, editedPlan: null });
    const pulledPayload = buildSavePayload("  My Load  ", "AccuDock", pulledSnapshot);
    check(
      "buildSavePayload: job_id from pulled source, name trimmed",
      pulledPayload.job_id === "job-77" && pulledPayload.name === "My Load",
      JSON.stringify(pulledPayload)
    );

    const fixtureSnapshot = buildSnapshot({ fixtureId: REAL_FIXTURE_ID, pulledSource: null, trailerTypeKey: "53ft Standard", runnerHeight: 0, editedPlan: null });
    const fixturePayload = buildSavePayload("   ", "AccuDock", fixtureSnapshot);
    check(
      "buildSavePayload: job_id null for fixture source, blank name -> default",
      fixturePayload.job_id === null && fixturePayload.name === defaultSaveName("AccuDock"),
      JSON.stringify(fixturePayload)
    );
  }

  // 8. lb-ui-11: round-trip with editedCart/editedSkus present — a saved load whose edit session
  //    introduced a parts-library SKU (source.pulledSource.cart/.skus stay frozen at job-pull time;
  //    these two carry the session's actual final state so a reload doesn't lose track of it).
  {
    const pulled = makePulledSource(); // cart: [SKU-1 x10], skus: [SKU-1]
    const editedCart = [{ skuId: "SKU-1", qty: 10 }, { skuId: "LIB-1", qty: 3 }];
    const editedSkus = [...pulled.skus, { id: "LIB-1", name: "Library Part", sku: "LIB-1", length: 12, width: 12, height: 5, weight: 3, category: "Blocks", allowRotation: true }];
    const snapshot = buildSnapshot({
      fixtureId: REAL_FIXTURE_ID,
      pulledSource: pulled,
      trailerTypeKey: "53ft Standard",
      runnerHeight: 0,
      editedPlan: makePlan(),
      editedCart,
      editedSkus,
    });
    const raw = serializeSnapshot(snapshot);
    const result = deserializeSnapshot(raw);
    check(
      "round-trip: editedCart/editedSkus (library SKU) survive intact",
      result.ok === true && JSON.stringify(result.snapshot) === JSON.stringify(snapshot),
      JSON.stringify(result)
    );
    check(
      "round-trip: editedSkus still has the library SKU LIB-1 the frozen pulledSource.skus never had",
      result.ok === true && !!result.snapshot.editedSkus?.some((s) => s.id === "LIB-1") && !pulled.skus.some((s) => s.id === "LIB-1"),
      JSON.stringify(result.ok ? result.snapshot.editedSkus : result)
    );
  }

  // 9. Backward compat: a pre-lb-ui-11 row (no editedCart/editedSkus keys at all in the persisted
  //    JSON, not even null) still deserializes successfully — these two fields are additive, never
  //    a compatibility break — and the two fields come back as null (fall back to source's own
  //    cart/skus), not undefined or a throw.
  {
    const preLb11Row = {
      version: 1,
      source: { kind: "fixture", fixtureId: REAL_FIXTURE_ID },
      trailerTypeKey: "53ft Standard",
      runnerHeight: 0,
      editedPlan: null,
      // no editedCart / editedSkus keys at all
    };
    const result = deserializeSnapshot(JSON.stringify(preLb11Row));
    check(
      "deserializeSnapshot: pre-lb-ui-11 row (missing editedCart/editedSkus) still loads",
      result.ok === true && result.snapshot.editedCart === null && result.snapshot.editedSkus === null,
      JSON.stringify(result)
    );
  }

  // 10. lb-ui-12: round-trip with autoDownsize: true.
  {
    const snapshot = buildSnapshot({
      fixtureId: REAL_FIXTURE_ID,
      pulledSource: null,
      trailerTypeKey: "53ft Standard",
      runnerHeight: 0,
      editedPlan: null,
      autoDownsize: true,
    });
    const result = deserializeSnapshot(serializeSnapshot(snapshot));
    check(
      "round-trip: autoDownsize: true survives intact",
      result.ok === true && result.snapshot.autoDownsize === true,
      JSON.stringify(result)
    );
  }

  // 11. Backward compat: a pre-lb-ui-12 row (no autoDownsize key at all) still deserializes
  //     successfully and comes back false — not true (the UI's own live default), which would
  //     silently start auto-downsizing a load that never had the feature applied when it was saved
  //     — see this fallback's own comment on SavedLoadSnapshot.autoDownsize.
  {
    const preLb12Row = {
      version: 1,
      source: { kind: "fixture", fixtureId: REAL_FIXTURE_ID },
      trailerTypeKey: "53ft Standard",
      runnerHeight: 0,
      editedPlan: null,
      // no autoDownsize key at all
    };
    const result = deserializeSnapshot(JSON.stringify(preLb12Row));
    check(
      "deserializeSnapshot: pre-lb-ui-12 row (missing autoDownsize) still loads, defaults to false",
      result.ok === true && result.snapshot.autoDownsize === false,
      JSON.stringify(result)
    );
  }

  return { pass: results.every((r) => r.pass), results };
}
