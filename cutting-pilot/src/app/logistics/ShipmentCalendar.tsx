"use client";
// src/app/logistics/ShipmentCalendar.tsx
// Monthly interactive calendar view for outbound shipments.
// Tokenized per xpanda-ops-agents.md §9b with responsive 7-day grid,
// month navigation, today highlight, status-coded shipment pills,
// and direct Generate/View BOL action triggers.
import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, FileText, Eye } from "lucide-react";
import { formatDuration } from "@/lib/time";
import type { ShipmentListItem } from "@/components/logistics/types";
import { CustomerPickupBadge } from "@/components/logistics/ShipmentRow";

interface ShipmentCalendarProps {
  shipments: ShipmentListItem[];
  onViewBol: (jobId: string) => void;
  onGenerateBol: (jobId: string) => void;
  onFilterDate?: (dateStr: string) => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STATUS_PILL_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  not_started: { bg: "bg-[var(--ghost-bg)]", text: "text-[var(--text-hint)]", border: "border-[var(--border)]" },
  in_production: { bg: "bg-[var(--info-bg)]", text: "text-[var(--info-text)]", border: "border-[var(--info-border)]" },
  ready_to_ship: { bg: "bg-[var(--info-bg)]", text: "text-[var(--info-text)]", border: "border-[var(--info-border)]" },
  loading: { bg: "bg-[var(--warn-bg)]", text: "text-[var(--warn-text)]", border: "border-[var(--warn-border)]" },
  loaded: { bg: "bg-[var(--warn-bg)]", text: "text-[var(--warn-text)]", border: "border-[var(--warn-border)]" },
  in_transit: { bg: "bg-[var(--success-bg)]", text: "text-[var(--success-text)]", border: "border-transparent" },
  delivered: { bg: "bg-[var(--ghost-bg)]", text: "text-[var(--text-muted)]", border: "border-[var(--border)]" },
  cancelled: { bg: "bg-[var(--danger-bg)]", text: "text-[var(--danger-text)]", border: "border-transparent" },
  scheduled: { bg: "bg-[var(--ghost-bg)]", text: "text-[var(--text-hint)]", border: "border-[var(--border)]" },
  awaiting: { bg: "bg-[var(--ghost-bg)]", text: "text-[var(--text-hint)]", border: "border-[var(--border)]" },
};

