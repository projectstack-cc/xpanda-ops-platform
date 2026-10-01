// src/lib/week.ts
// board-ui-01: week/day helpers shared by the v2 Shipment Dashboard and the v2 Job Board.
// getMondayForOffset + formatDayHeader moved verbatim from app/logistics/ShipmentDashboard.tsx.

export function getMondayForOffset(offset: number): { mondayStr: string; label: string } {
  const now = new Date();
  const day = now.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon + offset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const mondayStr = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
  const startLabel = monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endLabel = sunday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return { mondayStr, label: `${startLabel} – ${endLabel}` };
}

export function formatDayHeader(dateStr: string): { title: string; isToday: boolean } {
  if (!dateStr || dateStr === "No Date") {
    return { title: "Unscheduled / No Date", isToday: false };
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return { title: dateStr, isToday: false };

  const date = new Date(y, m - 1, d);
  const now = new Date();
  const isToday =
    now.getFullYear() === y && now.getMonth() === m - 1 && now.getDate() === d;

  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const formatted = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return { title: `${weekday} — ${formatted}`, isToday };
}

// Normalizes legacy M/D/YYYY ship dates to YYYY-MM-DD (same logic as CalendarView's normalizeDate).
export function toIsoDate(d: string | null): string | null {
  if (!d) return null;
  if (d.includes("/")) {
    const p = d.split("/");
    return `${p[2]}-${p[0].padStart(2, "0")}-${p[1].padStart(2, "0")}`;
  }
  return d;
}

// Monday..Sunday of the given week offset, as ISO date strings (inclusive range).
export function weekRange(offset: number): { start: string; end: string } {
  const { mondayStr } = getMondayForOffset(offset);
  const [y, m, d] = mondayStr.split("-").map(Number);
  const sunday = new Date(y, m - 1, d + 6);
  const end = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, "0")}-${String(sunday.getDate()).padStart(2, "0")}`;
  return { start: mondayStr, end };
}

// "Mon D, YYYY" — same output as ShipmentRow's fmtDate. Accepts ISO or M/D/YYYY.
export function fmtShortDate(dateStr: string | null): string {
  const iso = toIsoDate(dateStr);
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
