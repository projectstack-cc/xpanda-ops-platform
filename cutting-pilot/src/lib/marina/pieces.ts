// src/lib/marina/pieces.ts — marina-03
// Pure piece logic for Marina Foam inspection (no DB): measurement evaluation against the part's dims
// and the piece state machine. The server is authoritative — routes call these with the job's
// tolerance_in (never a client value).
//
//   attempt 1, all in          → pass
//   attempt 1, any out         → disposition required: rework → rework_pending | scrap → scrapped
//   re-measure (rework_pending only), all in → accepted
//   re-measure, any out        → disposition required again
// A disposition sent when every dim is in tolerance is ignored.
import { inTolerance, parseInches } from "../inches";
import type { MarinaPieceStatus } from "./types";

export type Disposition = "rework" | "scrap";
export interface DimNominal { id: string; nominal_in: number; }
export interface MeasureInput { dim_id: string; value: string; }          // raw text as typed: "41 3/8", "41⅜", "41.375"
export interface EvaluatedRow { dim_id: string; nominal_in: number; measured_in: number; measured_text: string; in_tol: boolean; }
export type EvaluateResult =
  | { ok: true; rows: EvaluatedRow[]; allIn: boolean }
  | { ok: false; code: "missing_dim" | "unknown_dim" | "duplicate_dim" | "bad_value"; dim_id?: string; error: string };

// Every dim of the part exactly once; rows come back in the part's dim order.
export function evaluateMeasurements(dims: DimNominal[], input: MeasureInput[], tol: number): EvaluateResult {
  const byId = new Map(dims.map((d) => [d.id, d]));
  const seen = new Map<string, EvaluatedRow>();
  for (const m of input) {
    const dimId = String(m?.dim_id ?? "");
    const dim = byId.get(dimId);
    if (!dim) return { ok: false, code: "unknown_dim", dim_id: dimId, error: "That dimension isn't on this part." };
    if (seen.has(dimId)) return { ok: false, code: "duplicate_dim", dim_id: dimId, error: "A dimension was measured twice." };
    const text = typeof m.value === "string" ? m.value.trim() : "";
    const measured = text ? parseInches(text) : null;
    if (measured === null) {
      return { ok: false, code: "bad_value", dim_id: dimId, error: `Couldn't read "${text}" as inches.` };
    }
    seen.set(dimId, {
      dim_id: dimId,
      nominal_in: dim.nominal_in,
      measured_in: measured,
      measured_text: text,
      in_tol: inTolerance(measured, dim.nominal_in, tol),
    });
  }
  const rows: EvaluatedRow[] = [];
  for (const d of dims) {
    const row = seen.get(d.id);
    if (!row) return { ok: false, code: "missing_dim", dim_id: d.id, error: "Every dimension needs a measurement." };
    rows.push(row);
  }
  return { ok: true, rows, allIn: rows.every((r) => r.in_tol) };
}

export type NextStatusResult =
  | { ok: true; status: "pass" | "accepted" | "rework_pending" | "scrapped"; dispositionUsed: Disposition | null }
  | { ok: false; code: "disposition_required" | "not_rework_pending"; error: string };

// current null = new piece (attempt 1); otherwise it must be "rework_pending".
export function nextStatus(args: { current: MarinaPieceStatus | null; allIn: boolean; disposition?: Disposition | null }): NextStatusResult {
  const { current, allIn } = args;
  if (current !== null && current !== "rework_pending") {
    return { ok: false, code: "not_rework_pending", error: "Only a piece waiting on rework can be re-measured." };
  }
  if (allIn) return { ok: true, status: current === null ? "pass" : "accepted", dispositionUsed: null };
  if (args.disposition === "rework") return { ok: true, status: "rework_pending", dispositionUsed: "rework" };
  if (args.disposition === "scrap") return { ok: true, status: "scrapped", dispositionUsed: "scrap" };
  return { ok: false, code: "disposition_required", error: "Out of tolerance — choose Rework or Scrap." };
}
