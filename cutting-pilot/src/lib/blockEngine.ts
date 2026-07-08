// blockEngine.ts — heterogeneous rectangular guillotine block-cut engine.
// Faithful TypeScript port of the trusted vanilla engine in
// manufacturing/block-calculator.html (calcForPerm, runPrimaryCalc, bestFitInBox,
// calcSecondaryPart, runFullCalc; constants PERMS, DIM_NAMES). Pure — no DOM/React/I/O — so it runs
// identically client-side (P229 planner screen) and server-side (P228 save route recompute).
//
// LOAD-BEARING: kerf is added to BOTH numerator and effective size:
//   n = floor((blockDim + kerf) / (part + kerf))  →  part == blockDim yields n = 1.
// Do not change this; the legacy results are trusted against it.

export const DIM_NAMES = ["Length", "Width", "Height"] as const;
export const PERMS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

export type OrientationMode = "auto" | "fixed";

export interface SecondaryInput {
  id: string;
  label: string;
  L: number;
  W: number;
  H: number;
  qty?: number | null;
}

export interface BlockCalcInput {
  bL: number; bW: number; bH: number;
  pL: number; pW: number; pH: number;
  kerf: number;
  primaryQty: number | null;
  mode: OrientationMode;
  secondaryParts: SecondaryInput[];
}

export interface PermResult {
  total: number;
  nL: number; nW: number; nH: number;
  effL: number; effW: number; effH: number;
  remL: number; remW: number; remH: number;
  partDimL: number; partDimW: number; partDimH: number;
  partNameL: string; partNameW: string; partNameH: string;
  blockVol: number; volUsed: number; wasteVol: number; utilPct: number;
  bL: number; bW: number; bH: number;
}

export interface ZoneResult {
  total: number;
  nA: number; nB: number; nC: number;
  pA: number; pB: number; pC: number;
  effA: number; effB: number; effC: number;
  remA: number; remB: number; remC: number;
  zoneName?: string;
}

export interface SecondaryResult {
  label: string;
  zone1: ZoneResult; zone2: ZoneResult; zone3: ZoneResult;
  totalPieces: number;
  _secId: string;
  _dims: { L: number; W: number; H: number };
  _qty: number | null;
}

export interface BlockCalcResult {
  primary: PermResult;
  secondaries: SecondaryResult[];
  blocksNeeded: number | null;
  totalProduced: number | null;
  surplus: number | null;
  primaryQty: number | null;
  mode: OrientationMode;
}

function calcForPerm(
  bL: number, bW: number, bH: number,
  partDims: [number, number, number], kerf: number,
  perm: readonly [number, number, number]
): PermResult {
  const pA = partDims[perm[0]], pB = partDims[perm[1]], pC = partDims[perm[2]];
  const effL = pA + kerf, effW = pB + kerf, effH = pC + kerf;
  const nL = Math.floor((bL + kerf) / effL);
  const nW = Math.floor((bW + kerf) / effW);
  const nH = Math.floor((bH + kerf) / effH);
  const remL = bL - (nL > 0 ? nL * pA + (nL - 1) * kerf : 0);
  const remW = bW - (nW > 0 ? nW * pB + (nW - 1) * kerf : 0);
  const remH = bH - (nH > 0 ? nH * pC + (nH - 1) * kerf : 0);
  const total = nL * nW * nH;
  const blockVol = bL * bW * bH;
  const volUsed = total * (pA * pB * pC);
  return {
    total, nL, nW, nH, effL, effW, effH, remL, remW, remH,
    partDimL: pA, partDimW: pB, partDimH: pC,
    partNameL: DIM_NAMES[perm[0]], partNameW: DIM_NAMES[perm[1]], partNameH: DIM_NAMES[perm[2]],
    blockVol, volUsed, wasteVol: blockVol - volUsed,
    utilPct: blockVol > 0 ? (volUsed / blockVol) * 100 : 0,
    bL, bW, bH,
  };
}

function runPrimaryCalc(
  bL: number, bW: number, bH: number,
  pL: number, pW: number, pH: number,
  kerf: number, mode: OrientationMode
): PermResult {
  const dims: [number, number, number] = [pL, pW, pH];
  if (mode === "auto") {
    let best: PermResult | null = null;
    for (const p of PERMS) {
      const r = calcForPerm(bL, bW, bH, dims, kerf, p);
      if (!best || r.total > best.total || (r.total === best.total && r.wasteVol < best.wasteVol)) {
        best = r;
      }
    }
    return best!;
  }
  return calcForPerm(bL, bW, bH, dims, kerf, PERMS[0]);
}

