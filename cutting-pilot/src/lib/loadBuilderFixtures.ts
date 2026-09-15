// src/lib/loadBuilderFixtures.ts
// lb-ui-01: the three real orders used to exercise the v2 packing engine, extracted from
// packEngine.selfcheck.ts (FIXTURE_BLOCKS_PAIRING, FIXTURE_HOLEY_SIPLAST, FIXTURE_BLOCKS_MIXED)
// so the read-only plan view's fixture picker and the selfcheck's own fixtures both read from one
// place — the selfcheck now imports these instead of duplicating the SKU/cart literals. Labeled by
// their real invoice numbers: INV_4202 (AccuDock, 108 pieces), INV_4356 (Siplast holey board),
// INV_4347 (AccuDock mixed, 94 pieces).
import type { CartLine, PackSku } from "./packEngine";

export interface LoadBuilderFixture {
  id: string;
  invoiceNumber: string;
  customer: string;
  label: string;
  cart: CartLine[];
  skus: PackSku[];
}

// --- INV_4202 — AccuDock. The load legacy could not fit on one truck. Declared with 90.75" as
// the length axis already, matching the "orient with 90.75 down the trailer length" pairing
// decision. ---
const skuPairA: PackSku = { id: "PAIR_A", name: "42.75x90.75x8", sku: "PAIR-A", length: 90.75, width: 42.75, height: 8, weight: 40, category: "Blocks", allowRotation: true };
const skuPairB: PackSku = { id: "PAIR_B", name: "54.75x90.75x8", sku: "PAIR-B", length: 90.75, width: 54.75, height: 8, weight: 40, category: "Blocks", allowRotation: true };
const skuPairC: PackSku = { id: "PAIR_C", name: "54.75x66.75x8", sku: "PAIR-C", length: 66.75, width: 54.75, height: 8, weight: 40, category: "Blocks", allowRotation: true };
const skuPairD: PackSku = { id: "PAIR_D", name: "24.75x90.75x4", sku: "PAIR-D", length: 90.75, width: 24.75, height: 4, weight: 25, category: "Blocks", allowRotation: true };

export const FIXTURE_BLOCKS_PAIRING: LoadBuilderFixture = {
  id: "FIXTURE_BLOCKS_PAIRING",
  invoiceNumber: "INV_4202",
  customer: "AccuDock",
  label: "INV_4202 — AccuDock (108 pieces)",
  skus: [skuPairA, skuPairB, skuPairC, skuPairD],
  cart: [
    { skuId: "PAIR_A", qty: 43 },
    { skuId: "PAIR_B", qty: 40 },
    { skuId: "PAIR_C", qty: 15 },
    { skuId: "PAIR_D", qty: 10 },
  ],
};

// --- INV_4356 — Siplast holey board. Base qty 676 = 52 columns x 13 per column exactly; a second
// SKU on the same 48x24 footprint (qty 52, height 5") tops off every base column's 5" residual. ---
const siplastSku: PackSku = { id: "SIPLAST", name: "Siplast holey board", sku: "SIPLAST-1", length: 48, width: 24, height: 8, weight: 5, category: "Holey Board", allowRotation: false };
const siplastTopoffSku: PackSku = { id: "SIPLAST_TOPOFF", name: "Siplast holey board (5in)", sku: "SIPLAST-2", length: 48, width: 24, height: 5, weight: 4, category: "Holey Board", allowRotation: false };

export const FIXTURE_HOLEY_SIPLAST: LoadBuilderFixture = {
  id: "FIXTURE_HOLEY_SIPLAST",
  invoiceNumber: "INV_4356",
  customer: "Siplast",
  label: "INV_4356 — Siplast holey board (728 pieces)",
  skus: [siplastSku, siplastTopoffSku],
  cart: [
    { skuId: "SIPLAST", qty: 676 },
    { skuId: "SIPLAST_TOPOFF", qty: 52 },
  ],
};

