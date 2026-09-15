// src/lib/jobPull.selfcheck.ts
// Guarded dev self-check for jobPull.ts (lb-ui-05 Part C). Mirrors dissolve.selfcheck.ts's shape:
// hand-built fixtures, a check()/results table, one exported run*SelfCheck() function. Not part of
// the production build path.
import type { PackSku } from "./packEngine";
import { parseDimensionString, matchLineItemsToSkus, buildCartFromMatches, colorForSkuId, type JobLineItem } from "./jobPull";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function makeSku(id: string, length: number, width: number, height: number, skuCode: string): PackSku {
  return { id, name: `SKU ${id}`, sku: skuCode, length, width, height, weight: 10, category: "Blocks", allowRotation: true };
}

function makeLineItem(overrides: Partial<JobLineItem>): JobLineItem {
  return {
    id: "li-1",
    job_id: "job-1",
    part_id: null,
    part_number: "",
    description: "",
    quantity: 1,
    dimensions: "",
    sort_order: 0,
    ...overrides,
  };
}

export function runJobPullSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  // 1. parseDimensionString: whole numbers, decimals, and fraction notation in all three positions.
  {
    const whole = parseDimensionString("48 x 24 x 8");
    check("parseDimensionString: whole numbers", !!whole && whole.length === 48 && whole.width === 24 && whole.height === 8, JSON.stringify(whole));

    const decimal = parseDimensionString("54.75 x 90.75 x 8.5");
    check(
      "parseDimensionString: decimals",
      !!decimal && decimal.length === 54.75 && decimal.width === 90.75 && decimal.height === 8.5,
      JSON.stringify(decimal)
    );

    const fracLength = parseDimensionString("1-1/2 x 24 x 8");
    check("parseDimensionString: mixed fraction in length position", !!fracLength && fracLength.length === 1.5, JSON.stringify(fracLength));

    const fracWidth = parseDimensionString("48 x 1-1/2 x 8");
    check("parseDimensionString: mixed fraction in width position", !!fracWidth && fracWidth.width === 1.5, JSON.stringify(fracWidth));

    const fracHeight = parseDimensionString("48 x 24 x 1-1/2");
    check("parseDimensionString: mixed fraction in height position", !!fracHeight && fracHeight.height === 1.5, JSON.stringify(fracHeight));

    const plainFrac = parseDimensionString("48 x 24 x 1/2");
    check("parseDimensionString: plain fraction (no whole part)", !!plainFrac && plainFrac.height === 0.5, JSON.stringify(plainFrac));

    const twoPart = parseDimensionString("48 x 24");
    check(
      "parseDimensionString: two-part string defaults height to width (legacy quirk, ported faithfully)",
      !!twoPart && twoPart.length === 48 && twoPart.width === 24 && twoPart.height === 24,
      JSON.stringify(twoPart)
    );
  }

  // 2. parseDimensionString returns null (not a throw, not NaN) on unparseable input.
  {
    let threw = false;
    let result: ReturnType<typeof parseDimensionString> = undefined as any;
    try {
      result = parseDimensionString("not a dimension");
    } catch {
      threw = true;
    }
    check("parseDimensionString: unparseable input returns null, does not throw", !threw && result === null, String(result));

    check("parseDimensionString: empty string returns null", parseDimensionString("") === null);
    check("parseDimensionString: single segment (no 'x') returns null", parseDimensionString("48") === null);
  }

  // 3. part_id wins even when part_number/dimensions would also match a DIFFERENT sku.
  {
    const byId = makeSku("SKU_ID_MATCH", 48, 24, 8, "BY-ID");
    const byNumber = makeSku("SKU_NUMBER_MATCH", 48, 24, 8, "BY-NUMBER");
    const li = makeLineItem({ part_id: "SKU_ID_MATCH", part_number: "BY-NUMBER", dimensions: "48 x 24 x 8" });
    const matches = matchLineItemsToSkus([li], [byId, byNumber]);
    check(
      "matchLineItemsToSkus: part_id wins over a part_number that would match a different sku",
      matches[0].matchedSkuId === "SKU_ID_MATCH",
      JSON.stringify(matches)
    );
  }

  // 4. No part_id (or part_id doesn't match anything) but part_number matches.
  {
    const sku = makeSku("SKU_A", 48, 24, 8, "PART-42");
    const li = makeLineItem({ part_id: null, part_number: "part-42" }); // case-insensitive
    const matches = matchLineItemsToSkus([li], [sku]);
    check("matchLineItemsToSkus: falls through to part_number, case-insensitive", matches[0].matchedSkuId === "SKU_A", JSON.stringify(matches));
  }

  // 5. Neither part_id nor part_number match, but parseable dimensions match an existing sku.
  {
    const sku = makeSku("SKU_DIM", 54.75, 90.75, 8, "SOME-CODE");
    const li = makeLineItem({ part_id: "no-such-id", part_number: "no-such-number", dimensions: "54.75 x 90.75 x 8" });
    const matches = matchLineItemsToSkus([li], [sku]);
    check("matchLineItemsToSkus: falls through to parsed dimensions", matches[0].matchedSkuId === "SKU_DIM", JSON.stringify(matches));
  }

  // 6. A line matching nothing on any of the three stays in the results array, marked unmatched.
  {
    const sku = makeSku("SKU_X", 10, 10, 10, "X");
    const li = makeLineItem({ part_id: "nope", part_number: "nope", dimensions: "99 x 99 x 99" });
    const matches = matchLineItemsToSkus([li], [sku]);
    check(
      "matchLineItemsToSkus: unmatched line stays present with matchedSkuId: null (not dropped)",
      matches.length === 1 && matches[0].matchedSkuId === null,
      JSON.stringify(matches)
    );
  }

  // 7. buildCartFromMatches excludes unmatched lines and sums quantity for a repeated sku.
  {
    const sku = makeSku("SKU_REPEAT", 48, 24, 8, "REPEAT");
    const matched1 = makeLineItem({ id: "li-1", part_id: "SKU_REPEAT", quantity: 5 });
    const matched2 = makeLineItem({ id: "li-2", part_id: "SKU_REPEAT", quantity: 3 });
    const unmatched = makeLineItem({ id: "li-3", part_id: "no-match", quantity: 7 });
    const matches = matchLineItemsToSkus([matched1, matched2, unmatched], [sku]);
    const cart = buildCartFromMatches(matches);
    check(
      "buildCartFromMatches: excludes unmatched line, sums quantity across repeated sku (5+3=8)",
      cart.length === 1 && cart[0].skuId === "SKU_REPEAT" && cart[0].qty === 8,
      JSON.stringify(cart)
    );
  }

  // 8. colorForSkuId is deterministic (same id -> same color) and always returns a palette member.
  {
    const PALETTE = [
      "#D97706", "#0F766E", "#2563EB", "#7C3AED", "#DC2626", "#059669", "#9333EA", "#0891B2",
      "#CA8A04", "#4F46E5", "#EA580C", "#16A34A", "#0284C7", "#BE123C", "#A21CAF", "#4338CA",
    ];
    const c1 = colorForSkuId("SOME_SKU_ID");
    const c2 = colorForSkuId("SOME_SKU_ID");
    check("colorForSkuId: deterministic for the same skuId", c1 === c2, `${c1} vs ${c2}`);
    check("colorForSkuId: returns a color from the same palette packEngine.ts uses", PALETTE.includes(c1), c1);
  }

  return { pass: results.every((r) => r.pass), results };
}
