// src/lib/zoneBol.selfcheck.ts
// lbz-v2-04: guarded dev self-check for zoneBol.ts. Pure (pdf-lib only for a width measurer), no
// network; same shape as the other Load Builder selfchecks.
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildBolZoneData } from "./zoneBol";
import { buildZoneColumns, type JobZoneLineItem } from "./bolShared";
import { zonedPack, UNZONED_LABEL } from "./zonedPack";
import { FOUR_ZONE, FOUR_ZONE_SKUS, fourZoneCart } from "./zonedPack.selfcheck";
import { pack, TRAILER_TYPES, DEFAULT_PACK_OPTIONS } from "./packEngine";
import type { CartLine } from "./packEngine";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const T53 = TRAILER_TYPES["53ft Standard"];
const OPTS = { ...DEFAULT_PACK_OPTIONS };

function linesFor(cart: CartLine[], density: (l: CartLine) => string | null = () => null): JobZoneLineItem[] {
  return cart.map((l, i) => ({ id: `li${i}`, part_id: l.skuId, quantity: l.qty, offload_seq: l.offloadSeq ?? null, zone_label: l.zoneLabel ?? null, density: density(l) }));
}

export async function runZoneBolSelfCheck(): Promise<{ pass: boolean; results: CheckResult[] }> {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);

  const plan = zonedPack(FOUR_ZONE, FOUR_ZONE_SKUS, T53, OPTS);
  const t0 = plan.trailers[0];
  const data = buildBolZoneData(t0, FOUR_ZONE_SKUS, linesFor(FOUR_ZONE));

  // 1. Per-trailer zone pieces sum to the trailer's units.
  check("1: zone pieces sum to trailer.totalUnits", data.reduce((n, z) => n + z.pieces, 0) === t0.totalUnits && t0.totalUnits === 766, String(data.reduce((n, z) => n + z.pieces, 0)));
  check("1: breakdown pieces sum to each zone's pieces", data.every((z) => Object.values(z.skuBreakdown).reduce((n, e) => n + e.pieces, 0) === z.pieces));
  check("1: four zones in delivery order, heights from the SKU", JSON.stringify(data.map((z) => z.label)) === JSON.stringify(["ZONE 1", "ZONE 2", "ZONE 3", "ZONE 4"]) && data.every((z) => Object.values(z.skuBreakdown).every((e) => e.height === Number(String(e.skuId).replace("HB_", "")))));

  // 2. A shared-row stack counts toward the zone that owns it (ZONE 2's 8" stack in ZONE 1's row).
  {
    const z1 = data.find((z) => z.label === "ZONE 1")!;
    const z2 = data.find((z) => z.label === "ZONE 2")!;
    const sharedRow = t0.rows.find((r) => new Set(r.columns.map((c) => c.zoneLabel)).size > 1 && r.columns.some((c) => c.zoneLabel === "ZONE 2"))!;
    check("2: fixture has a ZONE 1 / ZONE 2 shared row", !!sharedRow);
    check("2: ZONE 2 HB_8 = 17 (its shared-row stack included), ZONE 1 HB_8 = 40", z2.skuBreakdown.HB_8?.pieces === 17 && z1.skuBreakdown.HB_8?.pieces === 40, JSON.stringify([z2.skuBreakdown.HB_8, z1.skuBreakdown.HB_8]));
  }

  // 3. A zone spanning two trucks appears on both, each with only that truck's pieces (FOUR_ZONE x2).
  {
    const cart2 = fourZoneCart((q) => q * 2);
    const p2 = zonedPack(cart2, FOUR_ZONE_SKUS, T53, OPTS);
    const per = p2.trailers.map((t) => buildBolZoneData(t, FOUR_ZONE_SKUS, linesFor(cart2)));
    const spanning = per[0].filter((z) => per[1]?.some((y) => y.label === z.label)).map((z) => z.label);
    check("3: x2 makes 2 trucks with a zone on both", p2.trailers.length === 2 && spanning.length > 0, JSON.stringify(spanning));
    for (const label of spanning) {
      const a = per[0].find((z) => z.label === label)!;
      const b = per[1].find((z) => z.label === label)!;
      const onTruck = (ti: number) => p2.trailers[ti].rows.flatMap((r) => r.columns).filter((c) => c.zoneLabel === label).reduce((n, c) => n + c.stackCount, 0);
      const total = cart2.filter((l) => l.zoneLabel === label).reduce((n, l) => n + l.qty, 0);
      check(`3: ${label} on truck 1 = ${onTruck(0)}, truck 2 = ${onTruck(1)}, together the order's ${total}`, a.pieces === onTruck(0) && b.pieces === onTruck(1) && a.pieces + b.pieces === total && a.pieces > 0 && b.pieces > 0);
    }
    check("3: each truck's zones sum to that truck's units", per.every((zs, i) => zs.reduce((n, z) => n + z.pieces, 0) === p2.trailers[i].totalUnits));
  }

  // 4. Density: set on a single distinct match, null on two distinct values, null with no job lines.
  {
    const dens = (l: CartLine) => (l.zoneLabel === "ZONE 2" && l.skuId === "HB_7" ? "2.0#" : null);
    const one = buildBolZoneData(t0, FOUR_ZONE_SKUS, linesFor(FOUR_ZONE, dens));
    check("4: a single matching density is set (ZONE 2 HB_7 = 2.0#)", one.find((z) => z.label === "ZONE 2")!.skuBreakdown.HB_7?.density === "2.0#");
    check("4: the same SKU in another zone is not given it (ZONE 1 HB_7 = null)", one.find((z) => z.label === "ZONE 1")!.skuBreakdown.HB_7?.density === null);
    const conflicting = [...linesFor(FOUR_ZONE, dens), { id: "extra", part_id: "HB_7", quantity: 1, offload_seq: 2, zone_label: "ZONE 2", density: "1.5#" }];
    const two = buildBolZoneData(t0, FOUR_ZONE_SKUS, conflicting);
    check("4: two distinct densities on one key -> null", two.find((z) => z.label === "ZONE 2")!.skuBreakdown.HB_7?.density === null);
    const none = buildBolZoneData(t0, FOUR_ZONE_SKUS, null);
    check("4: no job lines -> every density null", none.every((z) => Object.values(z.skuBreakdown).every((e) => e.density === null)));
    const stringSeq = buildBolZoneData(t0, FOUR_ZONE_SKUS, linesFor(FOUR_ZONE, dens).map((li) => ({ ...li, offload_seq: String(li.offload_seq) as unknown as number })));
    check("4: a string offload_seq on the line still matches", stringSeq.find((z) => z.label === "ZONE 2")!.skuBreakdown.HB_7?.density === "2.0#");
  }

  // 5. bolShared.buildZoneColumns accepts the output.
  {
    let threw = false;
    let cols: ReturnType<typeof buildZoneColumns> | null = null;
    try {
      cols = buildZoneColumns(data, font);
    } catch {
      threw = true;
    }
    check("5: buildZoneColumns accepts it, one column item per zone", !threw && !!cols && cols.items.length === 4 && cols.items[0].text.startsWith('--"ZONE 1"--'), cols ? cols.items.map((i) => i.text.split("\n")[0]).join(" ") : "threw");
    check("5: the first column is marked *unload 1st*", !!cols && cols.items[0].text.split("\n")[1] === "*unload 1st*");
  }

  // 6. An Unzoned group appears with its label and doesn't throw.
  {
    const cart: CartLine[] = [...fourZoneCart((q) => Math.ceil(q / 3)), { skuId: "HB_4", qty: 30 }];
    const pu = zonedPack(cart, FOUR_ZONE_SKUS, T53, OPTS);
    const zu = buildBolZoneData(pu.trailers[0], FOUR_ZONE_SKUS, linesFor(cart));
    const unz = zu.find((z) => z.label === UNZONED_LABEL);
    let threw = false;
    try {
      buildZoneColumns(zu, font);
    } catch {
      threw = true;
    }
    check("6: Unzoned appears, last, with its pieces and no color", !!unz && zu[zu.length - 1] === unz && unz.pieces === 30 && unz.offloadSeq === null && unz.color === undefined);
    check("6: buildZoneColumns doesn't throw with an Unzoned group", !threw);
  }

  // Non-zoned trailer -> nothing.
  {
    const plain = pack(FOUR_ZONE.map(({ skuId, qty }) => ({ skuId, qty })), FOUR_ZONE_SKUS, T53, OPTS);
    check("non-zoned trailer -> no zone data", buildBolZoneData(plain.trailers[0], FOUR_ZONE_SKUS, linesFor(FOUR_ZONE)).length === 0);
  }

  return { pass: results.every((r) => r.pass), results };
}
