"use client";
// src/components/logistics/FuelSurchargeControl.tsx
// lgx-fuel-01: daily fuel surcharge entry on the v2 shipment dashboard. One flat dollar rate per
// calendar date (fuel_surcharge_rates), read live by every BOL dated that day at render time — never
// frozen onto the BOL. Empty amount + Clear removes the rate. canEdit=false → read-only (viewers
// still see the rate). 400/403/501 messages are surfaced inline, never swallowed.
import { useCallback, useEffect, useState } from "react";
import { Fuel } from "lucide-react";

interface Props {
  canEdit: boolean;
}

interface RateState {
  amount_cents: number | null;
  entered_by_name: string | null;
  updated_at: string | null;
}

function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function formatET(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d) + " ET";
}

export default function FuelSurchargeControl({ canEdit }: Props) {
  const [date, setDate] = useState<string>(todayET);
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState<RateState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/bols/fuel-surcharge?date=${encodeURIComponent(d)}`, { credentials: "same-origin" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
      setRate({ amount_cents: body.amount_cents, entered_by_name: body.entered_by_name, updated_at: body.updated_at });
      setAmount(body.amount_cents == null ? "" : (body.amount_cents / 100).toFixed(2));
    } catch (e: any) {
      setRate(null);
      setAmount("");
      setError(`Couldn't load the fuel surcharge: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  const hasRate = rate?.amount_cents != null;
  const isClear = amount.trim() === "" && hasRate;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/v2/api/bols/fuel-surcharge", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, amount: amount.trim() === "" ? null : amount }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        const msg =
          body?.error === "invalid_amount" ? "Enter a dollar amount like 45.00."
          : body?.error === "invalid_date" ? "Pick a valid date."
          : body?.error || `Save failed (HTTP ${res.status}).`;
        setError(msg);
        return;
      }
      await load(date);
    } catch (e: any) {
      setError(`Save failed: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  }

  const status = loading
    ? "Loading…"
    : hasRate
      ? `Set by ${rate?.entered_by_name || "unknown"}${rate?.updated_at ? ` · ${formatET(rate.updated_at)}` : ""}`
      : "No rate for this date — BOLs dated this day print no surcharge line.";

  return (
    <div className="bg-surface border border-[var(--card-border)] rounded-xl px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-text">
          <Fuel size={16} className="text-muted" aria-hidden="true" />
          Fuel surcharge
        </span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Fuel surcharge date"
          className="min-h-[44px] px-2 text-sm rounded-lg border border-[var(--border)] bg-surface text-text focus:outline-hidden focus:border-[var(--brand)] cursor-pointer"
        />
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted pointer-events-none">$</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="45.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canEdit && !saving && !loading) void handleSave();
            }}
            readOnly={!canEdit}
            aria-label="Fuel surcharge amount in dollars"
            className="min-h-[44px] w-28 pl-6 pr-2 text-sm rounded-lg border border-[var(--border)] bg-surface text-text placeholder:text-muted focus:outline-hidden focus:border-[var(--brand)] read-only:opacity-70"
          />
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading || (amount.trim() === "" && !hasRate)}
            className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg bg-[var(--brand)] text-white text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : isClear ? "Clear" : "Save"}
          </button>
        )}
        <span className="text-xs text-muted">{status}</span>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--danger-text)]">{error}</p>}
    </div>
  );
}
