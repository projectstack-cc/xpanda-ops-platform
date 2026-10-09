"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronDown } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import { PICKUP_TRAFFIC_BUFFER_MIN } from "@/lib/deliveryTime";
import { etDateKey, formatEtDateTime } from "@/lib/etDateTime";
import { formatUsdCents } from "@/lib/money";
import { addDays } from "@/lib/productionSchedule";
import CarrierStatusPill from "./CarrierStatusPill";
import CarrierUploadModal from "./CarrierUploadModal";
import CarrierBolModal from "./CarrierBolModal";
import CarrierChargeModal from "./CarrierChargeModal";
import { useCarrierFetch } from "./useCarrierFetch";
import CarrierErrorBox from "./CarrierErrorBox";
import CarrierSchedule from "./CarrierSchedule";
import LinkedGroupList, { LinkedOrphanChip } from "./LinkedGroup";
import CarrierCompactRow, { suggestedPickupLabel } from "./CarrierCompactRow";

// Leaflet touches `window` at import — client-only.
const DestinationMiniMap = dynamic(() => import("@/components/DestinationMiniMap"), { ssr: false });

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
  has_signed_digital: boolean;
  has_signed_photo: boolean;
  additional_info: string | null;
  ship_day: string;
  has_carrier_copy: boolean;
  delivered_at: string | null;
  delivery_time: string | null;
  trailer_group_id: string | null;
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
  next_day: string;
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

// Upcoming section heading after Today: "Tomorrow's Loads" for calendar tomorrow, else the full
// weekday ("Saturday's Loads", "Monday's Loads"). ET-safe: parsed as a UTC calendar date.
function upcomingDayHeading(today: string, dateStr: string): string {
  if (dateStr === addDays(today, 1)) return "Tomorrow's Loads";
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  );
  return `${weekday}'s Loads`;
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
  "inline-flex items-center justify-center min-h-[44px] px-3 rounded border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold";

type LoadRowVariant = "upcoming" | "history";

