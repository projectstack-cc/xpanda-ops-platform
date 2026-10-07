"use client";
// src/app/carrier/CarrierSchedule.tsx
// Carrier View "Schedule" tab (carrier-05): this week's Seal orders from /v2/api/carrier/schedule
// (the internal schedule board's sheet data, carrier-safe fields only). Mounted only while the tab
// is open, so the shared useCarrierFetch polls (60s) only then. lg+: five day columns side by side;
// below lg: days stacked, today's day scrolled into view on mount and marked "Today".
// carrier-07: flat column panels, week summary strip, pickup time as the hero line, Shipped rows
// collapsed to one faded line and sunk to the bottom of their day; no inner scroll box.
// carrier-09: INV# top-center of the card; "Loading" (multi-load: "Loading 1 of 2") between Not ready
// and Ready — Ready now means every load is fully loaded.
import { useEffect, useRef } from "react";
import CarrierStatusPill from "./CarrierStatusPill";
import { useCarrierFetch } from "./useCarrierFetch";
import CarrierErrorBox from "./CarrierErrorBox";
import LinkedGroupList, { LinkedOrphanChip } from "./LinkedGroup";
import { parseStoredUtc } from "@/lib/etDateTime";
import { Check, MapPin } from "lucide-react";

interface ScheduleOrder {
  invoice_number: string;
  customer: string | null;
  load_label: string;
  delivery_time_label: string | null;
  city_state: string | null;
  status: "Not ready" | "Loading" | "Ready" | "Shipped" | null;
  loads_done: number | null;
  loads_total: number | null;
  scrap_pickup: boolean;
  unmatched: boolean;
  trailer_group_id: string | null;
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

type OrderStatus = ScheduleOrder["status"];

// Left status stripe on open cards (carrier-07). Shipped rows render as ShippedRow — no stripe.
function stripeCls(status: OrderStatus): string {
  if (status === "Ready") return "border-l-[var(--success-bg)]";
  if (status === "Loading") return "border-l-[var(--warn-border)]";
  return "border-l-[var(--border)]";
}

// Stable: Shipped rows sink below everything else, sheet order kept otherwise. groupRows (applied
// after this by LinkedGroupList) anchors each linked group at its first member, so groups stay intact.
function sinkShipped(rows: ScheduleOrder[]): ScheduleOrder[] {
  return [...rows.filter((r) => r.status !== "Shipped"), ...rows.filter((r) => r.status === "Shipped")];
}

interface OrderRowProps {
  order: ScheduleOrder;
  inGroup?: boolean;
  orphan?: boolean;
}

function OrderCard({ order, inGroup = false, orphan = false }: OrderRowProps) {
  const frame = inGroup
    ? "bg-[var(--surface)] border-l-4" // inside a LinkedGroup rail — the rail is the border; keep the stripe
    : "rounded border border-[var(--border)] bg-[var(--surface)] border-l-4";
  return (
    <div className={`${frame} ${stripeCls(order.status)} px-3 py-2`}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {order.delivery_time_label ? (
          <span className="text-base font-bold tabular-nums text-[var(--text)]">{order.delivery_time_label}</span>
        ) : (
          <span className="text-sm font-semibold text-[var(--text-muted)]">Time TBD</span>
        )}
        <span className="text-sm font-bold tabular-nums text-[var(--text)]">INV# {order.invoice_number}</span>
        <span className="justify-self-end">
          {order.status ? (
            <CarrierStatusPill
              status={order.status}
              detail={order.loads_done != null && order.loads_total != null ? `${order.loads_done} of ${order.loads_total}` : undefined}
            />
          ) : (
            <span className="text-xs font-semibold text-[var(--text-muted)] whitespace-nowrap">Scheduled</span>
          )}
        </span>
      </div>
      <div className="mt-0.5 text-sm font-semibold text-[var(--text)] line-clamp-2" title={order.customer || undefined}>
        {order.customer || "—"}
      </div>
      {order.city_state && (
        <div className="mt-0.5 text-sm text-[var(--text)] flex items-start gap-1">
          <MapPin size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
          <span>{order.city_state}</span>
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
        {order.load_label && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-[var(--border)] font-mono tabular-nums text-[var(--text)]">
            {order.load_label}
          </span>
        )}
        {orphan && <LinkedOrphanChip />}
      </div>
      {order.scrap_pickup && (
        <span className="mt-1.5 inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)]">
          Scrap pickup
        </span>
      )}
    </div>
  );
}

function ShippedRow({ order, inGroup = false, orphan = false }: OrderRowProps) {
  const title = [order.customer || "—", order.city_state, order.load_label || null].filter(Boolean).join(" · ");
  const frame = inGroup ? "bg-[var(--surface)]" : "rounded border border-[var(--border)] bg-[var(--surface)]";
  return (
    <div title={title} className={`${frame} opacity-60 px-3 py-1.5 flex items-center gap-2 text-sm text-[var(--text)]`}>
      <Check size={14} aria-hidden="true" className="shrink-0" />
      <span className="sr-only">Shipped:</span>
      <span className="shrink-0 tabular-nums font-semibold">{order.delivery_time_label || "—"}</span>
      <span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">INV# {order.invoice_number}</span>
      <span className="min-w-0 flex-1 truncate">{order.customer || "—"}</span>
      {orphan && <LinkedOrphanChip />}
    </div>
  );
}

function DayColumn({
  day,
  isToday,
  isPast,
  todayRef,
}: {
  day: ScheduleDay;
  isToday: boolean;
  isPast: boolean;
  todayRef?: React.Ref<HTMLElement>;
}) {
  const n = day.rows.length;
  const ready = day.rows.filter((r) => r.status === "Ready").length;
  const rows = sinkShipped(day.rows);
  return (
    <section
      ref={todayRef}
      className={`min-w-0 scroll-mt-4 rounded border border-[var(--border)] bg-[var(--surface-2)]${isToday ? " border-t-2 border-t-[var(--brand)]" : ""}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-2 border-b border-[var(--border)]">
        <h3 className={`text-sm font-bold ${isPast ? "text-[var(--text-muted)]" : "text-[var(--text)]"}`}>
          {shortDate(day.ship_date)}
        </h3>
        <span className="text-xs text-[var(--text-muted)] tabular-nums">
          {n} {n === 1 ? "order" : "orders"}
        </span>
        {ready > 0 && <span className="text-xs font-semibold tabular-nums text-[var(--success-bg)]">{ready} ready</span>}
        {isToday && (
          <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-[var(--brand)] text-[var(--surface)]">
            Today
          </span>
        )}
      </div>
      <div className="p-2 flex flex-col gap-2">
        {n === 0 ? (
          <div className="rounded border border-dashed border-[var(--border)] px-3 py-5 text-center text-sm text-[var(--text-hint)]">
            No Seal loads
          </div>
        ) : (
          <LinkedGroupList
            rows={rows}
            keyOf={(o, i) => `${o.invoice_number}-${i}`}
            renderRow={(o, ctx) =>
              o.status === "Shipped" ? (
                <ShippedRow order={o} inGroup={ctx.inGroup} orphan={ctx.orphan} />
              ) : (
                <OrderCard order={o} inGroup={ctx.inGroup} orphan={ctx.orphan} />
              )
            }
          />
        )}
      </div>
    </section>
  );
}

function StatCell({ value, label, valueCls }: { value: number; label: string; valueCls: string }) {
  return (
    <div className="px-4 py-2 min-w-[7rem]">
      <div className={`text-2xl font-bold tabular-nums leading-tight ${valueCls}`}>{value}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
    </div>
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
  const allRows = data ? data.days.flatMap((d) => d.rows) : [];
  const counts = {
    ready: allRows.filter((r) => r.status === "Ready").length,
    loading: allRows.filter((r) => r.status === "Loading").length,
    notReady: allRows.filter((r) => r.status === "Not ready").length,
    shipped: allRows.filter((r) => r.status === "Shipped").length,
  };

  return (
    <div>
      {error && <CarrierErrorBox error={error} onRetry={load} />}
      {data && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2">
            <h2 className="text-lg font-bold text-[var(--text)]">Week of {shortDate(data.week.monday)}</h2>
            {updated && <span className="text-xs text-[var(--text-muted)]">Updated {updated}</span>}
          </div>
          <div className="inline-flex flex-wrap divide-x divide-[var(--border)] rounded border border-[var(--border)] bg-[var(--surface)] mb-3">
            <StatCell value={counts.ready} label="Ready" valueCls="text-[var(--success-bg)]" />
            <StatCell value={counts.loading} label="Loading" valueCls="text-[var(--warn-text)]" />
            <StatCell value={counts.notReady} label="Not ready" valueCls="text-[var(--text)]" />
            <StatCell value={counts.shipped} label="Shipped" valueCls="text-[var(--text-muted)]" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 items-start">
            {data.days.map((day) => (
              <DayColumn
                key={day.ship_date}
                day={day}
                isToday={day.ship_date === today}
                isPast={day.ship_date < today}
                todayRef={day.ship_date === today ? todayRef : undefined}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
