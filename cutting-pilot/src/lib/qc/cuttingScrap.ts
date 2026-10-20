// src/lib/qc/cuttingScrap.ts — qc-05
// Pure draft helpers for the cutting board's scrap section (components/qc/CuttingScrapSection.tsx, in
// CompleteLineModal + HandoffModal). No DB, no React — exercised by cuttingScrap.selfcheck.ts
// (`npx tsx src/lib/qc/cuttingScrap.selfcheck.ts`). The operator only fills part / size / density /
// reason / notes; date, INV, line and operator are filled in by POST /v2/api/cutting/scrap, so the
// client check runs validateScrapEntry with placeholders for those and keeps the server's rules.
import { etNowWallClock } from "../etDateTime";
import { defaultShiftForEtMinutes, validateScrapEntry, type ShiftValue } from "./scrap";

/** Part select value for "Other / not on the order" (switches to a typed part). */
export const OTHER_PART = "__other";

export interface DraftEntry {
  key: number;
  lineItemId: string; // "" = not picked yet, OTHER_PART = typed part, else a job_line_items id
  part: string; // part_product — the picked line's description (or dims), or the typed part
  pieces: string;
  t: string;
  w: string;
  l: string;
  density: string;
  reason: string;
  notes: string;
}

export interface CuttingScrapDraft {
  open: boolean;
  shift: ShiftValue;
  entries: DraftEntry[];
}

let nextKey = 1;

export function blankScrapEntry(): DraftEntry {
  return { key: nextKey++, lineItemId: "", part: "", pieces: "", t: "", w: "", l: "", density: "", reason: "", notes: "" };
}

/** Closed, no entries, shift defaulted from ET now. */
export function emptyCuttingScrapDraft(nowMs: number = Date.now()): CuttingScrapDraft {
  return { open: false, shift: defaultShiftForEtMinutes(etNowWallClock(nowMs).minutes), entries: [] };
}

function toNum(v: string): number {
  const t = v.trim();
  return t === "" ? NaN : Number(t);
}

export function draftHasEntries(draft: CuttingScrapDraft): boolean {
  return draft.open && draft.entries.length > 0;
}

/** The entries as POST /v2/api/cutting/scrap takes them ([] when the section is closed). */
export function toCuttingScrapEntries(draft: CuttingScrapDraft) {
  if (!draftHasEntries(draft)) return [];
  return draft.entries.map((e) => ({
    line_item_id: e.lineItemId && e.lineItemId !== OTHER_PART ? e.lineItemId : null,
    part_product: e.part.trim(),
    material_density: e.density.trim(),
    pieces: toNum(e.pieces),
    thickness_in: toNum(e.t),
    width_in: toNum(e.w),
    length_in: toNum(e.l),
    scrap_reason: e.reason,
    notes: e.notes,
  }));
}

// Same short forms as the /v2/qc popup's card problems.
function shortMsg(m: string): string {
  if (m === "Notes are required when the reason is Other.") return "reason Other needs a note";
  const s = m.replace(/\.$/, "");
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** One line per bad entry, e.g. "Scrap entry 2: reason Other needs a note". [] when closed / empty / valid. */
export function cuttingScrapProblems(draft: CuttingScrapDraft, nowMs: number = Date.now()): string[] {
  if (!draftHasEntries(draft)) return [];
  const today = etNowWallClock(nowMs).date;
  const entries = toCuttingScrapEntries(draft);
  const out: string[] = [];
  draft.entries.forEach((d, i) => {
    const msgs: string[] = [];
    if (!d.lineItemId) msgs.push("pick a part");
    // Server-filled fields get placeholders — only the operator's own fields are being checked.
    const r = validateScrapEntry(
      { ...entries[i], event_date: today, shift: draft.shift, inv_number: "INV", line_machine: "Main Line", operator_name: "Operator" },
      today
    );
    if (!r.ok) {
      for (const m of r.errors) {
        if (m === "Part is required." && msgs.includes("pick a part")) continue;
        msgs.push(shortMsg(m));
      }
    }
    if (msgs.length) out.push(`Scrap entry ${i + 1}: ${msgs.join(", ")}`);
  });
  return out;
}
