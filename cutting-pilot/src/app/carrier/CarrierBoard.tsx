"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import PlatformHeader from "@/components/PlatformHeader";
import { parseAppointment, suggestedPickup } from "@/lib/deliveryTime";
import { formatClockMinutes, formatEtDateTime, weekdayShort } from "@/lib/etDateTime";
import { formatUsdCents } from "@/lib/money";
import CarrierStatusPill from "./CarrierStatusPill";
import CarrierUploadModal from "./CarrierUploadModal";
import CarrierBolModal from "./CarrierBolModal";
import CarrierChargeModal from "./CarrierChargeModal";
import { useCarrierFetch } from "./useCarrierFetch";
import CarrierErrorBox from "./CarrierErrorBox";
import CarrierSchedule from "./CarrierSchedule";

// Leaflet touches `window` at import — client-only.
const CarrierMiniMap = dynamic(() => import("./CarrierMiniMap"), { ssr: false });

interface CarrierRow {
  invoice_number: string | null;
  customer: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  bay_number: number | string | null;
  trailer_number: string | null;
  loading_status: string;
  load_number: number | null;
  load_count: number | null;
  suffix: string;
  access_token: string | null;
  has_signed: boolean;
  additional_info: string | null;
  ship_day: string;
  has_carrier_copy: boolean;
  delivered_at: string | null;
  delivery_time: string | null;
  address: string | null;
  miles: number | null;
  duration_sec: number | null;
  lat: number | null;
  lng: number | null;
  distance_status: "ok" | "pending" | "unavailable";
  charges: CarrierCharge[];
  charges_total_cents: number;
}

interface CarrierCharge {
  fee_amount_cents: number;
  notes: string;
  created_by_name: string | null;
  created_at: string;
}

interface CarrierResponse {
  ok: boolean;
  today: string;
  tomorrow: string;
  rows: CarrierRow[];
  error?: string;
}

interface CarrierHistoryResponse {
  ok: boolean;
  rows: CarrierRow[];
  error?: string;
}

function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
    .format(date)
    .replace(",", " ·");
}

function formatDrive(sec: number): string {
  const totalMin = Math.round(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `~${h}h ${m}m` : `~${m}m`;
}

function InfoLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="w-[7.5rem] shrink-0 text-xs font-semibold uppercase tracking-wide text-[var(--text-hint)]">
        {label}
      </span>
      <span className="min-w-0 text-[var(--text)]">{children}</span>
    </div>
  );
}

interface RowActions {
  onUpload: (row: CarrierRow) => void;
  onViewBol: (row: CarrierRow) => void;
  onCharge: (row: CarrierRow) => void;
}

const PILL_CLS =
  "inline-flex items-center justify-center min-h-[44px] px-3 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold";

