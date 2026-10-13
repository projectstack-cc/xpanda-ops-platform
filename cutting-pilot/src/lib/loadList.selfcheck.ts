// src/lib/loadList.selfcheck.ts
// lbr-08: guarded dev self-check for loadList.ts. Mirrors savedLoad.selfcheck.ts's shape — pure, no
// network.
import { addLine, setQty, step, clear, diffFromOrder, toPackSku, withSku } from "./loadList";
import type { CartLine, PackSku } from "./packEngine";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function sku(id: string, height = 10): PackSku {
  return { id, name: `${height}in block`, sku: id, length: 48, width: 24, height, weight: 1, allowRotation: false, category: "Blocks" };
}

export function runLoadListSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  const base: CartLine[] = [
    { skuId: "A", qty: 5 },
    { skuId: "B", qty: 2 },
  ];
  const frozen = JSON.stringify(base);

  // addLine
  {
    const added = addLine(base, sku("C"));
    check("addLine: new sku appended at qty 1", eq(added, [...base, { skuId: "C", qty: 1 }]), JSON.stringify(added));
    const merged = addLine(base, sku("A"), 3);
    check("addLine: same sku merges in place (order stable)", eq(merged, [{ skuId: "A", qty: 8 }, { skuId: "B", qty: 2 }]), JSON.stringify(merged));
    check("addLine: qty 0 on a new sku adds nothing", eq(addLine(base, sku("C"), 0), base));
    check("addLine: a negative add that empties a line drops it", eq(addLine(base, sku("B"), -2), [{ skuId: "A", qty: 5 }]));
    check("addLine: input not mutated", JSON.stringify(base) === frozen);
    check("addLine: returns a new array", addLine(base, sku("A")) !== base);
  }

  // setQty
  {
    check("setQty: sets in place", eq(setQty(base, "B", 7), [{ skuId: "A", qty: 5 }, { skuId: "B", qty: 7 }]));
    check("setQty: 0 removes the line", eq(setQty(base, "A", 0), [{ skuId: "B", qty: 2 }]));
    check("setQty: negative removes the line", eq(setQty(base, "A", -3), [{ skuId: "B", qty: 2 }]));
    check("setQty: NaN removes the line", eq(setQty(base, "A", Number.NaN), [{ skuId: "B", qty: 2 }]));
    check("setQty: unknown sku with qty > 0 is appended", eq(setQty(base, "Z", 4), [...base, { skuId: "Z", qty: 4 }]));
    check("setQty: unknown sku with qty 0 is a no-op", eq(setQty(base, "Z", 0), base));
    check("setQty: input not mutated", JSON.stringify(base) === frozen);
  }

  // step
  {
    check("step +1", eq(step(base, "A", 1), [{ skuId: "A", qty: 6 }, { skuId: "B", qty: 2 }]));
    check("step -1", eq(step(base, "B", -1), [{ skuId: "A", qty: 5 }, { skuId: "B", qty: 1 }]));
    const down = step(step(base, "B", -1), "B", -1);
    check("step -1 to zero drops the line", eq(down, [{ skuId: "A", qty: 5 }]), JSON.stringify(down));
    check("step +1 on an absent sku adds it at 1 (on the end)", eq(step(base, "C", 1), [...base, { skuId: "C", qty: 1 }]));
    check("step -1 on an absent sku is a no-op", eq(step(base, "C", -1), base));
    check("step: input not mutated", JSON.stringify(base) === frozen);
  }

  // clear
  {
    const c = clear(base);
    check("clear: empties the list", eq(c, []) && c !== base);
    check("clear: input not mutated", JSON.stringify(base) === frozen);
  }

  // diffFromOrder
  {
    check("diffFromOrder: identical -> empty", eq(diffFromOrder(base, base.map((c) => ({ ...c }))), []));
    const list: CartLine[] = [
      { skuId: "B", qty: 1 },
      { skuId: "C", qty: 20 },
    ];
    const d = diffFromOrder(base, list);
    check(
      "diffFromOrder: removed + changed (order-cart order), then added",
      eq(d, [
        { skuId: "A", orderQty: 5, listQty: 0 },
        { skuId: "B", orderQty: 2, listQty: 1 },
        { skuId: "C", orderQty: 0, listQty: 20 },
      ]),
      JSON.stringify(d)
    );
    check("diffFromOrder: reordering alone is not a change", eq(diffFromOrder(base, [base[1], base[0]]), []));
    check("diffFromOrder: empty order + list -> every line added", eq(diffFromOrder([], base), [{ skuId: "A", orderQty: 0, listQty: 5 }, { skuId: "B", orderQty: 0, listQty: 2 }]));
  }

  // toPackSku / withSku
  {
    const lib = { ...sku("L", 13), parentGroup: "13in HB" };
    const narrowed = toPackSku(lib);
    check("toPackSku: drops picker-only fields (parentGroup)", !("parentGroup" in narrowed) && narrowed.id === "L" && narrowed.height === 13);
    const skus = [sku("A"), sku("B")];
    const grown = withSku(skus, lib);
    check("withSku: appends a new sku, narrowed", grown.length === 3 && grown[2].id === "L" && !("parentGroup" in grown[2]));
    check("withSku: an existing id returns the same array", withSku(skus, sku("A")) === skus);
  }

  return { pass: results.every((r) => r.pass), results };
}
