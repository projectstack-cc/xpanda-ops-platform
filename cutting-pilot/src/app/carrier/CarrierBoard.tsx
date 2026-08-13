"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CarrierStatusPill from "./CarrierStatusPill";

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

async function handleSignOut() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // ignore — redirect regardless so sign-out always completes
  }
  window.location.href = "/login.html";
}

function LoadRow({ row }: { row: CarrierRow }) {
  const cityState = [row.ship_to_city, row.ship_to_state].filter(Boolean).join(", ");
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-bold tabular-nums truncate">
            INV# {row.invoice_number || "—"}
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
        <span className="inline-flex items-center px-2 py-1 rounded bg-[var(--ghost-bg)] text-[var(--ghost-text)] text-xs font-semibold font-mono tabular-nums">
          Bay {row.bay_number ?? "—"}
        </span>
        <span className="inline-flex items-center px-2 py-1 rounded bg-[var(--ghost-bg)] text-[var(--ghost-text)] text-xs font-semibold font-mono tabular-nums">
          Trailer {row.trailer_number || "—"}
        </span>
      </div>
    </div>
  );
}

function DaySection({ label, rows }: { label: string; rows: CarrierRow[] }) {
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2 px-1">
        {label}
      </h2>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--text-hint)]">
          No loads scheduled
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <LoadRow key={`${row.invoice_number}-${row.load_number}-${i}`} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function CarrierBoard() {
  const [data, setData] = useState<CarrierResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/v2/api/carrier");
      const json: CarrierResponse = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "Failed to load.");
        return;
      }
      setData(json);
      setError(null);
    } catch {
      setError("Network error — could not reach the server.");
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
      <header className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border)] px-4 py-3 flex items-center justify-between">
        <span className="font-bold text-base">Seal Express — Outgoing loads</span>
        <button
          type="button"
          onClick={handleSignOut}
          className="min-h-[44px] px-4 rounded-md border border-[var(--border)] text-sm font-semibold text-[var(--text-muted)] active:bg-[var(--ghost-bg)]"
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-4 space-y-6">
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
          <>
            <DaySection label={dayLabel(data.today)} rows={todayRows} />
            <DaySection label={dayLabel(data.tomorrow)} rows={tomorrowRows} />
          </>
        )}
      </main>

      <footer className="px-4 py-4 text-center text-xs text-[var(--text-hint)]">
        Showing loads for Lisma and Seal Express during rebrand.
      </footer>
    </div>
  );
}