function bestFitInBox(
  d1: number, d2: number, d3: number,
  partDims: [number, number, number], kerf: number, mode: OrientationMode
): ZoneResult {
  if (d1 <= 0.001 || d2 <= 0.001 || d3 <= 0.001) {
    return { total: 0, nA: 0, nB: 0, nC: 0, pA: 0, pB: 0, pC: 0,
             effA: 0, effB: 0, effC: 0, remA: d1, remB: d2, remC: d3 };
  }
  const build = (perm: readonly [number, number, number]): ZoneResult => {
    const pA = partDims[perm[0]], pB = partDims[perm[1]], pC = partDims[perm[2]];
    const eA = pA + kerf, eB = pB + kerf, eC = pC + kerf;
    const nA = Math.floor((d1 + kerf) / eA);
    const nB = Math.floor((d2 + kerf) / eB);
    const nC = Math.floor((d3 + kerf) / eC);
    return {
      total: nA * nB * nC, nA, nB, nC, pA, pB, pC, effA: eA, effB: eB, effC: eC,
      remA: d1 - (nA > 0 ? nA * pA + (nA - 1) * kerf : 0),
      remB: d2 - (nB > 0 ? nB * pB + (nB - 1) * kerf : 0),
      remC: d3 - (nC > 0 ? nC * pC + (nC - 1) * kerf : 0),
    };
  };
  if (mode === "auto") {
    let best: ZoneResult | null = null;
    for (const perm of PERMS) {
      const r = build(perm);
      if (!best || r.total > best.total ||
          (r.total === best.total && r.nA + r.nB + r.nC > best.nA + best.nB + best.nC)) {
        best = r;
      }
    }
    return best!;
  }
  return build([0, 1, 2]);
}

function calcSecondaryPart(
  sec: SecondaryInput, primary: PermResult, kerf: number, mode: OrientationMode
): Omit<SecondaryResult, "_secId" | "_dims" | "_qty"> {
  const { bL, bW, bH, nL, nW, nH, effL, effW, effH, remL, remW, remH } = primary;
  const usedW = nW * effW;
  const usedH = nH * effH;
  void nL; void effL; void remL; void bW; void bH; // parity with legacy destructure
  const dims: [number, number, number] = [sec.L, sec.W, sec.H];
  const zone2: ZoneResult = { ...bestFitInBox(bL, remW, bH, dims, kerf, mode), zoneName: "W-end" };
  const zone3: ZoneResult = { ...bestFitInBox(bL, usedW, remH, dims, kerf, mode), zoneName: "H-end" };
  const zone1: ZoneResult = { ...bestFitInBox(remL, usedW, usedH, dims, kerf, mode), zoneName: "L-end" };
  return { label: sec.label, zone1, zone2, zone3, totalPieces: zone1.total + zone2.total + zone3.total };
}

export function runFullCalc(inp: BlockCalcInput): BlockCalcResult {
  const { bL, bW, bH, pL, pW, pH, kerf, primaryQty, mode, secondaryParts } = inp;
  const primary = runPrimaryCalc(bL, bW, bH, pL, pW, pH, kerf, mode);

  const validSecs = secondaryParts.filter((s) => s.L > 0 && s.W > 0 && s.H > 0);
  const secondaries: SecondaryResult[] = validSecs.map((s) => ({
    ...calcSecondaryPart(s, primary, kerf, mode),
    _secId: s.id,
    _dims: { L: s.L, W: s.W, H: s.H },
    _qty: s.qty && s.qty > 0 ? s.qty : null,
  }));

  let blocksNeeded: number | null = null;
  if (primaryQty && primaryQty > 0 && primary.total > 0) {
    blocksNeeded = Math.ceil(primaryQty / primary.total);
  }
  for (const sec of secondaries) {
    if (sec._qty && sec._qty > 0 && sec.totalPieces > 0) {
      const n = Math.ceil(sec._qty / sec.totalPieces);
      blocksNeeded = blocksNeeded !== null ? Math.max(blocksNeeded, n) : n;
    }
  }

  const totalProduced = blocksNeeded !== null ? blocksNeeded * primary.total : null;
  const surplus = blocksNeeded !== null && primaryQty ? totalProduced! - primaryQty : null;

  return { primary, secondaries, blocksNeeded, totalProduced, surplus, primaryQty, mode };
}
