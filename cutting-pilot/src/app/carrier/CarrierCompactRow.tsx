"use client";
// src/app/carrier/CarrierCompactRow.tsx
// Upcoming tab compact view (carrier-09): one dense row per load. lg+: a single line of columns
// (status · suggested pickup · appointment · INV# · customer · city/state · miles · Bay · Trailer ·
// fees · chevron); below lg it wraps to two lines. The whole row is a button that expands inline to
// the full LoadRow (passed in as renderFull, so there is still exactly one tile component); expand
// state is per row and local only — nothing is persisted.
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { parseAppointment, suggestedPickup } from "@/lib/deliveryTime";
import { formatClockMinutes, weekdayShort } from "@/lib/etDateTime";
import { formatUsdCents } from "@/lib/money";
import CarrierStatusPill from "./CarrierStatusPill";
import { LinkedOrphanChip } from "./LinkedGroup";

/** The subset of a carrier load row the compact line reads. */
export interface CompactRowData {
  invoice_number: string | null;
  suffix: string;
  customer: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  bay_number: number | string | null;
  trailer_number: string | null;
  loading_status: string;
  ship_day: string;
  delivery_time: string | null;
  miles: number | null;
  duration_sec: number | null;
  distance_status: "ok" | "pending" | "unavailable";
  charges_total_cents: number;
}

/** Suggested pickup label ("8:30 AM", or "Tue 11:30 PM" when it falls on another day), or null. */
export function suggestedPickupLabel(row: CompactRowData): string | null {
  if (row.distance_status !== "ok") return null;
  const pickup = suggestedPickup(parseAppointment(row.delivery_time, row.ship_day), row.duration_sec);
  if (!pickup) return null;
  return `${pickup.date !== row.ship_day ? `${weekdayShort(pickup.date)} ` : ""}${formatClockMinutes(pickup.minutes)}`;
}

/** Left status stripe — same palette as the Schedule tab's cards. */
export function loadStripeCls(status: string): string {
  if (status === "loaded") return "border-l-[var(--success-bg)]";
  if (status === "loading") return "border-l-[var(--warn-border)]";
  if (status === "in_transit") return "border-l-[var(--info-border)]";
  return "border-l-[var(--border)]";
}

const CHIP = "inline-flex items-center px-1.5 py-0.5 rounded bg-[var(--ghost-bg)] text-[var(--ghost-text)] text-xs font-bold font-mono tabular-nums whitespace-nowrap";

export default function CarrierCompactRow({
  row,
  inGroup = false,
  orphan = false,
  renderFull,
}: {
  row: CompactRowData;
  inGroup?: boolean;
  orphan?: boolean;
  /** The full LoadRow (all buttons), rendered inline while expanded. */
  renderFull: () => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pickup = suggestedPickupLabel(row);
  const inv = `INV# ${row.invoice_number || "—"}${row.suffix}`;
  const cityState = [row.ship_to_city, row.ship_to_state].filter(Boolean).join(", ") || "—";
  const miles = row.distance_status === "ok" && row.miles != null ? `${Math.round(row.miles)} mi` : "—";
  const appt = row.delivery_time?.trim() || "—";
  const fees =
    row.charges_total_cents > 0 ? (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold tabular-nums bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)] whitespace-nowrap">
        {formatUsdCents(row.charges_total_cents)}
      </span>
    ) : null;
  const chevron = (
    <ChevronDown
      size={18}
      aria-hidden="true"
      className={`shrink-0 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
    />
  );
  const frame = inGroup
    ? "bg-[var(--surface)] border-l-4" // inside a LinkedGroup rail — the rail is the border; keep the stripe
    : "rounded border border-[var(--border)] bg-[var(--surface)] border-l-4";

  return (
    <div className={`${frame} ${loadStripeCls(row.loading_status)}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full min-h-[44px] px-3 py-2 text-left text-sm text-[var(--text)]"
      >
        {/* lg+: one line of columns */}
        <span className="hidden lg:grid grid-cols-[6.5rem_6rem_minmax(0,9rem)_auto_minmax(0,1fr)_minmax(0,10rem)_3.5rem_4.5rem_6.5rem_4.5rem_auto] items-center gap-3">
          <span>
            <CarrierStatusPill status={row.loading_status} />
          </span>
          <span className="font-bold tabular-nums">{pickup ?? "—"}</span>
          <span className="truncate text-[var(--text-muted)]" title={appt}>
            {appt}
          </span>
          <span className="font-semibold tabular-nums whitespace-nowrap">{inv}</span>
          <span className="min-w-0 flex items-center gap-2">
            <span className="truncate" title={row.customer || undefined}>
              {row.customer || "—"}
            </span>
            {orphan && <LinkedOrphanChip />}
          </span>
          <span className="truncate text-[var(--text-muted)]" title={cityState}>
            {cityState}
          </span>
          <span className="tabular-nums text-[var(--text-muted)] whitespace-nowrap">{miles}</span>
          <span className={CHIP}>Bay {row.bay_number ?? "—"}</span>
          <span className={`${CHIP} truncate`}>Trl {row.trailer_number || "—"}</span>
          <span>{fees}</span>
          {chevron}
        </span>

        {/* below lg: two lines */}
        <span className="flex flex-col gap-1 lg:hidden">
          <span className="flex items-center gap-2">
            <span className="font-bold tabular-nums">{pickup ?? "—"}</span>
            <span className="font-semibold tabular-nums whitespace-nowrap">{inv}</span>
            <span className="ml-auto flex items-center gap-2">
              {fees}
              <CarrierStatusPill status={row.loading_status} />
              {chevron}
            </span>
          </span>
          <span className="flex items-center gap-2 min-w-0 text-[var(--text-muted)]">
            <span className="truncate" title={row.customer || undefined}>
              {row.customer || "—"}
            </span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{cityState}</span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap font-mono tabular-nums">
              Bay {row.bay_number ?? "—"} / Trl {row.trailer_number || "—"}
            </span>
            {orphan && <LinkedOrphanChip />}
          </span>
        </span>
      </button>
      {open && <div className="border-t border-[var(--border)]">{renderFull()}</div>}
    </div>
  );
}
