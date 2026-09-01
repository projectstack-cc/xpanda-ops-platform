"use client";
// src/components/schedule/InteractiveScheduleBoard.tsx
// Desk (interactive) variant of ScheduleBoard: same data (60s poll, stale-on-error, two week bands)
// but built for a mouse/keyboard user, not a wall TV. No cursor-hide, no burn-in inset, header stays
// visible. Columns use the hover-pausing scrollbar (InteractiveScrollColumn via DayColumn
// `interactive`), and clicking an order opens the read-only OrderDetailModal (shipping + parts).
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import type { ScheduleBoardResponse } from "@/types/schedule";
import WeekBand from "./WeekBand";
import FreshnessClock from "./FreshnessClock";
import OrderDetailModal from "@/components/board/OrderDetailModal";

const POLL_MS = 60_000;

interface InteractiveScheduleBoardProps {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

function formatWeekLabel(tab: string | undefined, prefix: string): string {
  const m = tab?.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (!m) return prefix;
  return `${prefix} — ${Number(m[1])}/${Number(m[2])}`;
}

export default function InteractiveScheduleBoard({ userName, isAdmin, permissions }: InteractiveScheduleBoardProps) {
  const [data, setData] = useState<ScheduleBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const hasGoodDataRef = useRef(false);

  const fetchBoard = useCallback(async () => {
    try {
      const res = await fetch("/v2/api/schedule-board");
      if (res.status === 503) {
        if (hasGoodDataRef.current) setStale(true); else setError("Reconnecting…");
        return;
      }
      if (res.status === 401) {
        let confirmedGone = true;
        try { const c = await fetch("/api/auth/me"); confirmedGone = !c.ok; } catch { confirmedGone = false; }
        if (!confirmedGone) { if (hasGoodDataRef.current) setStale(true); else setError("Reconnecting…"); return; }
        setError("Signed out — sign back in to resume.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ScheduleBoardResponse = await res.json();
      hasGoodDataRef.current = true;
      setData(json); setStale(false); setError(null);
    } catch {
      if (hasGoodDataRef.current) setStale(true); else setError("Couldn't load the schedule.");
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
        <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Schedule · Desk" currentPath="/v2/schedule/desk" />
        <div className="flex-1 min-h-0 flex flex-col gap-px bg-[var(--line)] p-px">
          {[0, 1].map((i) => (
            <div key={i} className="flex-1 grid grid-cols-5 gap-px">
              {[0, 1, 2, 3, 4].map((j) => (
                <div key={j} className="bg-[var(--surface)] animate-pulse motion-reduce:animate-none" />
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
        <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Schedule · Desk" currentPath="/v2/schedule/desk" />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <AlertTriangle size={28} className="text-[var(--warn-text)]" aria-hidden="true" />
          <p className="text-sm text-muted max-w-sm">{error}</p>
          <button
            type="button"
            onClick={() => { setLoading(true); fetchBoard(); }}
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

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Schedule · Desk" currentPath="/v2/schedule/desk" />

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-3 py-0.5 border-b border-[var(--line)] bg-bg">
          <h1 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Shipping Schedule — Desk</h1>
          <div className="flex items-center gap-2">
            {stale && <span className="font-mono text-[10px] text-[var(--warn-text)]">showing last loaded data</span>}
            <FreshnessClock sourceUpdatedAt={data.source_updated_at} />
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col gap-px bg-[var(--line)]">
          <WeekBand
            weekLabel={formatWeekLabel(currentTab, "THIS WEEK")}
            weekTab={currentTab}
            days={currentDays}
            birthdays={data.birthdays ?? []}
            interactive
            onSelectOrder={setSelectedJobId}
          />
          <WeekBand
            weekLabel={formatWeekLabel(nextTab, "NEXT WEEK")}
            weekTab={nextTab}
            days={nextDays}
            birthdays={data.birthdays ?? []}
            interactive
            onSelectOrder={setSelectedJobId}
          />
        </div>
      </div>

      <OrderDetailModal jobId={selectedJobId} onClose={() => setSelectedJobId(null)} />
    </div>
  );
}