// carrier-09: the minimap sits behind a collapsed "View Map" disclosure; DestinationMiniMap (Leaflet)
// is only mounted while open.
function MapDisclosure({ lat, lng, address }: { lat: number; lng: number; address: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 min-h-[44px] px-1 text-sm font-semibold text-[var(--text)]"
      >
        <ChevronDown size={16} aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`} />
        View Map
      </button>
      {open && <DestinationMiniMap lat={lat} lng={lng} address={address} />}
    </div>
  );
}

function LoadRow({
  row,
  variant,
  onUpload,
  onViewBol,
  onCharge,
  inGroup = false,
  orphan = false,
}: { row: CarrierRow; variant: LoadRowVariant; inGroup?: boolean; orphan?: boolean } & RowActions) {
  const uploadDisabled = !row.access_token;
  const delivered = row.loading_status === "delivered";
  const upcoming = variant === "upcoming"; // History is informational: no map, distance or pickup
  const pickup = upcoming ? suggestedPickupLabel(row) : null;
  const tokenQs = row.access_token ? encodeURIComponent(row.access_token) : "";
  const deliveredLabel = row.delivered_at ? formatEtDateTime(row.delivered_at, { weekday: true }) : null;
  return (
    <div
      className={
        inGroup
          ? "bg-[var(--surface)] px-4 py-3" // inside a LinkedGroup rail — the rail is the border
          : "rounded border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold tabular-nums truncate">
              INV# {row.invoice_number || "—"}
              {row.suffix}
            </span>
            {orphan && <LinkedOrphanChip />}
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
        {upcoming && (
          <InfoLine label="Distance">
            {row.distance_status === "ok" && row.miles != null && row.duration_sec != null
              ? `${Math.round(row.miles)} mi · ${formatDrive(row.duration_sec)} drive`
              : row.distance_status === "pending"
                ? "Calculating…"
                : "—"}
          </InfoLine>
        )}
        {pickup && (
          <InfoLine label="Suggested pickup">
            <span className="font-semibold tabular-nums">{pickup}</span>
            <span className="ml-2 text-xs text-[var(--text-hint)]">includes {PICKUP_TRAFFIC_BUFFER_MIN} min traffic buffer</span>
          </InfoLine>
        )}
        {deliveredLabel && (
          <div className="mt-1 inline-flex self-start items-center px-2 py-1 rounded text-xs font-semibold bg-[var(--success-bg)] text-[var(--success-text)]">
            Delivered · {deliveredLabel}
          </div>
        )}
      </div>
      {upcoming && row.lat != null && row.lng != null && row.address && (
        <MapDisclosure lat={row.lat} lng={row.lng} address={row.address} />
      )}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        {row.access_token ? (
          <button type="button" onClick={() => onViewBol(row)} className={PILL_CLS}>
            View BOL
          </button>
        ) : (
          <span className="inline-flex items-center justify-center min-h-[44px] px-3 rounded border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold opacity-40 cursor-not-allowed">
            View BOL
          </span>
        )}
        {row.has_signed_digital && row.access_token && (
          <a
            href={`/v2/api/carrier/signed-bol?token=${tokenQs}&kind=digital`}
            target="_blank"
            rel="noopener noreferrer"
            className={PILL_CLS}
          >
            Signed BOL (digital)
          </a>
        )}
        {row.has_signed_photo && row.access_token && (
          <a
            href={`/v2/api/carrier/signed-bol?token=${tokenQs}&kind=photo`}
            target="_blank"
            rel="noopener noreferrer"
            className={PILL_CLS}
          >
            Signed BOL (photo)
          </a>
        )}
        {row.has_carrier_copy && row.access_token && (
          <a href={`/v2/api/carrier/carrier-copy?token=${tokenQs}`} target="_blank" rel="noopener noreferrer" className={PILL_CLS}>
            Carrier copy
          </a>
        )}
        <button
          type="button"
          disabled={uploadDisabled}
          onClick={() => onUpload(row)}
          className="inline-flex items-center justify-center min-h-[44px] px-3 rounded border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
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
        <div className="mt-3 rounded border border-[var(--border)] bg-[var(--ghost-bg)] px-3 py-2">
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

type CarrierListView = "compact" | "expanded";

/**
 * Per-browser Compact | Expanded choice (carrier-09 Upcoming, carrier-10 History — each tab has its
 * own key). Starts "compact" and reads storage after mount (no SSR mismatch); blocked storage just
 * means the choice isn't remembered.
 */
function useStoredView(key: string): [CarrierListView, (v: CarrierListView) => void] {
  const [view, setView] = useState<CarrierListView>("compact");
  useEffect(() => {
    try {
      setView(window.localStorage.getItem(key) === "expanded" ? "expanded" : "compact");
    } catch {
      /* storage blocked — stay compact */
    }
  }, [key]);
  const change = (v: CarrierListView) => {
    setView(v);
    try {
      window.localStorage.setItem(key, v);
    } catch {
      /* storage blocked — the choice just isn't remembered */
    }
  };
  return [view, change];
}

function LoadsCount({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold tabular-nums bg-[var(--ghost-bg)] text-[var(--text-muted)]">
      {n} {n === 1 ? "load" : "loads"}
    </span>
  );
}

// Upcoming day (Today / Tomorrow). carrier-09: no inner scroll box — the column grows and the page
// scrolls, like the Schedule tab.
function DaySection({
  heading,
  label,
  rows,
  view,
  onUpload,
  onViewBol,
  onCharge,
}: {
  heading: string;
  label: string;
  rows: CarrierRow[];
  view: CarrierListView;
} & RowActions) {
  const actions: RowActions = { onUpload, onViewBol, onCharge };
  return (
    <section>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-2 px-1">
        <h2 className="text-base font-bold text-[var(--text)]">{heading}</h2>
        <span className="text-sm text-[var(--text-muted)]">{label}</span>
        <LoadsCount n={rows.length} />
      </div>
      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--text-hint)]">
          No loads scheduled
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <LinkedGroupList
            rows={rows}
            keyOf={(row, i) => `${row.invoice_number}-${row.load_number}-${i}`}
            renderRow={(row, ctx) =>
              view === "compact" ? (
                <CarrierCompactRow variant="upcoming"
                  row={row}
                  inGroup={ctx.inGroup}
                  orphan={ctx.orphan}
                  renderFull={() => <LoadRow row={row} variant="upcoming" inGroup {...actions} />}
                />
              ) : (
                <LoadRow row={row} variant="upcoming" inGroup={ctx.inGroup} orphan={ctx.orphan} {...actions} />
              )
            }
          />
        </div>
      )}
    </section>
  );
}

// History (carrier-09): one section per delivered ET day, newest first. carrier-10: Compact = full-
// width compact rows (history variant), Expanded = the carrier-09 responsive tile grid. Informational —
// LoadRow's "history" variant drops map / distance / pickup but keeps every button.
// Linked groups never cross a day.
function HistoryDays({ rows, view, onUpload, onViewBol, onCharge }: { rows: CarrierRow[]; view: CarrierListView } & RowActions) {
  const actions: RowActions = { onUpload, onViewBol, onCharge };
  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--text-hint)]">
        No delivered loads in the last 7 days
      </div>
    );
  }
  const days: Array<{ key: string; label: string; rows: CarrierRow[] }> = [];
  for (const row of rows) {
    const b = historyBucket(row);
    const last = days[days.length - 1];
    if (last && last.key === b.key) last.rows.push(row);
    else days.push({ key: b.key, label: b.label, rows: [row] });
  }
  return (
    <div className="flex flex-col gap-6">
      {days.map((day) => (
        <section key={day.key}>
          <div className="flex items-center gap-2 mb-3 px-1">
            <h2 className="text-base font-bold text-[var(--text)] whitespace-nowrap">{day.label}</h2>
            <LoadsCount n={day.rows.length} />
            <div className="flex-1 h-px bg-[var(--border)]" aria-hidden="true" />
          </div>
          {view === "compact" ? (
            <div className="flex flex-col gap-2">
              <LinkedGroupList
                rows={day.rows}
                keyOf={(row, i) => `${row.invoice_number}-${row.load_number}-${i}`}
                renderRow={(row, ctx) => (
                  <CarrierCompactRow variant="history"
                    row={row}
                    inGroup={ctx.inGroup}
                    orphan={ctx.orphan}
                    renderFull={() => <LoadRow row={row} variant="history" inGroup {...actions} />}
                  />
                )}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 items-start">
              <LinkedGroupList
                rows={day.rows}
                keyOf={(row, i) => `${row.invoice_number}-${row.load_number}-${i}`}
                renderRow={(row, ctx) => (
                  <LoadRow row={row} variant="history" inGroup={ctx.inGroup} orphan={ctx.orphan} {...actions} />
                )}
              />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

// Compact | Expanded toggle (Upcoming + History) — flat underline segments like the carrier-07 tabs.
function ViewToggle({
  view,
  onChange,
  label,
}: {
  view: CarrierListView;
  onChange: (v: CarrierListView) => void;
  /** aria-label of the group, e.g. "Upcoming view". */
  label: string;
}) {
  const opts: Array<{ key: CarrierListView; label: string }> = [
    { key: "compact", label: "Compact" },
    { key: "expanded", label: "Expanded" },
  ];
  return (
    <div role="group" aria-label={label} className="flex border-b border-[var(--border)]">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={view === o.key}
          onClick={() => onChange(o.key)}
          className={[
            "min-h-[44px] px-4 text-sm font-semibold -mb-px border-b-2",
            view === o.key
              ? "border-[var(--brand)] text-[var(--text)]"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface CarrierBoardProps {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

// History rows arrive newest-delivered first, so buckets come out newest day first.
function historyBucket(row: CarrierRow): { key: string; label: string } {
  const key = etDateKey(row.delivered_at) ?? "unknown";
  return { key, label: key === "unknown" ? "Delivered" : `Delivered ${dayLabel(key)}` };
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
  // Compact by default; each tab remembers its own choice (key kept from carrier-09 for Upcoming).
  const [upcomingListView, setUpcomingListView] = useStoredView("carrier_upcoming_view_v1");
  const [historyListView, setHistoryListView] = useStoredView("carrier_history_view_v1");

  const reloadActive = () => (tab === "history" ? history.load() : upcoming.load());

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  const data = upcoming.data;
  const todayRows = data ? data.rows.filter((r) => r.ship_day === data.today) : [];
  // After Today: any weekend day with loads before next_day (rare Saturday ship days), then
  // next_day itself, which always renders even when empty (carrier-11).
  const laterDays = data
    ? [
        ...Array.from(new Set(data.rows.map((r) => r.ship_day)))
          .filter((d) => d > data.today && d < data.next_day)
          .sort(),
        data.next_day,
      ]
    : [];
  const sectionCount = 1 + laterDays.length;
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

      <main className="flex-1 w-full max-w-[1920px] mx-auto px-4 lg:px-6 py-4">
        {/* Carrier brand strip — logo is transparent, so no background box. Plain <img>: basePath
            doesn't prefix it, which is correct for /logo/* served ungated by the legacy app. */}
        <div className="flex items-center gap-3 pb-3 mb-3 border-b border-[var(--border)]">
          <img src="/logo/seal-express-logo.webp" alt="Seal Express" className="h-9 w-auto" />
          <div className="min-w-0">
            <div className="text-lg font-bold leading-tight text-[var(--text)]">Seal Express — Outgoing loads</div>
            <div className="text-xs text-[var(--text-muted)]">XPanda Foam · Orlando, FL</div>
          </div>
        </div>

        <div role="tablist" aria-label="Carrier views" className="flex border-b border-[var(--border)] mb-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={[
                "min-h-[44px] px-4 text-sm font-semibold -mb-px border-b-2",
                tab === t.key
                  ? "border-[var(--brand)] text-[var(--text)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]",
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
          <>
            <div className="flex justify-end mb-3">
              <ViewToggle view={upcomingListView} onChange={setUpcomingListView} label="Upcoming view" />
            </div>
            {/* Compact rows need the full width for their columns, so the days stack. */}
            <div
              className={`grid grid-cols-1 ${
                upcomingListView === "expanded" ? (sectionCount === 3 ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2") : ""
              } gap-6 items-start`}
            >
              <DaySection heading="Today's Loads" label={dayLabel(data.today)} rows={todayRows} view={upcomingListView} {...actions} />
              {laterDays.map((day) => (
                <DaySection
                  key={day}
                  heading={upcomingDayHeading(data.today, day)}
                  label={dayLabel(day)}
                  rows={data.rows.filter((r) => r.ship_day === day)}
                  view={upcomingListView}
                  {...actions}
                />
              ))}
            </div>
          </>
        )}

        {tab === "history" && history.data && (
          <>
            <div className="flex justify-end mb-3">
              <ViewToggle view={historyListView} onChange={setHistoryListView} label="History view" />
            </div>
            <HistoryDays rows={history.data.rows} view={historyListView} {...actions} />
          </>
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
