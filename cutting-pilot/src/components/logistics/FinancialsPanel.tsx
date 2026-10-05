"use client";
// src/components/logistics/FinancialsPanel.tsx
// Financials tab (PXXX-h) for Invoice Analytics — charts + accountant-grade breakdowns over
// GET /v2/api/logistics/analytics (PXXX-g). Sparse-data-safe throughout: prod currently holds
// 1 month / 1 date / 1 vendor, so every widget below has an explicit empty/single-point path.
import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import InfoTip from "@/components/InfoTip";
import { useTokenColors } from "@/components/charts/useTokenColors";
import ZipLinesModal from "@/components/logistics/ZipLinesModal";

interface Totals {
  totalSpend: number;
  lineCount: number;
  matchedCount: number;
  unmatchedCount: number;
  multiCount: number;
  matchRate: number;
  totalMiles: number;
  blendedPricePerMile: number;
}

interface MonthlyEntry {
  month: string;
  lineCount: number;
  totalSpend: number;
  matchedSpend: number;
  totalMiles: number;
  blendedPricePerMile: number;
}

interface TopLaneEntry {
  zip: string;
  city: string | null;
  lineCount: number;
  totalSpend: number;
  avgMiles: number;
  blendedPricePerMile: number | null;
}

interface PerZipEntry {
  zip: string;
  city: string;
  count: number;
  avgMiles: number;
  avgPrice: number;
  avgPricePerMile: number;
}

interface ZipVarianceEntry {
  zip: string;
  city: string;
  count: number;
  minPrice: number;
  maxPrice: number;
  spread: number;
  avgMiles: number;
}

interface AnalyticsResponse {
  ok: boolean;
  totals: Totals;
  monthly: MonthlyEntry[];
  topLanes: TopLaneEntry[];
  perZip: PerZipEntry[];
  zipVariance: ZipVarianceEntry[];
  error?: string;
}

const money = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const milesFmt = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} mi`;
const rate = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toFixed(2)}/mi`);

