"use client";
import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { STATUS_VARIANTS } from "./badges";

type CalJob = { id: string; customer: string | null; status: string; ship_date: string | null };

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function normalizeDate(d: string): string {
  if (d.includes("/")) {
    const p = d.split("/");
    return `${p[2]}-${p[0].padStart(2, "0")}-${p[1].padStart(2, "0")}`;
  }
  return d;
}

export default function CalendarView({
  jobs,
  onSelectJob,
}: {
  jobs: CalJob[];
  onSelectJob: (id: string) => void;
}) {
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [dayModal, setDayModal] = useState<string | null>(null);

  const jobsByDate = useMemo(() => {
    const map: Record<string, CalJob[]> = {};
    for (const j of jobs) {
      if (!j.ship_date) continue;
      const d = normalizeDate(j.ship_date);
      (map[d] ??= []).push(j);
    }
    return map;
  }, [jobs]);

  const year = month.getFullYear();
  const m = month.getMonth();
  const startDow = new Date(year, m, 1).getDay();
  const totalDays = new Date(year, m + 1, 0).getDate();
  const totalCells = Math.ceil((startDow + totalDays) / 7) * 7;

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const cells: ({ day: number; dateStr: string } | null)[] = [];
  let dayNum = 1;
  for (let i = 0; i < totalCells; i++) {
    if (i < startDow || dayNum > totalDays) {
      cells.push(null);
    } else {
      cells.push({ day: dayNum, dateStr: `${year}-${String(m + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}` });
      dayNum++;
    }
  }

  const dayJobs = dayModal ? jobsByDate[dayModal] ?? [] : [];

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-surface p-3">
      <div className="flex items-center justify-center gap-3 py-2">
        <button type="button" onClick={() => setMonth(new Date(year, m - 1, 1))} className="min-h-[44px] px-3 rounded-lg border border-[var(--input-border)] text-text cursor-pointer hover:bg-[var(--ghost-bg)]">←</button>
        <h3 className="m-0 text-lg font-bold text-text min-w-[180px] text-center">{MONTHS[m]} {year}</h3>
        <button type="button" onClick={() => setMonth(new Date(year, m + 1, 1))} className="min-h-[44px] px-3 rounded-lg border border-[var(--input-border)] text-text cursor-pointer hover:bg-[var(--ghost-bg)]">→</button>
        <button type="button" onClick={() => { const n = new Date(); setMonth(new Date(n.getFullYear(), n.getMonth(), 1)); }} className="min-h-[44px] px-3 rounded-lg border border-[var(--input-border)] text-sm text-text cursor-pointer hover:bg-[var(--ghost-bg)]">Today</button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {DOW.map((d) => (
          <div key={d} className="px-2 py-1 text-center text-xs font-semibold text-muted">{d}</div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} className="min-h-[96px] rounded-md bg-[var(--ghost-bg)]" />;
          const isToday = cell.dateStr === todayStr;
          const list = jobsByDate[cell.dateStr] ?? [];
          return (
            <div key={i} className={`min-h-[96px] rounded-md border p-1 ${isToday ? "border-[var(--info-border)] bg-[var(--info-bg)]" : "border-[var(--line)]"}`}>
              <div className={`text-xs font-semibold mb-1 ${isToday ? "text-[var(--info-text)]" : "text-muted"}`}>{cell.day}</div>
              <div className="space-y-1">
                {list.slice(0, 4).map((j) => {
                  const v = STATUS_VARIANTS[j.status] ?? { cls: "border border-[var(--border)] text-[var(--text-hint)]" };
                  return (
                    <button key={j.id} type="button" onClick={() => onSelectJob(j.id)} title={`${j.customer ?? "Untitled"} — ${j.status.replace(/_/g, " ")}`} className={`block w-full truncate text-left text-[11px] rounded px-1.5 py-0.5 cursor-pointer ${v.cls}`}>
                      {j.customer || "Untitled"}
                    </button>
                  );
                })}
                {list.length > 4 && (
                  <button type="button" onClick={() => setDayModal(cell.dateStr)} className="block w-full text-left text-[11px] text-muted hover:text-text cursor-pointer px-1.5">
                    +{list.length - 4} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Modal isOpen={!!dayModal} onClose={() => setDayModal(null)} title={dayModal ? `Jobs — ${dayModal}` : "Jobs"}>
        <div className="space-y-2">
          {dayJobs.map((j) => (
            <button key={j.id} type="button" onClick={() => { onSelectJob(j.id); setDayModal(null); }} className="flex w-full items-center justify-between rounded-md border border-[var(--line)] px-3 py-2 text-left cursor-pointer hover:bg-[var(--ghost-bg)]">
              <span className="text-sm text-text">{j.customer || "Untitled"}</span>
              <span className="text-xs text-muted">{j.status.replace(/_/g, " ")}</span>
            </button>
          ))}
          {!dayJobs.length && <p className="text-sm text-muted">No jobs this day.</p>}
        </div>
      </Modal>
    </div>
  );
}
