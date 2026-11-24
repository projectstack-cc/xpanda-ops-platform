// src/lib/hbChunkPlan.ts
// hbplan-01: a manager's custom Holey Board chunk list — explicit recipe groups ("cut `count`
// chunks, each into these pieces"), saved per job in jobs.hb_chunk_plan (JSON). The auto nest
// (holeyNester.ts, FFD max-yield) is untouched and stays the fallback when no plan exists.
// Pure: no D1, no DOM. A saved plan is never auto-edited — when the order or floor stock changes
// later it is kept and reported as a mismatch (planVsNeeded / planMatches).
import { HB_CHUNK_HEIGHT, HB_KERF } from "@/lib/holeyNester";

export interface HbPlanPiece {
  thickness: number;
  qty: number;
}

export interface HbPlanGroup {
  count: number;
  pieces: HbPlanPiece[];
}

export interface HbChunkPlan {
  v: 1;
  groups: HbPlanGroup[];
  total: number;
  updated_by: string;
  updated_at: string;
}

export interface HbPlanDiffRow {
  thickness: number;
  needed: number;
  planned: number;
  diff: number;
}

const EPS = 1e-9;

function toInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Pieces still to cut per thickness, from a saved hb_chunk_breakdown: its `lines`, net of floor
 * stock (a `net.pcs` entry for the line's part_id replaces the order qty with its `to_cut`).
 * Summed by thickness, thickest first, zero rows dropped. [] for null / unparseable input. */
export function hbNeededByThickness(breakdownJson: string | null): Array<{ thickness: number; qty: number }> {
  if (!breakdownJson) return [];
  let bd: any;
  try {
    bd = JSON.parse(breakdownJson);
  } catch {
    return [];
  }
  if (!bd || typeof bd !== "object" || !Array.isArray(bd.lines)) return [];
  const toCutByPart = new Map<string, number>();
  if (bd.net && Array.isArray(bd.net.pcs)) {
    for (const pc of bd.net.pcs) {
      if (pc && pc.part_id != null && Number.isFinite(Number(pc.to_cut))) toCutByPart.set(String(pc.part_id), Number(pc.to_cut));
    }
  }
  const byT = new Map<number, number>();
  for (const line of bd.lines) {
    if (!line) continue;
    const t = Number(line.thickness);
    if (!(t > 0)) continue;
    const key = line.part_id != null ? String(line.part_id) : null;
    const qty = key != null && toCutByPart.has(key) ? toCutByPart.get(key)! : Number(line.qty);
    if (!Number.isFinite(qty)) continue;
    byT.set(t, (byT.get(t) ?? 0) + qty);
  }
  return Array.from(byT.entries())
    .filter(([, qty]) => qty !== 0)
    .sort((a, b) => b[0] - a[0])
    .map(([thickness, qty]) => ({ thickness, qty }));
}

/** The thicknesses an order's breakdown allows in a plan — every HB line's thickness. */
export function hbAllowedThicknesses(breakdownJson: string | null): number[] {
  if (!breakdownJson) return [];
  try {
    const bd = JSON.parse(breakdownJson);
    if (!bd || !Array.isArray(bd.lines)) return [];
    const set = new Set<number>();
    for (const l of bd.lines) {
      const t = Number(l?.thickness);
      if (t > 0) set.add(t);
    }
    return Array.from(set).sort((a, b) => b - a);
  } catch {
    return [];
  }
}

/** One chunk's stack height: Σ qty·t + (Σ qty − 1)·HB_KERF — kerf only between boards, as the nester. */
export function groupFill(g: Pick<HbPlanGroup, "pieces">): number {
  let boards = 0;
  let height = 0;
  for (const p of g.pieces) {
    boards += p.qty;
    height += p.qty * p.thickness;
  }
  return boards > 0 ? height + (boards - 1) * HB_KERF : 0;
}

/** hbplan-02: a fill height for display — one decimal, except an over-fill that would round to the
 * limit itself (50.51–50.54") shows two, so "over" never reads "50.5" / 50.5"". */
export function formatFill(fill: number): string {
  const one = fill.toFixed(1);
  return fill > HB_CHUNK_HEIGHT + EPS && Number(one) <= HB_CHUNK_HEIGHT ? fill.toFixed(2) : one;
}

/** hbplan-02: a thickness for display — 4 -> "4", 0.5 -> "0.5". */
export function formatThickness(t: number): string {
  return String(Number(t.toFixed(4)));
}

/** hbplan-02: the short / over parts of a plan-vs-needed diff, e.g. short ["12 × 4\""], over
 * ["2 × 1\""] (plain `"` — the cut list's WinAnsi font can't encode ″). Thickest first. */
export function planMismatchParts(rows: HbPlanDiffRow[]): { short: string[]; over: string[] } {
  const short: string[] = [];
  const over: string[] = [];
  for (const r of rows) {
    if (r.diff < 0) short.push(`${-r.diff} × ${formatThickness(r.thickness)}"`);
    else if (r.diff > 0) over.push(`${r.diff} × ${formatThickness(r.thickness)}"`);
  }
  return { short, over };
}

/** Validates (and normalises) a submitted group list: count and qty integers ≥ 1, at least one
 * piece per group and one group overall, thicknesses from the order, duplicate thicknesses within a
 * group merged (thickest first), no group over the 50.5" chunk. To clear a plan send null instead. */
export function validatePlanGroups(
  groups: unknown,
  allowedThicknesses: number[]
): { ok: true; groups: HbPlanGroup[] } | { ok: false; error: string } {
  if (!Array.isArray(groups) || groups.length === 0) return { ok: false, error: "A chunk list needs at least 1 group." };
  const out: HbPlanGroup[] = [];
  for (let i = 0; i < groups.length; i++) {
    const label = `Group ${i + 1}`;
    const g: any = groups[i];
    if (!g || typeof g !== "object") return { ok: false, error: `${label} is not a valid group.` };
    const count = toInt(g.count);
    if (!Number.isInteger(count) || count < 1) return { ok: false, error: `${label}: chunk count must be a whole number of at least 1.` };
    if (!Array.isArray(g.pieces) || g.pieces.length === 0) return { ok: false, error: `${label} needs at least one piece size.` };
    const merged = new Map<number, number>();
    for (const p of g.pieces) {
      const qty = toInt(p?.qty);
      if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: `${label}: piece quantity must be a whole number of at least 1.` };
      const t = Number(p?.thickness);
      const allowed = Number.isFinite(t) ? allowedThicknesses.find((a) => Math.abs(a - t) < EPS) : undefined;
      if (allowed === undefined) return { ok: false, error: `${label}: ${String(p?.thickness)}" isn't a Holey Board thickness on this order.` };
      merged.set(allowed, (merged.get(allowed) ?? 0) + qty);
    }
    const pieces = Array.from(merged.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([thickness, qty]) => ({ thickness, qty }));
    const fill = groupFill({ pieces });
    if (fill > HB_CHUNK_HEIGHT + EPS) return { ok: false, error: `${label} is ${formatFill(fill)}" — over the ${HB_CHUNK_HEIGHT}" chunk` };
    out.push({ count, pieces });
  }
  return { ok: true, groups: out };
}

