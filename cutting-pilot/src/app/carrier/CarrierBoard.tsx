"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PlatformHeader from "@/components/PlatformHeader";
import CarrierStatusPill from "./CarrierStatusPill";
import CarrierUploadModal from "./CarrierUploadModal";

const REFRESH_MS = 60_000;

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
}

interface CarrierResponse {
  ok: boolean;
  today: string;
  tomorrow: string;
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

function LoadRow({ row, onUpload }: { row: CarrierRow; onUpload: (row: CarrierRow) => void }) {
  const cityState = [row.ship_to_city, row.ship_to_state].filter(Boolean).join(", ");
  const uploadDisabled = !row.access_token || row.loading_status === "delivered";
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
          {cityState && (
            <div className="text-sm text-[var(--text-hint)] mt-0.5 flex items-center gap-1">
              <span aria-hidden="true">📍</span>
              <span className="truncate">{cityState}</span>
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
      <div className="flex flex-wrap items-center gap-2 mt-3">
        {row.access_token ? (
          <a
            href={`/track/${row.access_token}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold"
          >
            View BOL
          </a>
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
        <button
          type="button"
          disabled={uploadDisabled}
          onClick={() => onUpload(row)}
          className="inline-flex items-center justify-center min-h-[44px] px-3 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Upload BOL
        </button>
      </div>
      {row.additional_info && (
        <div className="mt-2 inline-block rounded px-2 py-1 text-xs bg-[var(--info-bg)] text-[var(--info-text)]">
          Additional info: {row.additional_info}
        </div>
      )}
    </div>
  );
}

// 4+ rows → the list scrolls inside a box sized to ~3.5 tiles, so the cut-off tile signals "scroll".
const SCROLL_THRESHOLD = 4;

function DaySection({
  heading,
  label,
  rows,
  onUpload,
}: {
  heading: string;
  label: string;
  rows: CarrierRow[];
  onUpload: (row: CarrierRow) => void;
}) {
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
          No loads scheduled
        </div>
      ) : (
        <div
          className={
            scrolling
              ? "flex flex-col gap-2 max-h-[calc(3.5*var(--carrier-row-h,176px))] overflow-y-auto overscroll-contain pr-1"
              : "flex flex-col gap-2"
          }
        >
          {rows.map((row, i) => (
            <LoadRow key={`${row.invoice_number}-${row.load_number}-${i}`} row={row} onUpload={onUpload} />
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

export default function CarrierBoard({ userName, isAdmin, permissions }: CarrierBoardProps) {
  const [data, setData] = useState<CarrierResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadRow, setUploadRow] = useState<CarrierRow | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasGoodDataRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/v2/api/carrier");

      // 503 = the auth layer's D1 lookup blipped — transient, not a session verdict.
      // Never treat it as logged-out; keep whatever's already on screen and retry next tick.
      if (res.status === 503) {
        if (!hasGoodDataRef.current) setError("Reconnecting…");
        return;
      }

      // 401 from a background poll could be a genuinely dead session, or a stray one-off.
      // Confirm against the auth endpoint before showing anything scarier than "reconnecting."
      if (res.status === 401) {
        let confirmedGone = true;
        try {
          const confirmRes = await fetch("/api/auth/me");
          confirmedGone = !confirmRes.ok;
        } catch {
          confirmedGone = false;
        }
        if (!confirmedGone) {
          if (!hasGoodDataRef.current) setError("Reconnecting…");
          return;
        }
        setError("Signed out — sign back in to resume.");
        return;
      }

      const json: CarrierResponse = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "Failed to load.");
        return;
      }
      hasGoodDataRef.current = true;
      setData(json);
      setError(null);
    } catch {
      if (!hasGoodDataRef.current) setError("Network error — could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, REFRESH_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  const todayRows = data ? data.rows.filter((r) => r.ship_day === data.today) : [];
  const tomorrowRows = data ? data.rows.filter((r) => r.ship_day === data.tomorrow) : [];

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

        {loading && !data && !error && (
          <div className="text-center text-sm text-[var(--text-hint)] py-10">Loading…</div>
        )}

        {error && (
          <div className="rounded-lg border border-[var(--danger-bg)] bg-[var(--surface)] px-4 py-4 text-center">
            <p className="text-sm font-semibold text-[var(--danger-bg)] mb-3">{error}</p>
            <button
              type="button"
              onClick={load}
              className="min-h-[44px] px-5 rounded-md bg-[var(--accent)] text-[var(--surface)] text-sm font-semibold"
            >
              Retry
            </button>
          </div>
        )}

        {data && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <DaySection heading="Today's Loads" label={dayLabel(data.today)} rows={todayRows} onUpload={setUploadRow} />
            <DaySection heading="Tomorrow's Loads" label={dayLabel(data.tomorrow)} rows={tomorrowRows} onUpload={setUploadRow} />
          </div>
        )}
      </main>

      {uploadRow && (
        <CarrierUploadModal
          isOpen={!!uploadRow}
          onClose={() => setUploadRow(null)}
          row={uploadRow}
          onDone={load}
        />
      )}
    </div>
  );
}