// --- INV_4347 — AccuDock mixed. 94 pieces across six footprints; the dominant 54.75x90.75
// footprint carries four labels at three thicknesses (8", 9", 5.25"). ---
const mixSeaRay8: PackSku = { id: "MIX_SEARAY8", name: "Sea Ray", sku: "SEARAY-8", length: 54.75, width: 90.75, height: 8, weight: 30, category: "Blocks", allowRotation: true };
const mixStock8: PackSku = { id: "MIX_STOCK8", name: "STOCK", sku: "STOCK-8", length: 54.75, width: 90.75, height: 8, weight: 30, category: "Blocks", allowRotation: true };
const mixKansas525: PackSku = { id: "MIX_KANSAS525", name: "Kansas", sku: "KANSAS-5.25", length: 54.75, width: 90.75, height: 5.25, weight: 20, category: "Blocks", allowRotation: true };
const mixSeaRay9: PackSku = { id: "MIX_SEARAY9", name: "Sea Ray", sku: "SEARAY-9", length: 54.75, width: 90.75, height: 9, weight: 32, category: "Blocks", allowRotation: true };
const mixNoriaA: PackSku = { id: "MIX_NORIA_A", name: "Noria", sku: "NORIA-A", length: 19.75, width: 30.75, height: 8, weight: 10, category: "Blocks", allowRotation: true };
const mixKansasComp: PackSku = { id: "MIX_KANSAS_COMP", name: "Kansas Comp", sku: "KANSAS-COMP", length: 24.75, width: 54.75, height: 8, weight: 15, category: "Blocks", allowRotation: true };
const mixWestwegoCA: PackSku = { id: "MIX_WESTWEGO_CA", name: "Westwego CA Comp", sku: "WESTWEGO-CA", length: 24.75, width: 54.75, height: 6, weight: 12, category: "Blocks", allowRotation: true };
const mixKAB: PackSku = { id: "MIX_KAB", name: "KAB CA Comps", sku: "KAB-CA", length: 42.75, width: 54.75, height: 7, weight: 18, category: "Blocks", allowRotation: true };
const mixWestwegoGW: PackSku = { id: "MIX_WESTWEGO_GW", name: "Westwego GW Comp", sku: "WESTWEGO-GW", length: 42.75, width: 54.75, height: 7, weight: 18, category: "Blocks", allowRotation: true };
const mixCharlotte: PackSku = { id: "MIX_CHARLOTTE", name: "Charlotte County", sku: "CHARLOTTE", length: 54.75, width: 66.75, height: 12, weight: 25, category: "Blocks", allowRotation: true };
const mixNoriaB: PackSku = { id: "MIX_NORIA_B", name: "Noria", sku: "NORIA-B", length: 30.75, width: 90.75, height: 8, weight: 20, category: "Blocks", allowRotation: true };

export const FIXTURE_BLOCKS_MIXED: LoadBuilderFixture = {
  id: "FIXTURE_BLOCKS_MIXED",
  invoiceNumber: "INV_4347",
  customer: "AccuDock",
  label: "INV_4347 — AccuDock mixed (94 pieces)",
  skus: [mixSeaRay8, mixStock8, mixKansas525, mixSeaRay9, mixNoriaA, mixKansasComp, mixWestwegoCA, mixKAB, mixWestwegoGW, mixCharlotte, mixNoriaB],
  cart: [
    { skuId: "MIX_SEARAY8", qty: 25 },
    { skuId: "MIX_STOCK8", qty: 35 },
    { skuId: "MIX_KANSAS525", qty: 18 },
    { skuId: "MIX_SEARAY9", qty: 2 },
    { skuId: "MIX_NORIA_A", qty: 6 },
    { skuId: "MIX_KANSAS_COMP", qty: 2 },
    { skuId: "MIX_WESTWEGO_CA", qty: 1 },
    { skuId: "MIX_KAB", qty: 2 },
    { skuId: "MIX_WESTWEGO_GW", qty: 1 },
    { skuId: "MIX_CHARLOTTE", qty: 1 },
    { skuId: "MIX_NORIA_B", qty: 1 },
  ],
};

export const LOAD_BUILDER_FIXTURES: LoadBuilderFixture[] = [
  FIXTURE_BLOCKS_PAIRING,
  FIXTURE_HOLEY_SIPLAST,
  FIXTURE_BLOCKS_MIXED,
];