const spendTick = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`);

const CHART_TOOLTIP_STYLE = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--card-border)",
  borderRadius: 8,
  fontSize: 12,
};

// recharts renders fill/stroke as raw SVG presentation attributes, not CSS — tokens resolved to real
// color strings via useTokenColors (quickwin-08).
const FIN_TOKENS = {
  brand: { var: "--brand", fallback: "#e31837" },
  accent: { var: "--accent", fallback: "#0f172a" },
} as const;

export default function FinancialsPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [drillZip, setDrillZip] = useState<string | null>(null);
  // quickwin-08: shared hook — resolves the tokens on mount AND on theme toggle.
  const colors = useTokenColors(FIN_TOKENS);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/v2/api/logistics/analytics")
      .then(async (res) => {
        const body: AnalyticsResponse = await res.json();
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          setError(body?.error || "Could not load financials.");
          return;
        }
        setData(body);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "Could not reach the server.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="text-sm text-muted">Loading financials…</p>;
  if (error) return <p className="text-sm text-[var(--warn-text)]">{error}</p>;
  if (!data) return null;

  const { totals, monthly, topLanes, perZip, zipVariance } = data;
  const laneChartData = topLanes.map((l) => ({
    name: `${l.zip}${l.city ? " · " + l.city : ""}`,
    totalSpend: l.totalSpend,
  }));

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center gap-1 mb-3">
          <h2 className="text-sm font-semibold text-text">Overview</h2>
          <InfoTip label="Total spend, line count, match rate, and blended $/mi across every ingested invoice. Blended $/mi = total dollars ÷ total miles for matched lines." />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total spend", value: money(totals.totalSpend) },
            { label: "Line count", value: totals.lineCount.toLocaleString() },
            { label: "Match rate", value: totals.lineCount > 0 ? `${(totals.matchRate * 100).toFixed(1)}%` : "—" },
            { label: "Blended $/mi", value: totals.totalMiles > 0 ? rate(totals.blendedPricePerMile) : "—" },
          ].map((c) => (
            <div key={c.label} className="rounded-lg border border-[var(--card-border)] bg-surface p-3">
              <div className="text-xs text-muted">{c.label}</div>
              <div className="text-lg font-semibold text-text">{c.value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-[var(--card-border)] bg-surface p-4">
        <div className="flex items-center gap-1 mb-3">
          <h2 className="text-sm font-semibold text-text">Monthly trend</h2>
          <InfoTip label="Total freight billed per month (bars) and the blended rate — total dollars ÷ total miles — per month (line). Fills in as more months are ingested." />
        </div>
        {monthly.length === 0 ? (
          <p className="text-sm text-muted">No dated invoices ingested yet.</p>
        ) : (
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <ComposedChart data={monthly} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid stroke="var(--border-light)" vertical={false} />
                <XAxis dataKey="month" stroke="var(--muted)" tick={{ fontSize: 12 }} />
                <YAxis
                  yAxisId="spend"
                  stroke="var(--muted)"
                  tick={{ fontSize: 12 }}
                  tickFormatter={spendTick}
                />
                <YAxis
                  yAxisId="rate"
                  orientation="right"
                  stroke="var(--muted)"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  labelStyle={{ color: "var(--text)" }}
                  formatter={(value: any, name: any) => [name === "Blended $/mi" ? rate(Number(value)) : money(Number(value)), name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="spend" dataKey="totalSpend" name="Total spend" fill={colors.brand} radius={[4, 4, 0, 0]} />
                <Line
                  yAxisId="rate"
                  dataKey="blendedPricePerMile"
                  name="Blended $/mi"
                  stroke={colors.accent}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-[var(--card-border)] bg-surface p-4">
        <div className="flex items-center gap-1 mb-3">
          <h2 className="text-sm font-semibold text-text">Top-cost lanes</h2>
          <InfoTip label="The ZIPs you spent the most on overall (sum of billed amount), not the most per mile." />
        </div>
        {laneChartData.length === 0 ? (
          <p className="text-sm text-muted">No matched lanes yet.</p>
        ) : (
          <div style={{ width: "100%", height: Math.max(180, laneChartData.length * 36) }}>
            <ResponsiveContainer>
              <BarChart data={laneChartData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid stroke="var(--border-light)" horizontal={false} />
                <XAxis type="number" stroke="var(--muted)" tick={{ fontSize: 12 }} tickFormatter={spendTick} />
                <YAxis type="category" dataKey="name" stroke="var(--muted)" tick={{ fontSize: 11 }} width={140} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: "var(--text)" }} formatter={(value: any) => money(Number(value))} />
                <Bar dataKey="totalSpend" name="Total spend" fill={colors.brand} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center gap-1 mb-3">
          <h2 className="text-sm font-semibold text-text">Per-ZIP cost</h2>
          <InfoTip label="Per-ZIP averages across all ingested invoices. Click a ZIP to see the individual orders behind the numbers." />
        </div>
        <div className="rounded-lg border border-[var(--card-border)] bg-surface overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-[var(--card-border)]">
                <th className="px-3 py-2">ZIP</th>
                <th className="px-3 py-2">City</th>
                <th className="px-3 py-2 text-right">Orders</th>
                <th className="px-3 py-2 text-right">Avg miles</th>
                <th className="px-3 py-2 text-right">Avg amount</th>
                <th className="px-3 py-2 text-right">Avg $/mi</th>
              </tr>
            </thead>
            <tbody>
              {perZip.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-muted">
                    No invoices ingested yet.
                  </td>
                </tr>
              ) : (
                perZip.map((row) => (
                  <tr
                    key={row.zip}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDrillZip(row.zip)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDrillZip(row.zip);
                      }
                    }}
                    className="border-b border-[var(--border-light)] last:border-0 cursor-pointer hover:bg-[var(--surface-2)]"
                  >
                    <td className="px-3 py-3 whitespace-nowrap font-mono">{row.zip}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{row.city}</td>
                    <td className="px-3 py-3 text-right">{row.count}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">{milesFmt(row.avgMiles)}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">{money(row.avgPrice)}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">{rate(row.avgPricePerMile)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-[var(--card-border)] bg-surface p-4">
          <div className="flex items-center gap-1 mb-3">
            <h2 className="text-sm font-semibold text-text">Same-ZIP price variance</h2>
            <InfoTip label="ZIP codes where different orders were billed different amounts. Different delivery sites can share a ZIP, so a spread isn't always a mispricing — open a row to see the orders." />
          </div>
          {zipVariance.length === 0 ? (
            <p className="text-sm text-muted">No variance flagged.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {zipVariance.map((z) => (
                <li
                  key={z.zip}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDrillZip(z.zip)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDrillZip(z.zip);
                    }
                  }}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-[var(--border-light)] last:border-0 pb-2 last:pb-0 min-h-[44px] cursor-pointer rounded hover:bg-[var(--surface-2)] px-1 -mx-1"
                >
                  <span className="font-medium text-text">
                    {z.zip} · {z.city} <span className="text-muted">({z.count})</span>
                  </span>
                  <span className="text-muted">
                    {money(z.minPrice)}–{money(z.maxPrice)} · spread {money(z.spread)} · avg {milesFmt(z.avgMiles)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-[var(--card-border)] bg-surface p-4">
          <div className="flex items-center gap-1 mb-3">
            <h2 className="text-sm font-semibold text-text">Match-rate / data quality</h2>
            <InfoTip label="How many invoice lines resolved to a stored ship-to address. Unmatched/multi-destination lines are excluded from the rate math and shown for review." />
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Matched</span>
              <span className="font-medium text-text">{totals.matchedCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Unmatched</span>
              <span className="font-medium text-text">{totals.unmatchedCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Multi-destination</span>
              <span className="font-medium text-text">{totals.multiCount}</span>
            </div>
            <div className="flex justify-between border-t border-[var(--border-light)] pt-2">
              <span className="text-muted">Match rate</span>
              <span className="font-semibold text-text">{totals.lineCount > 0 ? `${(totals.matchRate * 100).toFixed(1)}%` : "—"}</span>
            </div>
          </div>
          <p className="text-xs text-muted mt-3">
            Unmatched lines are mostly pre-July BOLs and are expected, not a bug.
          </p>
        </div>
      </div>

      <ZipLinesModal zip={drillZip} onClose={() => setDrillZip(null)} />
    </div>
  );
}
