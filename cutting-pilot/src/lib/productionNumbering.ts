// src/lib/productionNumbering.ts
// Single source for Molding block numbering + ET time, imported by BOTH the production API
// routes and the ProductionBoard UI. Pure functions only — no D1, no DOM.

function etParts(d: Date): { year: string; month: string; day: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function etDateParts(d: Date = new Date()): { ymd: string; mmdd: string } {
  const { year, month, day } = etParts(d);
  return { ymd: `${year}-${month}-${day}`, mmdd: `${month}/${day}` };
}

export function etClockLabel(d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  // Normalize whichever space character ICU uses between the time and AM/PM to a plain space.
  return fmt.format(d).replace(/[  ]/g, " ");
}

export function blockSuffix(blockNo: string | null): number | null {
  if (!blockNo) return null;
  const m = /^\d{2}\/\d{2}-(\d+)$/.exec(blockNo.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function nextBlockNo(existing: Array<string | null>, d: Date = new Date()): string {
  const { mmdd } = etDateParts(d);
  let max = 0;
  for (const b of existing) {
    const n = blockSuffix(b);
    if (n !== null && n > max) max = n;
  }
  return `${mmdd}-${pad2(max + 1)}`;
}
