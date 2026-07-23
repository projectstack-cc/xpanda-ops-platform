"use client";
// src/components/schedule/ScheduleBoard.tsx
// Floor/office TV board: two stacked week bands (current on top, next below), both visible
// on one screen at once — no auto-scroll, no rotation. Polls GET /v2/api/schedule-board every
// 60s and swaps data in place; on fetch error it keeps the last-good render and shows a
// subtle stale indicator instead of ever blanking the wall.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import type { ScheduleBoardResponse } from "@/types/schedule";
import WeekBand from "./WeekBand";
import { computeDensity } from "./density";

const POLL_MS = 60_000;

interface ScheduleBoardProps {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

function formatWeekLabel(tab: string | undefined, prefix: string): string {
  const m = tab?.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (!m) return prefix;
  return `${prefix} — ${Number(m[1])}/${Number(m[2])}`;
}

function formatUpdatedStamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export default function ScheduleBoard({ userName, isAdmin, permissions }: ScheduleBoardProps) {
  const [data, setData] = useState<ScheduleBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const hasGoodDataRef = useRef(false);

  const fetchBoard = useCallback(async () => {
    try {
      const res = await fetch("/v2/api/schedule-board");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ScheduleBoardResponse = await res.json();
      hasGoodDataRef.current = true;
      setData(json);
      setStale(false);
      setError(null);
    } catch {
      if (hasGoodDataRef.current) {
        setStale(true);
      } else {
        setError("Couldn't load the schedule.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoard();
    const id = setInterval(fetchBoard, POLL_MS);
    return () => clearInterval(id);
  }, [fetchBoard]);

  if (loading) {
    return (
      <div className="h-screen flex flex-col bg-bg overflow-hidden">
        <PlatformHeader
          userName={userName}
          isAdmin={isAdmin}
          permissions={permissions}
          title="Schedule · v2"
          currentPath="/v2/schedule"
          autoHide
        />
        <div className="flex-1 min-h-0 flex flex-col gap-px bg-[var(--line)] p-px">
          {[0, 1].map((i) => (
            <div key={i} className="flex-1 grid grid-cols-5 gap-px">
              {[0, 1, 2, 3, 4].map((j) => (
                <div
                  key={j}
                  className="bg-[var(--surface)] animate-pulse motion-reduce:animate-none"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="h-screen flex flex-col bg-bg overflow-hidden">
        <PlatformHeader
          userName={userName}
          isAdmin={isAdmin}
          permissions={permissions}
          title="Schedule · v2"
          currentPath="/v2/schedule"
          autoHide
        />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <AlertTriangle size={28} className="text-[var(--warn-text)]" aria-hidden="true" />
          <p className="text-sm text-muted max-w-sm">{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchBoard();
            }}
            className="cursor-pointer inline-flex items-center px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium bg-[var(--primary-bg)] text-[var(--primary-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const [currentTab, nextTab] = data.weeks;
  const currentDays = data.days.filter((d) => d.ship_week === currentTab);
  const nextDays = data.days.filter((d) => d.ship_week === nextTab);

  const maxColumnRows = Math.max(
    0,
    ...currentDays.map((d) => d.rows.length),
    ...nextDays.map((d) => d.rows.length)
  );
  const { density, rowCap } = computeDensity(maxColumnRows);

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      <PlatformHeader
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        title="Schedule · v2"
        currentPath="/v2/schedule"
        autoHide
      />

      <div className="shrink-0 flex items-center justify-between px-3 py-0.5 border-b border-[var(--line)] bg-bg">
        <h1 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Shipping Schedule
        </h1>
        <span
          className={[
            "font-mono tabular-nums text-[10px]",
            stale ? "text-[var(--warn-text)]" : "text-text-faint",
          ].join(" ")}
        >
          {stale ? "stale — last updated " : "updated "}
          {formatUpdatedStamp(data.generated_at)}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-px bg-[var(--line)]">
        <WeekBand
          weekLabel={formatWeekLabel(currentTab, "THIS WEEK")}
          days={currentDays}
          density={density}
          rowCap={rowCap}
        />
        <WeekBand
          weekLabel={formatWeekLabel(nextTab, "NEXT WEEK")}
          days={nextDays}
          density={density}
          rowCap={rowCap}
        />
      </div>
    </div>
  );
}
