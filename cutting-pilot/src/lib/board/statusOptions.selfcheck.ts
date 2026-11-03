// src/lib/board/statusOptions.selfcheck.ts
// Guarded dev self-check for statusOptions.ts (jb-15). Same shape as deliveryTime.selfcheck.ts: a
// results table and one exported run*SelfCheck() function. Not part of the production build path.
import { boardStatusChangeError, statusOptionsFor } from "./statusOptions";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const OUT_OF = "Can't change a loading/shipped job from the board.";
const INTO = "Loading and Shipped are set from the Logistics / Dock flow, not the board.";

export function runStatusOptionsSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const eq = (name: string, actual: unknown, expected: unknown) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    results.push({ name, pass: a === e, detail: a === e ? undefined : `got ${a}, want ${e}` });
  };

  eq("not_started → done ok", boardStatusChangeError("not_started", "done"), null);
  eq("done → in_production ok", boardStatusChangeError("done", "in_production"), null);
  eq("not_started → loading blocked", boardStatusChangeError("not_started", "loading"), INTO);
  eq("in_production → shipped blocked", boardStatusChangeError("in_production", "shipped"), INTO);
  eq("loading → loading ok", boardStatusChangeError("loading", "loading"), null);
  eq("shipped → shipped ok", boardStatusChangeError("shipped", "shipped"), null);
  eq("shipped → done blocked", boardStatusChangeError("shipped", "done"), OUT_OF);
  eq("loading → not_started blocked", boardStatusChangeError("loading", "not_started"), OUT_OF);
  eq("loading → shipped blocked", boardStatusChangeError("loading", "shipped"), OUT_OF);

  const values = (current: string) => statusOptionsFor(current).map((o) => o.value);
  eq("options for active job", values("in_production"), ["not_started", "in_production", "done"]);
  eq("options for loading job", values("loading"), ["not_started", "in_production", "done", "loading"]);
  eq("options for shipped job", values("shipped"), ["not_started", "in_production", "done", "shipped"]);

  return { pass: results.every((r) => r.pass), results };
}
