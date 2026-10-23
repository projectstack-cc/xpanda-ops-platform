// src/components/marina/pieceUi.ts — marina-06
// Piece display helpers shared by the inspect screen and the rework queue: status chips, attempt
// grouping, the last attempt's out-of-tolerance dims (from the STORED in_tol) and "waiting" age.
import { formatInches } from "@/lib/inches";
import { parseStoredUtc } from "@/lib/etDateTime";
import type { MarinaDim, MarinaMeasurement, MarinaPiece, MarinaPieceStatus } from "@/lib/marina/types";
import { CHIP_DANGER, CHIP_GOOD, CHIP_INFO } from "./ui";

export const STATUS_LABEL: Record<MarinaPieceStatus, string> = {
  pass: "Pass",
  accepted: "Accepted (reworked)",
  rework_pending: "Rework pending",
  scrapped: "Scrapped",
};
export const STATUS_CHIP: Record<MarinaPieceStatus, string> = {
  pass: CHIP_GOOD,
  accepted: CHIP_GOOD,
  rework_pending: CHIP_INFO,
  scrapped: CHIP_DANGER,
};

// Measurements grouped by attempt, ascending (the API already orders attempt ASC then dim order).
export function attemptsOf(piece: MarinaPiece): { attempt: number; rows: MarinaMeasurement[] }[] {
  const by = new Map<number, MarinaMeasurement[]>();
  for (const m of piece.measurements) {
    const list = by.get(m.attempt) ?? [];
    list.push(m);
    by.set(m.attempt, list);
  }
  return Array.from(by.entries()).sort((a, b) => a[0] - b[0]).map(([attempt, rows]) => ({ attempt, rows }));
}

export function lastMeasurement(piece: MarinaPiece): MarinaMeasurement | null {
  const ms = piece.measurements;
  if (!ms.length) return null;
  const top = Math.max(...ms.map((m) => m.attempt));
  return ms.filter((m) => m.attempt === top).slice(-1)[0] ?? null;
}

// "+1/4" / "−3/8" (U+2212) from a stored measurement.
export function deviationText(m: Pick<MarinaMeasurement, "measured_in" | "nominal_in">): string {
  const d = m.measured_in - m.nominal_in;
  const mag = formatInches(Math.abs(d));
  return mag === "0" ? "0" : `${d > 0 ? "+" : "−"}${mag}`;
}

export function lastOutDims(piece: MarinaPiece, dims: MarinaDim[]): { label: string; text: string }[] {
  const last = attemptsOf(piece).slice(-1)[0];
  if (!last) return [];
  const name = new Map(dims.map((d) => [d.id, d.label]));
  return last.rows
    .filter((m) => !m.in_tol)
    .map((m) => ({
      label: name.get(m.dim_id) ?? "Dim",
      text: `${formatInches(m.nominal_in)} → ${m.measured_text ?? formatInches(m.measured_in)} (${deviationText(m)} ${m.measured_in > m.nominal_in ? "OVER" : "UNDER"})`,
    }));
}

// "5 min", "3 h", "2 d" since a stored UTC timestamp (SQLite datetime has no Z — parseStoredUtc).
export function waitingFor(ts: string | null, now = Date.now()): string {
  const ms = parseStoredUtc(ts);
  if (ms == null) return "";
  const min = Math.max(0, Math.floor((now - ms) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}
