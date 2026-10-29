// src/lib/marina/partDraft.ts — marina-fix-01 (moved out of components/marina/PartEditor.tsx, marina-05)
// Pure draft logic for the Marina part editor (no React): dim rows, default / auto names, validation,
// the one-line "why Save is blocked" message and the API payload. PartEditor.tsx re-exports what its
// callers use.
import { formatInches, parseInches, roundToSixteenth } from "../inches";
import type { DimChip } from "./cutSheet";
import type { MarinaPartSummary, NewDimInput } from "./types";

export type DimName = "L" | "W" | "H" | "Other";
export const NAMES: DimName[] = ["L", "W", "H", "Other"];

export interface DimRowState { key: string; name: DimName; other: string; text: string; chip: string | null; }
export interface PartDraft { label: string; notes: string; dims: DimRowState[]; }
export type EditorFields = "all" | "labelNotes" | "dims";

let _seq = 0;
export const rowKey = () => `d${Date.now().toString(36)}${(++_seq).toString(36)}`;
export const chipKey = (c: DimChip) => String(roundToSixteenth(c.value_in));

export function emptyDraft(label = "", notes = ""): PartDraft {
  return { label, notes, dims: [] };
}

export function draftFromPart(part: MarinaPartSummary): PartDraft {
  return {
    label: part.label,
    notes: part.notes ?? "",
    dims: part.dims.map((d) => {
      const std = (["L", "W", "H"] as const).find((n) => n === d.label);
      return { key: rowKey(), name: std ?? "Other", other: std ? "" : d.label, text: d.nominal_text ?? formatInches(d.nominal_in), chip: null };
    }),
  };
}

export const dimName = (r: DimRowState) => (r.name === "Other" ? r.other.trim() : r.name);

// First of L, W, H not yet used on this part, then Other.
export function nextDefaultName(dims: DimRowState[]): DimName {
  const used = new Set(dims.map((d) => dimName(d).toUpperCase()));
  return (["L", "W", "H"] as const).find((n) => !used.has(n)) ?? "Other";
}

// "Dim N" for the row at `index` (0-based): N starts at index + 1 and goes up until no other row's
// name matches, case-insensitive. Never blank, so an auto-Other row can be saved as-is.
export function autoOtherName(dims: DimRowState[], index: number): string {
  const used = new Set(dims.filter((_, i) => i !== index).map((d) => dimName(d).toUpperCase()));
  let n = index + 1;
  while (used.has(`DIM ${n}`)) n++;
  return `Dim ${n}`;
}

export function newRow(dims: DimRowState[], text = "", chip: string | null = null): DimRowState {
  const name = nextDefaultName(dims);
  return { key: rowKey(), name, other: name === "Other" ? autoOtherName(dims, dims.length) : "", text, chip };
}

// Set a row's name from the segmented control. Switching to Other prefills an empty custom name;
// a typed one is kept (also across switching away and back).
export function withName(dims: DimRowState[], key: string, name: DimName): DimRowState[] {
  return dims.map((r, i) => {
    if (r.key !== key) return r;
    const other = name === "Other" && r.other.trim() === "" ? autoOtherName(dims, i) : r.other;
    return { ...r, name, other };
  });
}

export const chipUseCount = (dims: DimRowState[], key: string) => dims.filter((r) => r.chip === key).length;

export interface DraftCheck {
  ok: boolean;
  labelOk: boolean;
  dupNames: Set<string>;       // upper-cased names used more than once
  countOk: boolean;            // 1–20 dims
  rowsOk: boolean;             // every row has a 1–40 name and a valid value
}

export function checkDraft(d: PartDraft, fields: EditorFields): DraftCheck {
  const label = d.label.trim();
  const labelOk = fields === "dims" || (label.length >= 1 && label.length <= 80);
  const counts = new Map<string, number>();
  for (const r of d.dims) {
    const n = dimName(r).toUpperCase();
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const dupNames = new Set<string>();
  counts.forEach((c, n) => {
    if (c > 1) dupNames.add(n);
  });
  const countOk = fields === "labelNotes" || (d.dims.length >= 1 && d.dims.length <= 20);
  const rowsOk = fields === "labelNotes" || d.dims.every((r) => {
    const n = dimName(r);
    const v = parseInches(r.text);
    return n.length >= 1 && n.length <= 40 && v !== null && v > 0;
  });
  return { ok: labelOk && countOk && rowsOk && dupNames.size === 0, labelOk, dupNames, countOk, rowsOk };
}

// The first reason the draft can't be saved, in display order; null exactly when checkDraft().ok.
export function firstProblem(d: PartDraft, fields: EditorFields): string | null {
  const check = checkDraft(d, fields);
  if (check.ok) return null;
  if (!check.labelOk) return "Label is required.";
  if (fields === "labelNotes") return null;
  if (d.dims.length === 0) return "Add at least one dim.";
  for (let i = 0; i < d.dims.length; i++) {
    const r = d.dims[i];
    const n = dimName(r);
    if (n.length < 1 || n.length > 40) return `Dim ${i + 1} needs a name.`;
    const text = r.text.trim();
    if (text === "") return `Dim ${i + 1} needs a size.`;
    const v = parseInches(text);
    if (v === null || !(v > 0)) return `Dim ${i + 1}: "${text}" isn't a measurement.`;
  }
  for (const r of d.dims) {
    const n = dimName(r).toUpperCase();
    if (check.dupNames.has(n)) return `Two dims are named "${n}".`;
  }
  if (d.dims.length > 20) return "At most 20 dims.";
  return null;
}

export function dimsPayload(d: PartDraft): NewDimInput[] {
  return d.dims.map((r) => ({ label: dimName(r), nominal_text: r.text.trim() }));
}
