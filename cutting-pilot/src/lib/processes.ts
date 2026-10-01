// src/lib/processes.ts
// board-lines-01: the cutting lines a job can require, stored as jobs.processes = JSON
// [{ name, completed }]. Names are data values matched against stored JSON — never translate them.

export const PROCESSES = [
  { name: "Cross Cutter", abbr: "CC" },
  { name: "Hole Cutter", abbr: "HC" },
  { name: "Main Line", abbr: "ML" },
  { name: "Blue Line", abbr: "BL" },
  { name: "Laminate", abbr: "LAM" },
] as const;

export const PROCESS_NAMES: readonly string[] = PROCESSES.map((p) => p.name);

export type JobProcess = { name: string; completed: boolean };

// Accepts the raw jobs.processes cell (JSON string) or an already-parsed array. Unknown names
// and malformed entries are dropped; never throws.
export function parseProcesses(raw: unknown): JobProcess[] {
  try {
    const arr = typeof raw === "string" ? (raw ? JSON.parse(raw) : []) : raw;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x: any) => x && PROCESS_NAMES.includes(String(x.name)))
      .map((x: any) => ({ name: String(x.name), completed: !!x.completed }));
  } catch {
    return [];
  }
}

// Builds the stored list from the selected names, in PROCESSES order. Keeps `completed` from an
// existing entry of the same name; newly added lines start `completed: false`.
export function mergeProcesses(selected: string[], existing: JobProcess[]): JobProcess[] {
  const picked = new Set(selected);
  return PROCESSES.filter((p) => picked.has(p.name)).map((p) => ({
    name: p.name,
    completed: existing.find((e) => e.name === p.name)?.completed ?? false,
  }));
}