export default function ShipmentCalendar({
  shipments,
  onViewBol,
  onGenerateBol,
  onFilterDate,
}: ShipmentCalendarProps) {
  const [activeMonth, setActiveMonth] = useState<Date>(() => {
    // Default to current date
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const [selectedShipment, setSelectedShipment] = useState<ShipmentListItem | null>(null);

  const year = activeMonth.getFullYear();
  const month = activeMonth.getMonth();

  const monthLabel = useMemo(() => {
    return activeMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [activeMonth]);

  const todayStr = useMemo(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  }, []);

  // Map shipments by YYYY-MM-DD
  const shipmentsByDate = useMemo(() => {
    const map = new Map<string, ShipmentListItem[]>();
    for (const s of shipments) {
      if (!s.ship_date) continue;
      const list = map.get(s.ship_date) ?? [];
      list.push(s);
      map.set(s.ship_date, list);
    }
    return map;
  }, [shipments]);

  // Calendar cells
  const cells = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = firstDay.getDay(); // 0 = Sun
    const totalDays = lastDay.getDate();
    const totalCells = Math.ceil((startDow + totalDays) / 7) * 7;

    const list: Array<{ dayNum: number | null; dateStr: string | null; isToday: boolean; isWeekend: boolean }> = [];
    let dayCounter = 1;

    for (let i = 0; i < totalCells; i++) {
      const isWeekend = i % 7 === 0 || i % 7 === 6;
      if (i < startDow || dayCounter > totalDays) {
        list.push({ dayNum: null, dateStr: null, isToday: false, isWeekend });
      } else {
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayCounter).padStart(2, "0")}`;
        list.push({
          dayNum: dayCounter,
          dateStr,
          isToday: dateStr === todayStr,
          isWeekend,
        });
        dayCounter++;
      }
    }
    return list;
  }, [year, month, todayStr]);

  function prevMonth() {
    setActiveMonth(new Date(year, month - 1, 1));
  }

  function nextMonth() {
    setActiveMonth(new Date(year, month + 1, 1));
  }

  function goToday() {
    const d = new Date();
    setActiveMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  return (
    <div className="space-y-3">
      {/* Month Navigation Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={prevMonth}
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] bg-surface text-text hover:bg-[var(--ghost-bg)] transition-colors cursor-pointer"
            aria-label="Previous month"
          >
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-base font-bold text-text min-w-[160px] text-center">{monthLabel}</h2>
          <button
            type="button"
            onClick={nextMonth}
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] bg-surface text-text hover:bg-[var(--ghost-bg)] transition-colors cursor-pointer"
            aria-label="Next month"
          >
            <ChevronRight size={18} />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border)] bg-surface text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] transition-colors cursor-pointer ml-1"
          >
            <CalendarIcon size={14} className="text-muted" />
            Today
          </button>
        </div>

        <div className="text-xs text-muted">
          Showing outbound shipments for {monthLabel}
        </div>
      </div>

      {/* Calendar Grid Container */}
      <div className="overflow-hidden rounded-xl border border-[var(--card-border)] bg-surface shadow-sm">
        {/* Days of week header */}
        <div className="grid grid-cols-7 border-b border-[var(--line)] bg-[var(--ghost-bg)] text-center text-xs font-semibold text-muted py-2">
          {WEEKDAYS.map((wd) => (
            <div key={wd}>{wd}</div>
          ))}
        </div>

        {/* Day Cells Grid */}
        <div className="grid grid-cols-7 divide-x divide-y divide-[var(--line)]">
          {cells.map((cell, idx) => {
            if (!cell.dayNum || !cell.dateStr) {
              return (
                <div
                  key={`empty-${idx}`}
                  className={`min-h-[110px] p-2 bg-[var(--ghost-bg)]/40 ${cell.isWeekend ? "bg-[var(--ghost-bg)]/60" : ""}`}
                />
              );
            }

            const dayShipments = shipmentsByDate.get(cell.dateStr) ?? [];
            const maxVisible = 3;
            const overflow = dayShipments.length - maxVisible;

            return (
              <div
                key={cell.dateStr}
                className={`min-h-[110px] p-2 flex flex-col gap-1 transition-colors ${
                  cell.isToday ? "bg-[var(--info-bg)]/15 font-semibold" : ""
                } ${cell.isWeekend ? "bg-[var(--ghost-bg)]/20" : "bg-surface"}`}
              >
                {/* Date header in cell */}
                <div className="flex items-center justify-between">
                  <span
                    className={`inline-flex items-center justify-center text-xs w-6 h-6 rounded-full tabular-nums ${
                      cell.isToday
                        ? "bg-[var(--brand)] text-white font-bold"
                        : "text-muted font-medium"
                    }`}
                  >
                    {cell.dayNum}
                  </span>
                  {dayShipments.length > 0 && (
                    <span className="text-[10px] text-muted tabular-nums">
                      {dayShipments.length} {dayShipments.length === 1 ? "shipment" : "shipments"}
                    </span>
                  )}
                </div>

                {/* Shipment Pills */}
                <div className="flex-1 flex flex-col gap-1 mt-0.5">
                  {dayShipments.slice(0, maxVisible).map((s) => {
                    const st = STATUS_PILL_STYLES[s.status] ?? STATUS_PILL_STYLES.awaiting;
                    const hasBol = Number(s.bol_count || 0) > 0 || Boolean(s.bol_number);
                    const titleText = `${s.customer || "Unknown"} · INV# ${s.invoice_number || "—"} · ${s.status}`;

                    return (
                      <div
                        key={s.id}
                        onClick={() => setSelectedShipment(s)}
                        title={titleText}
                        className={`text-[11px] leading-tight px-1.5 py-1 rounded border ${st.bg} ${st.text} ${st.border} flex items-center justify-between gap-1 cursor-pointer hover:shadow-xs hover:brightness-95 transition-all`}
                      >
                        <div className="truncate font-medium">
                          {s.invoice_number ? `INV# ${s.invoice_number}` : s.customer || "Shipment"}
                        </div>
                        {hasBol && (
                          <span
                            className="shrink-0 text-[10px] font-bold text-emerald-600 dark:text-emerald-400"
                            title="BOL Available"
                          >
                            BOL✓
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {overflow > 0 && (
                    <button
                      type="button"
                      onClick={() => onFilterDate && onFilterDate(cell.dateStr!)}
                      className="text-[10px] font-semibold text-[var(--brand)] hover:underline text-left py-0.5"
                    >
                      +{overflow} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick shipment preview popover / modal when clicking a calendar pill */}
      {selectedShipment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedShipment(null);
          }}
        >
          <div className="w-full max-w-md bg-surface border border-[var(--card-border)] rounded-xl shadow-xl p-5 space-y-4">
            <div className="flex items-start justify-between border-b border-[var(--line)] pb-3">
              <div>
                <h3 className="font-bold text-base text-text">
                  {selectedShipment.invoice_number ? `INV# ${selectedShipment.invoice_number}` : "Shipment Details"}
                </h3>
                <p className="text-xs text-muted">{selectedShipment.customer || "Unknown Customer"}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedShipment(null)}
                className="text-muted hover:text-text text-lg font-bold leading-none p-1 cursor-pointer"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-muted block">Ship Date</span>
                <span className="font-medium text-text">{selectedShipment.ship_date || "—"}</span>
              </div>
              <div>
                <span className="text-muted block">Status</span>
                <span className="font-medium text-text capitalize">{selectedShipment.status.replace(/_/g, " ")}</span>
              </div>
              <div>
                <span className="text-muted block">Carrier</span>
                <span className="font-medium text-text">{selectedShipment.carrier || "—"}</span>
                {Boolean(selectedShipment.is_customer_pickup) && (
                  <span className="block mt-1">
                    <CustomerPickupBadge />
                  </span>
                )}
              </div>
              <div>
                <span className="text-muted block">Trailer #</span>
                <span className="font-medium text-text font-mono">{selectedShipment.trailer_numbers || selectedShipment.trailer_number || "—"}</span>
              </div>
              <div>
                <span className="text-muted block">BOL #</span>
                <span className="font-medium text-text font-mono">{selectedShipment.bol_number || "—"}</span>
              </div>
              <div>
                <span className="text-muted block">Total BDFT</span>
                <span className="font-medium text-text tabular-nums">{selectedShipment.total_bdft || "—"}</span>
              </div>
              <div>
                <span className="text-muted block">Distance / ETA</span>
                <span
                  className="font-medium text-text tabular-nums"
                  title="Est. driving distance/time from the Orlando plant · car profile, no traffic"
                >
                  {selectedShipment.distance_status === "ok" && selectedShipment.miles_from_origin != null
                    ? `${Math.round(selectedShipment.miles_from_origin).toLocaleString("en-US")} mi${
                        selectedShipment.duration_sec != null ? ` · ${formatDuration(selectedShipment.duration_sec)}` : ""
                      }`
                    : "—"}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--line)]">
              {selectedShipment.job_id && (
                <a
                  href={`/jobs/?job_id=${selectedShipment.job_id}`}
                  className="inline-flex items-center min-h-[38px] px-3 rounded-lg border border-[var(--border)] text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] no-underline"
                >
                  View Job
                </a>
              )}
              {selectedShipment.job_id && (
                Number(selectedShipment.bol_count || 0) > 0 || Boolean(selectedShipment.bol_number) ? (
                  <button
                    type="button"
                    onClick={() => {
                      const jid = selectedShipment.job_id!;
                      setSelectedShipment(null);
                      onViewBol(jid);
                    }}
                    className="inline-flex items-center gap-1.5 min-h-[38px] px-4 rounded-lg border border-[var(--border)] bg-surface text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] cursor-pointer"
                  >
                    <Eye size={14} className="text-muted" />
                    View BOL
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const jid = selectedShipment.job_id!;
                      setSelectedShipment(null);
                      onGenerateBol(jid);
                    }}
                    className="inline-flex items-center gap-1.5 min-h-[38px] px-4 rounded-lg bg-[var(--brand)] text-white text-xs font-semibold shadow-sm hover:opacity-90 cursor-pointer"
                  >
                    <FileText size={14} />
                    Generate BOL
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