/** Planned (Σ count·qty) vs needed pieces per thickness, every thickness from both sides, thickest
 * first. diff = planned − needed: negative = short, positive = over. */
export function planVsNeeded(groups: HbPlanGroup[], needed: Array<{ thickness: number; qty: number }>): HbPlanDiffRow[] {
  const planned = new Map<number, number>();
  for (const g of groups) for (const p of g.pieces) planned.set(p.thickness, (planned.get(p.thickness) ?? 0) + g.count * p.qty);
  const need = new Map<number, number>();
  for (const n of needed) need.set(n.thickness, (need.get(n.thickness) ?? 0) + n.qty);
  const all = new Set<number>([...Array.from(planned.keys()), ...Array.from(need.keys())]);
  return Array.from(all)
    .sort((a, b) => b - a)
    .map((thickness) => {
      const n = need.get(thickness) ?? 0;
      const p = planned.get(thickness) ?? 0;
      return { thickness, needed: n, planned: p, diff: p - n };
    });
}

/** True when the plan cuts exactly what's needed at every thickness. */
export function planMatches(groups: HbPlanGroup[], needed: Array<{ thickness: number; qty: number }>): boolean {
  return planVsNeeded(groups, needed).every((r) => r.diff === 0);
}

/** Total chunks the plan cuts (Σ count). */
export function planTotal(groups: HbPlanGroup[]): number {
  return groups.reduce((s, g) => s + g.count, 0);
}

/** A saved jobs.hb_chunk_plan, or null for null / garbage / wrong-shape input. Never throws. */
export function parsePlan(json: string | null | undefined): HbChunkPlan | null {
  if (!json || typeof json !== "string") return null;
  try {
    const o: any = JSON.parse(json);
    if (!o || typeof o !== "object" || o.v !== 1 || !Array.isArray(o.groups) || o.groups.length === 0) return null;
    const groups: HbPlanGroup[] = [];
    for (const g of o.groups) {
      if (!g || !Number.isInteger(g.count) || g.count < 1 || !Array.isArray(g.pieces) || g.pieces.length === 0) return null;
      const pieces: HbPlanPiece[] = [];
      for (const p of g.pieces) {
        if (!p || !(Number(p.thickness) > 0) || !Number.isInteger(p.qty) || p.qty < 1) return null;
        pieces.push({ thickness: Number(p.thickness), qty: p.qty });
      }
      groups.push({ count: g.count, pieces });
    }
    return {
      v: 1,
      groups,
      total: planTotal(groups),
      updated_by: typeof o.updated_by === "string" ? o.updated_by : "",
      updated_at: typeof o.updated_at === "string" ? o.updated_at : "",
    };
  } catch {
    return null;
  }
}
