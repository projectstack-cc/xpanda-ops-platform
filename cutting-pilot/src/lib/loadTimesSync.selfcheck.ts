// src/lib/loadTimesSync.selfcheck.ts
// Guarded dev self-check for loadTimesSync.ts's pure decision logic (dlv-02) — no D1. Mirrors
// deliveryTime.selfcheck.ts's shape: a check()/results table, one exported run*SelfCheck().
import {
  decideLoadTime,
  resolveDittoSources,
  stripDeliveryTimeOverride,
  type IncomingLoadTime,
  type StoredLoadTime,
} from "./loadTimesSync";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export function runLoadTimesSyncSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, got: unknown, want: unknown) =>
    check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

  const raw = "INV 4472 - Delivery @ 8am & 9am";
  const inc: IncomingLoadTime = { load_number: 2, date: "2026-10-22", minutes: 540, display: "Thurs 9:00AM", sheet_raw: raw };
  const stored = (over: Partial<StoredLoadTime>): StoredLoadTime => ({
    job_id: "j1", load_number: 2, delivery_date: "2026-10-22", delivery_minutes: 540,
    display: "Thurs 9:00AM", source: "sheet", sheet_raw: raw, ...over,
  });

  // ── decideLoadTime: the four branches ────────────────────────────────────────────────────
  eq("no row → insert (first fill, no alert)", decideLoadTime(null, inc), { kind: "insert" });
  eq("undefined row → insert", decideLoadTime(undefined, inc), { kind: "insert" });
  eq("same display, sheet → noop", decideLoadTime(stored({}), inc), { kind: "noop" });
  eq("same display, manual → flip source", decideLoadTime(stored({ source: "manual", sheet_raw: null }), inc), { kind: "refresh", flippedSource: true });
  eq("different display → change", decideLoadTime(stored({ display: "Thurs 10:00AM", delivery_minutes: 600 }), inc), { kind: "change", prevDisplay: "Thurs 10:00AM" });
  eq("manual with different display → change (sheet wins)", decideLoadTime(stored({ source: "manual", display: "Wed 9:00AM" }), inc), { kind: "change", prevDisplay: "Wed 9:00AM" });
  // Same weekday a week later prints the same text: a silent refresh, never an alert.
  eq("same display, new date → silent refresh", decideLoadTime(stored({ delivery_date: "2026-10-15" }), inc), { kind: "refresh", flippedSource: false });
  eq("same display, new raw cell → silent refresh", decideLoadTime(stored({ sheet_raw: "INV 4472 - del @ 8am & 9am" }), inc), { kind: "refresh", flippedSource: false });

  // ── stripDeliveryTimeOverride ────────────────────────────────────────────────────────────
  eq("override with deliveryTime → stripped", stripDeliveryTimeOverride(JSON.stringify({ deliveryTime: "Thurs 8:00AM", sealNumber: "123" })), {
    value: JSON.stringify({ sealNumber: "123" }), changed: true, malformed: false,
  });
  eq("override with only deliveryTime → {}", stripDeliveryTimeOverride(JSON.stringify({ deliveryTime: "x" })), { value: "{}", changed: true, malformed: false });
  const without = JSON.stringify({ sealNumber: "123" });
  eq("override without deliveryTime → untouched", stripDeliveryTimeOverride(without), { value: without, changed: false, malformed: false });
  eq("null → untouched", stripDeliveryTimeOverride(null), { value: null, changed: false, malformed: false });
  eq("empty → untouched", stripDeliveryTimeOverride(""), { value: "", changed: false, malformed: false });
  eq("malformed JSON → untouched + flagged", stripDeliveryTimeOverride("{deliveryTime:"), { value: "{deliveryTime:", changed: false, malformed: true });
  eq("JSON array → untouched + flagged", stripDeliveryTimeOverride("[1]"), { value: "[1]", changed: false, malformed: true });

  // ── resolveDittoSources ──────────────────────────────────────────────────────────────────
  const sec = [
    { ship_week: "9-14-26", ship_date: "2026-09-14", sort_order: 3, delivery_time: "INV 4273 - Delivery @ 7am & HRLY" },
    { ship_week: "9-14-26", ship_date: "2026-09-14", sort_order: 4, delivery_time: "INV 4355 ^^^" },
    { ship_week: "9-14-26", ship_date: "2026-09-14", sort_order: 5, delivery_time: "INV 4356 ^^^" },
    { ship_week: "9-14-26", ship_date: "2026-09-15", sort_order: 0, delivery_time: "INV 4357 ^^^" },
  ];
  const out = resolveDittoSources([sec[2], sec[3], sec[0]], sec);
  eq("ditto walks back past another ditto", out[0].ditto_source, "INV 4273 - Delivery @ 7am & HRLY");
  eq("ditto first in its section → null", out[1].ditto_source, null);
  eq("non-ditto untouched", "ditto_source" in out[2], false);

  return { pass: results.every((r) => r.pass), results };
}
