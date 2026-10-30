// src/lib/blockCalc/cutList.ts — blk-01
// Pure helpers around the block-calc engine for /v2/blocks/calculator: input validation, machine
// routing, the cut-list rows, the orientation note and the stat-tile numbers. Line-for-line port of
// manufacturing/block-calculator.html (validate, machineFor, buildCutListRows, buildOrientNoteText,
// renderStats). No React, DOM or I/O. The calc itself is ONLY runFullCalc from lib/blockEngine.ts —
// no engine math is copied or re-derived here.
//
// Data stays English and raw (machine / axis names, numbers): the UI translates and formats
// (spacing toFixed(3), remnant < 0.005 → 0 else toFixed(2)).
import { parseInches } from "@/lib/inches";
import type { BlockCalcInput, BlockCalcResult, OrientationMode } from "@/lib/blockEngine";

export type Axis = "Length" | "Width" | "Height";
export type MachineName = "Cross Cutter" | "Main Line" | "Blue Line";
export type ZoneName = "L-end" | "W-end" | "H-end";

/** Main Line is always on; only Cross Cutter and Blue Line can be turned off. */
export interface Routing {
  crossCutter: boolean;
  blueLine: boolean;
}

export interface Machine {
  name: MachineName;
  rerouted: boolean;
  from?: MachineName;
}

// Legacy machineFor(): Length → Cross Cutter (else Main Line from Cross Cutter), Height → Blue Line
// (else Main Line from Blue Line), Width → always Main Line.
export function machineFor(axis: Axis, routing: Routing): Machine {
  if (axis === "Length")
    return routing.crossCutter
      ? { name: "Cross Cutter", rerouted: false }
      : { name: "Main Line", rerouted: true, from: "Cross Cutter" };
  if (axis === "Height")
    return routing.blueLine
      ? { name: "Blue Line", rerouted: false }
      : { name: "Main Line", rerouted: true, from: "Blue Line" };
  return { name: "Main Line", rerouted: false };
}

export interface LibPartRef {
  part_number?: string;
  customer?: string;
}

export interface CutListRow {
  step: number;
  machine: MachineName;
  machine_rerouted: boolean;
  machine_rerouted_from: MachineName | "";
  direction: Axis;
  /** Auto mode, non-identity orientation, primary row whose source axis differs: the part axis. */
  remapFrom: Axis | null;
  /** Legacy export label: "Primary" or "<label> (L remnant)". */
  part_label: string;
  /** Secondary label alone (null on primary rows) — the UI composes the translated part cell. */
  sec_label: string | null;
  zone: ZoneName | null;
  part_number: string;
  customer: string;
  pieces: number;
  spacing: number;
  remnant: number;
}

const ZONE_LABEL: Record<ZoneName, string> = { "L-end": "L remnant", "W-end": "W remnant", "H-end": "H remnant" };

function isIdentity(calc: BlockCalcResult): boolean {
  const p = calc.primary;
  return p.partNameL === "Length" && p.partNameW === "Width" && p.partNameH === "Height";
}

