// src/lib/bolNumberFill.ts
// lb-ui-13: the ONE per-trailer BOL # auto-fill rule, shared by BolGenerateModal (handleInvNumberChange)
// and the v2 Load Builder trailer cards (ResultsTab / LoadPlanView). Pure — no React, no D1.
//
// Rule (ported verbatim from BolGenerateModal.handleInvNumberChange): editing trailer 0 with a
// `prefix-##` shape auto-fills every later trailer that is blank or still auto-filled, keeping the
// digit width. A direct edit to ANY trailer clears THAT trailer's own auto-fill flag — unlike legacy,
// which never cleared a later trailer's flag on direct edit, so a second edit to trailer 0 could
// silently clobber a hand-typed value on trailer 2+.
import { loadSuffix } from "@/lib/loadTimes";

export interface BolNumberState {
  numbers: string[];
  autoFilled: boolean[];
}

/** Apply one edit (`value` typed into trailer `index`) and the trailer-0 auto-fill. Inputs untouched. */
export function fillBolNumbers(numbers: string[], autoFilled: boolean[], index: number, value: string): BolNumberState {
  const nextNumbers = numbers.slice();
  const nextAuto = numbers.map((_, i) => !!autoFilled[i]);
  nextNumbers[index] = value;
  nextAuto[index] = false;
  if (index === 0) {
    const match = value.trim().match(/^(.+-)(\d+)$/);
    if (match) {
      const prefix = match[1];
      const startNum = parseInt(match[2], 10);
      for (let j = 1; j < nextNumbers.length; j++) {
        if (!nextNumbers[j] || nextAuto[j]) {
          const suffix = String(startNum + j).padStart(match[2].length, "0");
          nextNumbers[j] = prefix + suffix;
          nextAuto[j] = true;
        }
      }
    }
  }
  return { numbers: nextNumbers, autoFilled: nextAuto };
}

/** Seed for trailer `index` of `count`: `${invoice}-0N` when count > 1, the bare invoice for one, "" with no invoice. */
export function seedBolNumber(invoice: string, index: number, count: number): string {
  return loadSuffix(invoice || "", index + 1, count);
}

/**
 * Fit the per-trailer BOL #s to the current plan (re-pack / trailer count change). Values are kept
 * by index and trailers past `count` dropped. Hand-typed values never change. Then:
 *   - trailer 0 hand-typed → the same auto-fill rule runs from it (fills blank / still-auto trailers);
 *   - otherwise every blank / still-auto trailer is (re-)seeded from the invoice, so a 1 → 3 re-pack
 *     turns the untouched bare `4440` into `4440-01` beside `4440-02`, `4440-03`.
 * `prev` null = fresh seed.
 */
export function reconcileBolNumbers(prev: BolNumberState | null, count: number, invoice: string): BolNumberState {
  let numbers: string[] = [];
  let autoFilled: boolean[] = [];
  for (let i = 0; i < Math.max(0, count); i++) {
    const has = !!prev && i < prev.numbers.length;
    numbers.push(has ? prev!.numbers[i] : "");
    autoFilled.push(has ? !!prev!.autoFilled[i] : true);
  }
  const typedFirst = numbers.length > 0 && !autoFilled[0] && numbers[0] !== "";
  if (typedFirst) {
    ({ numbers, autoFilled } = fillBolNumbers(numbers, autoFilled, 0, numbers[0]));
  }
  for (let i = 0; i < numbers.length; i++) {
    if (!autoFilled[i] && numbers[i] !== "") continue; // hand-typed
    if (typedFirst && numbers[i] !== "") continue; // just filled from trailer 0
    numbers[i] = seedBolNumber(invoice, i, numbers.length);
    autoFilled[i] = true;
  }
  return { numbers, autoFilled };
}
