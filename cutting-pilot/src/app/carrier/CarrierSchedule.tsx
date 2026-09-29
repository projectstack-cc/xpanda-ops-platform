"use client";
// src/app/carrier/CarrierSchedule.tsx
// Carrier View "Schedule" tab (carrier-05): this week's Seal orders from /v2/api/carrier/schedule
// (the internal schedule board's sheet data, carrier-safe fields only). Mounted only while the tab
// is open, so the shared useCarrierFetch polls (60s) only then. lg+: five day columns side by side;
// below lg: days stacked, today's day scrolled into view on mount and marked "Today".
import { useEffect, useRef } from "react";
import CarrierStatusPill from "./CarrierStatusPill";
import { useCarrierFetch } from "./useCarrierFetch";
import CarrierErrorBox from "./CarrierErrorBox";
import { parseStoredUtc } from "@/lib/etDateTime";

interface ScheduleOrder {
  invoice_number: string;
  customer: string | null;
  load_label: string;
  delivery_time_label: string | null;
  city_state: string | null;
  status: "In production" | "Ready" | "Shipped" | null;
  scrap_pickup: boolean;
  unmatched: boolean;
}

interface ScheduleDay {
  day_of_week: string;
  ship_date: string;
  rows: ScheduleOrder[];
}

interface ScheduleResponse {
  ok: boolean;
  week: { tab: string; monday: string };
  days: ScheduleDay[];
  source_updated_at: string | null;
  error?: string;
}

// Same threshold as the load tiles; order cards are ~120px, so ~3.5 fit in the box.
const SCROLL_THRESHOLD = 4;

function etTodayStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function shortDate(ymd: string, weekday = true): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const wd = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date);
  return weekday ? `${wd} ${m}/${d}` : `${m}/${d}`;
}

function etClock(ts: string | null): string | null {
  const ms = parseStoredUtc(ts);
  if (ms == null) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(ms);
}

function OrderCard({ order }: { order: ScheduleOrder }) {
  const loadTime = [order.load_label || null, order.delivery_time_label ? `@ ${order.delivery_time_label}` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--text)] break-words">{order.customer || "—"}</div>
          <div className="text-xs font-semibold tabular-nums text-[var(--text-muted)] mt-0.5">INV# {order.invoice_number}</div>
        </div>
        {order.status ? (
          <CarrierStatusPill status={order.status} />
        ) : (
          <span className="text-xs font-semibold text-[var(--text-hint)] whitespace-nowrap">Scheduled</span>
        )}
      </div>
      {loadTime && <div className="mt-1 text-sm font-mono tabular-nums text-[var(--text)]">{loadTime}</div>}
      {order.city_state && (
        <div className="mt-0.5 text-sm text-[var(--text-hint)] flex items-start gap-1">
          <span aria-hidden="true">📍</span>
          <span>{order.city_state}</span>
        </div>
      )}
      {order.scrap_pickup && (
        <span className="mt-1.5 inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)]">
          Scrap pickup
        </span>
      )}
    </div>
  );
}

function DayColumn({ day, isToday, todayRef }: { day: ScheduleDay; isToday: boolean; todayRef?: React.Ref<HTMLElement> }) {
  const scrolling = day.rows.length >= SCROLL_THRESHOLD;
  const n = day.rows.length;
  return (
    <section ref={todayRef} className="min-w-0 scroll-mt-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-2 px-1">
        <h3 className="text-sm font-bold text-[var(--text)]">{shortDate(day.ship_date)}</h3>
        <span className="text-xs text-[var(--text-muted)] tabular-nums">
          {n} {n === 1 ? "order" : "orders"}
        </span>
        {isToday && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--brand)] text-[var(--surface)]">
            Today
          </span>
        )}
      </div>
      {n === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-5 text-center text-sm text-[var(--text-hint)]">
          No Seal loads
        </div>
      ) : (
        <div
          className={
            scrolling
              ? "flex flex-col gap-2 max-h-[min(calc(3.5*var(--carrier-order-h,128px)),85vh)] overflow-y-auto overscroll-contain pr-1"
              : "flex flex-col gap-2"
          }
        >
          {day.rows.map((o, i) => (
            <OrderCard key={`${o.invoice_number}-${i}`} order={o} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function CarrierSchedule() {
  const { data, error, loading, load } = useCarrierFetch<ScheduleResponse>("/v2/api/carrier/schedule", true);
  const todayRef = useRef<HTMLElement>(null);
  const scrolledRef = useRef(false);
  const today = etTodayStr();

  // Phone / portrait tablet only (days stacked): bring today's day into view once, on first data.
  useEffect(() => {
    if (!data || scrolledRef.current) return;
    scrolledRef.current = true;
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      todayRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [data]);

  if (loading && !data && !error) {
    return <div className="text-center text-sm text-[var(--text-hint)] py-10">Loading…</div>;
  }

  const updated = data ? etClock(data.source_updated_at) : null;

  return (
    <div>
      {error && <CarrierErrorBox error={error} onRetry={load} />}
      {data && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3 px-1">
            <h2 className="text-base font-bold text-[var(--text)]">Week of {shortDate(data.week.monday)}</h2>
            {updated && <span className="text-xs text-[var(--text-hint)]">Schedule updated {updated}</span>}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
            {data.days.map((day) => (
              <DayColumn
                key={day.ship_date}
                day={day}
                isToday={day.ship_date === today}
                todayRef={day.ship_date === today ? todayRef : undefined}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