export function buildCutListRows(
  calc: BlockCalcResult,
  routing: Routing,
  primaryLib: LibPartRef | null,
  secLibById: Record<string, LibPartRef | null | undefined>
): CutListRow[] {
  const p = calc.primary;
  const isRemap = calc.mode === "auto" && !isIdentity(calc);

  const rows: CutListRow[] = [];
  let step = 1;

  const primaryAxes: { axis: Axis; n: number; sp: number; rem: number; from: Axis }[] = [
    { axis: "Length", n: p.nL, sp: p.effL, rem: p.remL, from: p.partNameL as Axis },
    { axis: "Width", n: p.nW, sp: p.effW, rem: p.remW, from: p.partNameW as Axis },
    { axis: "Height", n: p.nH, sp: p.effH, rem: p.remH, from: p.partNameH as Axis },
  ];
  for (const ax of primaryAxes) {
    const m = machineFor(ax.axis, routing);
    rows.push({
      step: step++,
      machine: m.name,
      machine_rerouted: m.rerouted,
      machine_rerouted_from: m.rerouted ? m.from ?? "" : "",
      direction: ax.axis,
      remapFrom: isRemap && ax.from !== ax.axis ? ax.from : null,
      part_label: "Primary",
      sec_label: null,
      zone: null,
      part_number: primaryLib?.part_number || "",
      customer: primaryLib?.customer || "",
      pieces: ax.n,
      spacing: ax.sp,
      remnant: ax.rem,
    });
  }

  for (const sec of calc.secondaries) {
    const sl = secLibById[sec._secId] || null;
    for (const zone of [sec.zone1, sec.zone2, sec.zone3]) {
      if (zone.total <= 0) continue;
      const zoneName = zone.zoneName as ZoneName;
      const zAxes: { axis: Axis; n: number; sp: number; rem: number }[] = [
        { axis: "Length", n: zone.nA, sp: zone.effA, rem: zone.remA },
        { axis: "Width", n: zone.nB, sp: zone.effB, rem: zone.remB },
        { axis: "Height", n: zone.nC, sp: zone.effC, rem: zone.remC },
      ];
      for (const ax of zAxes) {
        if (ax.n <= 0) continue;
        const m = machineFor(ax.axis, routing);
        rows.push({
          step: step++,
          machine: m.name,
          machine_rerouted: m.rerouted,
          machine_rerouted_from: m.rerouted ? m.from ?? "" : "",
          direction: ax.axis,
          remapFrom: null,
          part_label: `${sec.label} (${ZONE_LABEL[zoneName]})`,
          sec_label: sec.label,
          zone: zoneName,
          part_number: sl?.part_number || "",
          customer: sl?.customer || "",
          pieces: ax.n,
          spacing: ax.sp,
          remnant: ax.rem,
        });
      }
    }
  }

  return rows;
}

export type OrientNote =
  | null
  | "identity"
  | { L: { name: Axis; dim: number }; W: { name: Axis; dim: number }; H: { name: Axis; dim: number } };

// Legacy buildOrientNoteText / renderOrientNote: nothing in fixed mode; "optimal" when the auto pick
// is the as-entered orientation; otherwise which part axis lands on each block axis.
export function orientNote(calc: BlockCalcResult): OrientNote {
  if (calc.mode !== "auto") return null;
  if (isIdentity(calc)) return "identity";
  const p = calc.primary;
  return {
    L: { name: p.partNameL as Axis, dim: p.partDimL },
    W: { name: p.partNameW as Axis, dim: p.partDimW },
    H: { name: p.partNameH as Axis, dim: p.partDimH },
  };
}

export interface CalcStats {
  partsPerBlock: number;
  nL: number;
  nW: number;
  nH: number;
  /** Combined (primary + all secondary volume) / block volume × 100. */
  utilPct: number;
  /** ≥ 75 good, ≥ 50 warn, else danger — legacy util-bar thresholds. */
  utilTone: "good" | "warn" | "danger";
  /** Cubic inches, Math.round(blockVol − combinedVolUsed). */
  waste: number;
  blocksNeeded: number | null;
  /** Shown when blocksNeeded !== null and a primary qty was entered. */
  primaryProduced: { produced: number; surplus: number; needed: number } | null;
  /** One per secondary with a qty and totalPieces > 0 (only when blocksNeeded !== null). */
  secondaryOrdered: { label: string; qty: number; produced: number; surplus: number }[];
  /** Null when no secondary yields anything. */
  secondaryTotal: { total: number; breakdown: { pieces: number; label: string }[] } | null;
}

// Legacy renderStats() as numbers.
export function stats(calc: BlockCalcResult): CalcStats {
  const p = calc.primary;
  const secVolUsed = calc.secondaries.reduce(
    (sum, sec) => sum + sec.totalPieces * (sec._dims.L * sec._dims.W * sec._dims.H),
    0
  );
  const combinedVolUsed = p.volUsed + secVolUsed;
  const utilPct = (combinedVolUsed / p.blockVol) * 100;
  const waste = Math.round(p.blockVol - combinedVolUsed);

  let primaryProduced: CalcStats["primaryProduced"] = null;
  const secondaryOrdered: CalcStats["secondaryOrdered"] = [];
  if (calc.blocksNeeded !== null) {
    if (calc.primaryQty) {
      const produced = calc.blocksNeeded * p.total;
      primaryProduced = { produced, surplus: produced - calc.primaryQty, needed: calc.primaryQty };
    }
    for (const sec of calc.secondaries) {
      if (!sec._qty || sec.totalPieces === 0) continue;
      const produced = calc.blocksNeeded * sec.totalPieces;
      secondaryOrdered.push({ label: sec.label, qty: sec._qty, produced, surplus: produced - sec._qty });
    }
  }

  const total = calc.secondaries.reduce((s, x) => s + x.totalPieces, 0);
  const secondaryTotal =
    total > 0
      ? {
          total,
          breakdown: calc.secondaries
            .filter((s) => s.totalPieces > 0)
            .map((s) => ({ pieces: s.totalPieces, label: s.label })),
        }
      : null;

  return {
    partsPerBlock: p.total,
    nL: p.nL,
    nW: p.nW,
    nH: p.nH,
    utilPct,
    utilTone: utilPct >= 75 ? "good" : utilPct >= 50 ? "warn" : "danger",
    waste,
    blocksNeeded: calc.blocksNeeded,
    primaryProduced,
    secondaryOrdered,
    secondaryTotal,
  };
}