function LoadRow({ row, onUpload, onViewBol, onCharge }: { row: CarrierRow } & RowActions) {
  const uploadDisabled = !row.access_token;
  const delivered = row.loading_status === "delivered";
  const appt = parseAppointment(row.delivery_time, row.ship_day);
  const pickup = row.distance_status === "ok" ? suggestedPickup(appt, row.duration_sec) : null;
  const deliveredLabel = row.delivered_at ? formatEtDateTime(row.delivered_at, { weekday: true }) : null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold tabular-nums truncate">
            INV# {row.invoice_number || "—"}
            {row.suffix}
          </div>
          <div className="text-sm text-[var(--text-muted)] truncate mt-0.5">
            {row.customer || "—"}
          </div>
          {row.address && (
            <div className="text-sm text-[var(--text-hint)] mt-0.5 flex items-start gap-1">
              <span aria-hidden="true">📍</span>
              <span>{row.address}</span>
            </div>
          )}
        </div>
        <CarrierStatusPill status={row.loading_status} />
      </div>
      <div className="flex items-center gap-2 mt-3">
        <span className="inline-flex items-center px-3 py-1.5 rounded bg-[var(--ghost-bg)] text-[var(--ghost-text)] text-lg font-bold font-mono tabular-nums">
          Bay {row.bay_number ?? "—"}
        </span>
        <span className="inline-flex items-center px-3 py-1.5 rounded bg-[var(--ghost-bg)] text-[var(--ghost-text)] text-lg font-bold font-mono tabular-nums">
          Trailer {row.trailer_number || "—"}
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-1">
        <InfoLine label="Appointment">{row.delivery_time?.trim() || "—"}</InfoLine>
        <InfoLine label="Distance">
          {row.distance_status === "ok" && row.miles != null && row.duration_sec != null
            ? `${Math.round(row.miles)} mi · ${formatDrive(row.duration_sec)} drive`
            : row.distance_status === "pending"
              ? "Calculating…"
              : "—"}
        </InfoLine>
        {pickup && (
          <InfoLine label="Suggested pickup">
            <span className="font-semibold tabular-nums">
              {pickup.date !== row.ship_day ? `${weekdayShort(pickup.date)} ` : ""}
              {formatClockMinutes(pickup.minutes)}
            </span>
            <span className="ml-2 text-xs text-[var(--text-hint)]">includes 1 hr traffic buffer</span>
          </InfoLine>
        )}
        {deliveredLabel && (
          <div className="mt-1 inline-flex self-start items-center px-2 py-1 rounded text-xs font-semibold bg-[var(--success-bg)] text-[var(--success-text)]">
            Delivered · {deliveredLabel}
          </div>
        )}
      </div>
      {row.lat != null && row.lng != null && row.address && (
        <CarrierMiniMap lat={row.lat} lng={row.lng} address={row.address} />
      )}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        {row.access_token ? (
          <button type="button" onClick={() => onViewBol(row)} className={PILL_CLS}>
            View BOL
          </button>
        ) : (
          <span className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold opacity-40 cursor-not-allowed">
            View BOL
          </span>
        )}
        {row.has_signed && row.access_token && (
          <a
            href={`/api/public/bol-signed/${row.access_token}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold"
          >
            View Signed BOL
          </a>
        )}
        {row.has_carrier_copy && row.access_token && (
          <a
            href={`/v2/api/carrier/carrier-copy?token=${encodeURIComponent(row.access_token)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={PILL_CLS}
          >
            View carrier copy
          </a>
        )}
        <button
          type="button"
          disabled={uploadDisabled}
          onClick={() => onUpload(row)}
          className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {delivered ? "Upload physical BOL" : "Upload BOL"}
        </button>
        <button
          type="button"
          disabled={!row.access_token}
          onClick={() => onCharge(row)}
          className={`${PILL_CLS} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          Add fees / notes
        </button>
      </div>
      {row.charges.length > 0 && (
        <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--ghost-bg)] px-3 py-2">
          <div className="text-sm font-semibold tabular-nums">Fees: {formatUsdCents(row.charges_total_cents)}</div>
          <ul className="mt-1 flex flex-col gap-1">
            {row.charges.map((c, i) => (
              <li key={`${c.created_at}-${i}`} className="text-xs text-[var(--text-muted)]">
                <span className="font-semibold tabular-nums text-[var(--text)]">{formatUsdCents(c.fee_amount_cents)}</span>
                {" · "}
                <span className="whitespace-pre-wrap">{c.notes}</span>
                {" · "}
                <span className="tabular-nums">{formatEtDateTime(c.created_at, { weekday: true })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {row.additional_info && (
        <div className="mt-2 inline-block rounded px-2 py-1 text-xs bg-[var(--info-bg)] text-[var(--info-text)]">
          Additional info: {row.additional_info}
        </div>
      )}
    </div>
  );
}

// 4+ rows → the list scrolls inside a box sized to ~3.5 tiles, so the cut-off tile signals "scroll".
// Tile height ~400px since carrier-03's info block + minimap; capped at 85vh on short screens.
const SCROLL_THRESHOLD = 4;

function DaySection({
  heading,
  label,
  rows,
  emptyText = "No loads scheduled",
  onUpload,
  onViewBol,
  onCharge,
}: {
  heading: string;
  label: string;
  rows: CarrierRow[];
  emptyText?: string;
} & RowActions) {
  const scrolling = rows.length >= SCROLL_THRESHOLD;
  return (
    <section>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-2 px-1">
        <h2 className="text-base font-bold text-[var(--text)]">{heading}</h2>
        <span className="text-sm text-[var(--text-muted)]">{label}</span>
        {scrolling && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums bg-[var(--ghost-bg)] text-[var(--text-muted)]">
            {rows.length} loads
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--text-hint)]">
          {emptyText}
        </div>
      ) : (
        <div
          className={
            scrolling
              ? "flex flex-col gap-2 max-h-[min(calc(3.5*var(--carrier-row-h,400px)),85vh)] overflow-y-auto overscroll-contain pr-1"
              : "flex flex-col gap-2"
          }
        >
          {rows.map((row, i) => (
            <LoadRow
              key={`${row.invoice_number}-${row.load_number}-${i}`}
              row={row}
              onUpload={onUpload}
              onViewBol={onViewBol}
              onCharge={onCharge}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface CarrierBoardProps {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

type CarrierTab = "upcoming" | "schedule" | "history";

const TABS: Array<{ key: CarrierTab; label: string }> = [
  { key: "upcoming", label: "Upcoming" },
  { key: "schedule", label: "Schedule" },
  { key: "history", label: "History (7 days)" },
];

export default function CarrierBoard({ userName, isAdmin, permissions }: CarrierBoardProps) {
  const [tab, setTab] = useState<CarrierTab>("upcoming");
  const upcoming = useCarrierFetch<CarrierResponse>("/v2/api/carrier", tab === "upcoming");
  const history = useCarrierFetch<CarrierHistoryResponse>("/v2/api/carrier/history", tab === "history");
  const [uploadRow, setUploadRow] = useState<CarrierRow | null>(null);
  const [bolRow, setBolRow] = useState<CarrierRow | null>(null);
  const [chargeRow, setChargeRow] = useState<CarrierRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reloadActive = () => (tab === "history" ? history.load() : upcoming.load());

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  const data = upcoming.data;
  const todayRows = data ? data.rows.filter((r) => r.ship_day === data.today) : [];
  const tomorrowRows = data ? data.rows.filter((r) => r.ship_day === data.tomorrow) : [];
  const actions: RowActions = { onUpload: setUploadRow, onViewBol: setBolRow, onCharge: setChargeRow };
  // Schedule owns its own fetch (CarrierSchedule, mounted only while that tab is open).
  const active = tab === "history" ? history : tab === "upcoming" ? upcoming : null;

  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col">
      <PlatformHeader
        title="Carrier View"
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        currentPath="/v2/carrier"
        homeHref="/v2/carrier"
      />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-4">
        {/* Carrier brand strip — logo is transparent, so no background box. Plain <img>: basePath
            doesn't prefix it, which is correct for /logo/* served ungated by the legacy app. */}
        <div className="flex items-center gap-3 mb-4">
          <img src="/logo/seal-express-logo.webp" alt="Seal Express" className="h-12 w-auto" />
          <span className="font-bold text-base">Seal Express — Outgoing loads</span>
        </div>

        <div role="tablist" aria-label="Carrier views" className="flex flex-wrap gap-2 mb-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={[
                "min-h-[44px] px-4 rounded-md border text-sm font-semibold",
                tab === t.key
                  ? "border-[var(--brand)] text-[var(--brand)] bg-[var(--surface)]"
                  : "border-[var(--border)] text-[var(--text-muted)] bg-[var(--surface)]",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>

        {active && active.loading && !active.data && !active.error && (
          <div className="text-center text-sm text-[var(--text-hint)] py-10">Loading…</div>
        )}

        {active?.error && <CarrierErrorBox error={active.error} onRetry={active.load} />}

        {tab === "schedule" && <CarrierSchedule />}

        {tab === "upcoming" && data && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <DaySection heading="Today's Loads" label={dayLabel(data.today)} rows={todayRows} {...actions} />
            <DaySection heading="Tomorrow's Loads" label={dayLabel(data.tomorrow)} rows={tomorrowRows} {...actions} />
          </div>
        )}

        {tab === "history" && history.data && (
          <DaySection
            heading="Delivered"
            label="last 7 days · newest first"
            rows={history.data.rows}
            emptyText="No delivered loads in the last 7 days"
            {...actions}
          />
        )}
      </main>

      {uploadRow && (
        <CarrierUploadModal
          isOpen={!!uploadRow}
          onClose={() => setUploadRow(null)}
          row={uploadRow}
          onDone={reloadActive}
        />
      )}

      {bolRow && (
        <CarrierBolModal
          token={bolRow.access_token}
          title={`BOL — INV# ${bolRow.invoice_number || "—"}${bolRow.suffix}`}
          onClose={() => setBolRow(null)}
        />
      )}

      {chargeRow && chargeRow.access_token && (
        <CarrierChargeModal
          isOpen={!!chargeRow}
          onClose={() => setChargeRow(null)}
          token={chargeRow.access_token}
          title={`Add fees / notes — INV# ${chargeRow.invoice_number || "—"}${chargeRow.suffix}`}
          onSaved={() => {
            reloadActive();
            showToast("Sent to XPanda logistics");
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded text-sm font-medium pointer-events-none bg-[var(--success-bg)] text-[var(--success-text)]"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