// ─── validation ──────────────────────────────────────────────────────────────

export interface RawSecondary {
  id: string;
  /** Already defaulted by the UI ("Secondary N", translated) when the operator left it blank. */
  label: string;
  L: string;
  W: string;
  H: string;
  qty: string;
}

export interface RawInput {
  bL: string; bW: string; bH: string;
  pL: string; pW: string; pH: string;
  kerf: string;
  primaryQty: string;
  mode: OrientationMode;
  secondaries: RawSecondary[];
}

export type ValidateResult =
  | { ok: true; input: BlockCalcInput }
  | { ok: false; key: string; vars?: Record<string, string> };

// Inch fields: fraction or decimal via parseInches ("2 1/4" → 2.25). Blank → null.
function dim(raw: string): number | null {
  return parseInches(raw);
}

// Qty: blank → null (no qty); anything else must parse as a positive whole number — NaN otherwise.
function qty(raw: string): number | null {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  return /^\d+(\.\d*)?$/.test(s) ? Number(s) : NaN;
}

function badQty(q: number | null): boolean {
  return q !== null && !(q > 0 && Number.isInteger(q));
}

// Legacy validate(): same order and rules, returning the message key (blockCalc.*) + vars.
// Kerf left blank is 0 (legacy Number("") === 0); unparsable kerf is the kerf error.
export function validate(raw: RawInput): ValidateResult {
  const bL = dim(raw.bL), bW = dim(raw.bW), bH = dim(raw.bH);
  const pL = dim(raw.pL), pW = dim(raw.pW), pH = dim(raw.pH);
  const kerf = String(raw.kerf ?? "").trim() === "" ? 0 : parseInches(raw.kerf);
  const primaryQty = qty(raw.primaryQty);

  if (!bL || bL <= 0) return { ok: false, key: "blockCalc.blockLengthPositive" };
  if (!bW || bW <= 0) return { ok: false, key: "blockCalc.blockWidthPositive" };
  if (!bH || bH <= 0) return { ok: false, key: "blockCalc.blockHeightPositive" };
  if (!pL || pL <= 0) return { ok: false, key: "blockCalc.primaryLengthPositive" };
  if (!pW || pW <= 0) return { ok: false, key: "blockCalc.primaryWidthPositive" };
  if (!pH || pH <= 0) return { ok: false, key: "blockCalc.primaryHeightPositive" };
  if (kerf === null || kerf < 0) return { ok: false, key: "blockCalc.kerfNonNegative" };
  if (badQty(primaryQty)) return { ok: false, key: "blockCalc.primaryQtyPositive" };

  const secondaryParts: BlockCalcInput["secondaryParts"] = [];
  for (const s of raw.secondaries) {
    const blank = (v: string) => String(v ?? "").trim() === "";
    if (blank(s.L) && blank(s.W) && blank(s.H)) continue;
    const L = dim(s.L), W = dim(s.W), H = dim(s.H), q = qty(s.qty);
    const vars = { label: s.label };
    if (!L || L <= 0) return { ok: false, key: "blockCalc.secLengthPositive", vars };
    if (!W || W <= 0) return { ok: false, key: "blockCalc.secWidthPositive", vars };
    if (!H || H <= 0) return { ok: false, key: "blockCalc.secHeightPositive", vars };
    if (badQty(q)) return { ok: false, key: "blockCalc.secQtyPositive", vars };
    secondaryParts.push({ id: s.id, label: s.label, L, W, H, qty: q });
  }

  return {
    ok: true,
    input: { bL, bW, bH, pL, pW, pH, kerf, primaryQty, mode: raw.mode, secondaryParts },
  };
}
