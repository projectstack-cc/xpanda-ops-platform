"use client";
// src/components/logistics/InvoiceAnalytics.tsx
// PXXX invoice-analytics -d. Upload a freight invoice PDF -> client-side parse
// (parseInvoicePdf.ts) -> POST to /v2/api/logistics/invoice (-c, resolves BOL tokens ->
// addresses -> mileage -> price/mile) -> render the match-rate banner, summary cards, line
// table, and cross-history flags panels from that exact response.
import { useEffect, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import Modal from "@/components/Modal";
import InfoTip from "@/components/InfoTip";
import { parseInvoicePdf, type ParsedInvoice } from "@/lib/logistics/parseInvoicePdf";
import ZipLinesModal from "@/components/logistics/ZipLinesModal";
import FinancialsPanel from "@/components/logistics/FinancialsPanel";
import InvoiceResultToolbar from "@/components/logistics/InvoiceResultToolbar";
import ResolveUnmatchedModal, { type UnresolvedLine } from "@/components/logistics/ResolveUnmatchedModal";

interface Props {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

type MatchStatus = "matched" | "unmatched" | "multi_destination";

interface ResultLine {
  invoiceNumber?: string; // only present on History (month) lines, which can span invoices
  lineNo: number;
  shipDate: string | null;
  loadNumber: string | null;
  poText: string;
  bolNumbers: string[];
  matchStatus: MatchStatus;
  shipTo: { city: string; state: string; zip: string } | null;
  miles: number | null;
  amount: number;
  pricePerMile: number | null;
  excludedFromStats: boolean;
  note: string | null;
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

interface InversionEntry {
  nearerZip: string;
  nearerMiles: number;
  nearerAvgPrice: number;
  fartherZip: string;
  fartherMiles: number;
  fartherAvgPrice: number;
}

interface MonthResponse {
  ok: boolean;
  months: string[];
  month: string | null;
  result: InvoiceResult | null;
  error?: string;
}

interface InvoiceResult {
  invoice: { vendor: string; invoiceNumber: string; invoiceDate: string | null };
  summary: {
    lineCount: number;
    matchedCount: number;
    unmatchedCount: number;
    multiDestCount: number;
    totalAmount: number;
    avgMiles: number;
    avgPrice: number;
    avgPricePerMile: number;
  };
  lines: ResultLine[];
  flags: { zipVariance: ZipVarianceEntry[]; inversions: InversionEntry[] };
}

interface DuplicateInfo {
  invoiceNumber: string;
  vendor: string | null;
  invoiceDate: string | null;
  existingLineCount: number;
  existingTotalAmount: number | null;
  existingIngestedAt: string | null;
  incomingLineCount: number;
}

type Stage = "idle" | "parsing" | "submitting" | "done" | "error";

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const miles = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} mi`;

const STATUS_BADGE: Record<MatchStatus, string> = {
  matched: "bg-[var(--success-bg)] text-[var(--success-text)]",
  unmatched: "bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)]",
  multi_destination: "bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)]",
};
const STATUS_LABEL: Record<MatchStatus, string> = {
  matched: "Matched",
  unmatched: "Unmatched",
  multi_destination: "Multi-destination",
};

export default function InvoiceAnalytics({ userName, isAdmin, permissions }: Props) {
  const [tab, setTab] = useState<"upload" | "history" | "financials">("upload");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [dragActive, setDragActive] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedInvoice | null>(null);
  const [result, setResult] = useState<InvoiceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);

  async function handleFile(file: File | undefined | null) {
    if (!file) return;
    setError(null);
    setResult(null);
    setFilename(file.name);
    setStage("parsing");
    try {
      const doc = await parseInvoicePdf(file);
      if (!doc.lines.length) {
        setStage("error");
        setError("Could not find any line items in this PDF.");
        return;
      }
      setParsed(doc);
      await submit(doc);
    } catch (e: any) {
      setStage("error");
      setError(e?.message || "Could not read this PDF.");
    }
  }

  async function submit(doc: ParsedInvoice, confirm = false) {
    setStage("submitting");
    try {
      const res = await fetch("/v2/api/logistics/invoice", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...doc, confirm }),
      });

      if (res.status === 401) {
        setStage("error");
        setError("Your session has expired. Please log in again.");
        return;
      }
      if (res.status === 403) {
        setStage("error");
        setError("You're not authorized to use Invoice Analytics.");
        return;
      }
      if (res.status === 503) {
        setStage("error");
        setError("Temporarily unavailable — please retry.");
        return;
      }

      const body = await res.json();
      if (!body.ok) {
        setStage("error");
        setError(body.error || body.detail || "Something went wrong.");
        return;
      }

      if (body.duplicate) {
        setDuplicateInfo(body.duplicate);
        setStage("idle");
        return;
      }

      setResult(body);
      setStage("done");
    } catch (e: any) {
      setStage("error");
      setError(e?.message || "Could not reach the server.");
    }
  }

  const isBusy = stage === "parsing" || stage === "submitting";
  const unresolvedLines = result ? result.lines.filter((l) => l.excludedFromStats) : [];

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <div className="no-print">
        <PlatformHeader
          userName={userName}
          isAdmin={isAdmin}
          permissions={permissions}
          title="Invoice Analytics · v2"
          currentPath="/v2/logistics/invoice-analytics"
        />
      </div>

      <div className="flex-1 w-full max-w-[1500px] mx-auto px-4 py-6 space-y-6">
        <h1 className="text-xl font-semibold text-text">Invoice Analytics</h1>

        <div role="tablist" className="no-print flex gap-1 border-b border-[var(--card-border)]">
          {(["upload", "history", "financials"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`px-4 min-h-[44px] text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t
                  ? "border-[var(--brand)] text-text"
                  : "border-transparent text-muted hover:text-text"
              }`}
            >
              {t === "upload" ? "Upload" : t === "history" ? "History" : "Financials"}
            </button>
          ))}
        </div>

        {tab === "upload" && (
          <>
            <section className="no-print">
              <label
                htmlFor="invoice-pdf-input"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  handleFile(e.dataTransfer.files?.[0]);
                }}
                className={`flex flex-col items-center justify-center gap-2 min-h-[96px] rounded-lg border-2 border-dashed ${
                  dragActive ? "border-[var(--brand)]" : "border-[var(--input-border)]"
                } bg-[var(--surface-2)] text-center px-4 py-6 cursor-pointer hover:border-[var(--brand)] transition-colors`}
              >
                <FileUp size={22} className="text-muted" aria-hidden="true" />
                <span className="text-sm font-medium text-text">
                  {stage === "parsing"
                    ? "Parsing invoice…"
                    : stage === "submitting"
                      ? `Resolving mileage for ${parsed?.lines.length ?? 0} line${parsed?.lines.length === 1 ? "" : "s"} — first upload can take a while…`
                      : filename
                        ? `Loaded: ${filename} — drop another to replace`
                        : "Drop a freight invoice PDF here, or click to browse"}
                </span>
                <input
                  ref={fileInputRef}
                  id="invoice-pdf-input"
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  disabled={isBusy}
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
              </label>
              {isBusy && (
                <div className="mt-2 h-1 w-full overflow-hidden rounded bg-[var(--surface-2)]">
                  <div className="h-full w-1/3 animate-pulse bg-[var(--brand)]" />
                </div>
              )}
            </section>

            {error && (
              <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3">
                {error}
              </div>
            )}

            {result && (
              <>
                <InvoiceResultToolbar result={result} label={result.invoice.invoiceNumber} />
                {unresolvedLines.length > 0 && (
                  <div className="no-print flex items-center justify-between gap-2 rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3">
                    <span>
                      {unresolvedLines.length} line{unresolvedLines.length === 1 ? "" : "s"} need a BOL # and
                      address to be included in the report.
                    </span>
                    <button
                      type="button"
                      onClick={() => setResolveOpen(true)}
                      className="min-h-[44px] px-4 rounded-md border border-[var(--warn-border)] bg-surface text-text text-sm font-medium hover:bg-[var(--surface-2)] shrink-0 cursor-pointer"
                    >
                      Resolve
                    </button>
                  </div>
                )}
                <div className="invoice-print-region space-y-6">
                  <MatchRateBanner summary={result.summary} vendor={result.invoice.vendor} invoiceNumber={result.invoice.invoiceNumber} />
                  <SummaryCards summary={result.summary} />
                  <LineTable lines={result.lines} />
                  <FlagsPanels flags={result.flags} />
                </div>
                <ResolveUnmatchedModal
                  isOpen={resolveOpen}
                  onClose={() => setResolveOpen(false)}
                  lines={unresolvedLines.map(
                    (l): UnresolvedLine => ({
                      invoiceNumber: result.invoice.invoiceNumber,
                      lineNo: l.lineNo,
                      shipDate: l.shipDate,
                      loadNumber: l.loadNumber,
                      poText: l.poText,
                      amount: l.amount,
                      bolNumbers: l.bolNumbers,
                      note: l.note,
                    })
                  )}
                  onResolved={(body) => setResult(body)}
                />
              </>
            )}

            {duplicateInfo && (
              <Modal isOpen onClose={() => setDuplicateInfo(null)} title="Invoice already stored" size="md">
                <p className="text-sm text-text">
                  Invoice {duplicateInfo.invoiceNumber} ({duplicateInfo.vendor || "unknown vendor"}
                  {duplicateInfo.invoiceDate ? `, ${duplicateInfo.invoiceDate.slice(0, 7)}` : ""}) is already
                  stored — {duplicateInfo.existingLineCount} line{duplicateInfo.existingLineCount === 1 ? "" : "s"},{" "}
                  {money(duplicateInfo.existingTotalAmount ?? 0)}, last ingested{" "}
                  {duplicateInfo.existingIngestedAt ? new Date(duplicateInfo.existingIngestedAt).toLocaleString() : "an unknown time"}.
                  Replacing deletes the stored copy and re-ingests this upload ({duplicateInfo.incomingLineCount} line
                  {duplicateInfo.incomingLineCount === 1 ? "" : "s"}).
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setDuplicateInfo(null)}
                    className="min-h-[44px] px-4 rounded-md border border-[var(--card-border)] text-sm font-medium text-text hover:bg-[var(--surface-2)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDuplicateInfo(null);
                      if (parsed) submit(parsed, true);
                    }}
                    className="min-h-[44px] px-4 rounded-md bg-[var(--brand)] text-white text-sm font-medium hover:bg-[var(--brand-hover)]"
                  >
                    Replace
                  </button>
                </div>
              </Modal>
            )}
          </>
        )}

        {tab === "history" && <HistoryPanel />}

        {tab === "financials" && <FinancialsPanel />}
      </div>
    </div>
  );
}

function MatchRateBanner({
  summary,
  vendor,
  invoiceNumber,
}: {
  summary: InvoiceResult["summary"];
  vendor: string;
  invoiceNumber: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--surface-2)] px-4 py-3">
      <div className="text-xs text-muted mb-1">
        {vendor || "Invoice"} #{invoiceNumber}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold">
        <span className="text-[var(--success-ink)]">
          {summary.matchedCount} / {summary.lineCount} matched
        </span>
        <span className="text-[var(--warn-text)]">{summary.unmatchedCount} unmatched</span>
        <span className="text-[var(--info-text)]">{summary.multiDestCount} multi-destination</span>
      </div>
    </div>
  );
}

function SummaryCards({ summary }: { summary: InvoiceResult["summary"] }) {
  const cards = [
    { label: "Total amount", value: money(summary.totalAmount) },
    { label: "Avg miles (matched)", value: summary.avgMiles ? miles(summary.avgMiles) : "—" },
    { label: "Avg price (matched)", value: summary.avgPrice ? money(summary.avgPrice) : "—" },
    { label: "Avg $/mile (matched)", value: summary.avgPricePerMile ? `$${summary.avgPricePerMile.toFixed(2)}/mi` : "—" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-[var(--card-border)] bg-surface p-3">
          <div className="text-xs text-muted">{c.label}</div>
          <div className="text-lg font-semibold text-text">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function LineTable({ lines }: { lines: ResultLine[] }) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-surface overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-[var(--card-border)]">
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Ship date</th>
            <th className="px-3 py-2">Load #</th>
            <th className="px-3 py-2">PO text</th>
            <th className="px-3 py-2">BOL #</th>
            <th className="px-3 py-2">City/ZIP</th>
            <th className="px-3 py-2">Miles</th>
            <th className="px-3 py-2">Amount</th>
            <th className="px-3 py-2">$/mile</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr
              key={l.lineNo}
              className={`border-b border-[var(--border-light)] last:border-0 ${l.excludedFromStats ? "opacity-60" : ""}`}
              title={l.note ?? undefined}
            >
              <td className="px-3 py-2 text-muted">{l.lineNo}</td>
              <td className="px-3 py-2 whitespace-nowrap">{l.shipDate ?? "—"}</td>
              <td className="px-3 py-2 whitespace-nowrap font-mono">{l.loadNumber ?? "—"}</td>
              <td className="px-3 py-2 max-w-[220px] truncate" title={l.poText}>
                {l.poText || "—"}
              </td>
              <td className="px-3 py-2 whitespace-nowrap font-mono">{l.bolNumbers.join(", ") || "—"}</td>
              <td className="px-3 py-2 whitespace-nowrap">{l.shipTo ? `${l.shipTo.city}, ${l.shipTo.state} ${l.shipTo.zip}` : "—"}</td>
              <td className="px-3 py-2 whitespace-nowrap">{l.miles != null ? miles(l.miles) : "mileage unavailable"}</td>
              <td className="px-3 py-2 whitespace-nowrap">{money(l.amount)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{l.pricePerMile != null ? `$${l.pricePerMile.toFixed(2)}` : "—"}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[l.matchStatus]}`}>
                  {STATUS_LABEL[l.matchStatus]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FlagsPanels({ flags }: { flags: InvoiceResult["flags"] }) {
  const [drillZip, setDrillZip] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="rounded-lg border border-[var(--card-border)] bg-surface p-4">
        <div className="flex items-center gap-1 mb-3">
          <h2 className="text-sm font-semibold text-text">Same-ZIP price variance</h2>
          <InfoTip label="ZIP codes where different orders were billed different amounts. Different delivery sites can share a ZIP, so a spread isn't always a mispricing — open a row to see the orders." />
        </div>
        {flags.zipVariance.length === 0 ? (
          <p className="text-sm text-muted">No variance flagged.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {flags.zipVariance.map((z) => (
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
                  {money(z.minPrice)}–{money(z.maxPrice)} · spread {money(z.spread)} · avg {miles(z.avgMiles)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-[var(--card-border)] bg-surface p-4">
        <div className="flex items-center gap-1 mb-3">
          <h2 className="text-sm font-semibold text-text">Distance/price inversions</h2>
          <InfoTip label="Lanes where a nearer ZIP (fewer miles) was billed as much as or more than a farther ZIP — a possible overcharge to review." />
        </div>
        {flags.inversions.length === 0 ? (
          <p className="text-sm text-muted">No inversions flagged.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {flags.inversions.map((inv, i) => (
              <li key={i} className="border-b border-[var(--border-light)] last:border-0 pb-2 last:pb-0">
                <span className="font-medium text-text">
                  {inv.nearerZip} ({miles(inv.nearerMiles)}, {money(inv.nearerAvgPrice)})
                </span>{" "}
                <span className="text-muted">vs</span>{" "}
                <span className="font-medium text-text">
                  {inv.fartherZip} ({miles(inv.fartherMiles)}, {money(inv.fartherAvgPrice)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ZipLinesModal zip={drillZip} onClose={() => setDrillZip(null)} />
    </div>
  );
}

function HistoryPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<MonthResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const requestIdRef = useRef(0);

  function loadMonth(month?: string) {
    const id = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    const url = month ? `/v2/api/logistics/month?month=${encodeURIComponent(month)}` : "/v2/api/logistics/month";
    fetch(url)
      .then(async (res) => {
        const body: MonthResponse = await res.json();
        if (requestIdRef.current !== id) return; // superseded by a newer selector change
        if (!res.ok || !body.ok) {
          setError(body?.error || "Could not load invoice history.");
          return;
        }
        setPayload(body);
        setSelected(body.month);
      })
      .catch((e: any) => {
        if (requestIdRef.current !== id) return;
        setError(e?.message || "Could not reach the server.");
      })
      .finally(() => {
        if (requestIdRef.current === id) setLoading(false);
      });
  }

  useEffect(() => {
    loadMonth();
  }, []);

  if (!payload && loading) return <p className="text-sm text-muted">Loading history…</p>;
  if (!payload && error) return <p className="text-sm text-[var(--warn-text)]">{error}</p>;
  if (!payload) return null;

  if (payload.months.length === 0) {
    return <p className="text-sm text-muted">No invoices ingested yet.</p>;
  }

  const unresolvedLines = payload.result ? payload.result.lines.filter((l) => l.excludedFromStats) : [];

  return (
    <div className="space-y-6">
      <div className="no-print flex items-center gap-2">
        <label htmlFor="history-month" className="text-sm font-medium text-text">
          Month
        </label>
        <select
          id="history-month"
          value={selected ?? payload.month ?? ""}
          onChange={(e) => {
            setSelected(e.target.value);
            loadMonth(e.target.value);
          }}
          disabled={loading}
          className="min-h-[44px] rounded-md border border-[var(--input-border)] bg-surface text-text text-sm px-3"
        >
          {payload.months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {loading && <span className="text-xs text-muted">Loading…</span>}
      </div>

      {error && <p className="text-sm text-[var(--warn-text)]">{error}</p>}

      {payload.result && (
        <>
          <InvoiceResultToolbar
            result={payload.result}
            label={payload.month ?? ""}
            showAnnual
            year={(payload.month ?? "").slice(0, 4)}
          />
          {unresolvedLines.length > 0 && (
            <div className="no-print flex items-center justify-between gap-2 rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3">
              <span>
                {unresolvedLines.length} line{unresolvedLines.length === 1 ? "" : "s"} need a BOL # and
                address to be included in the report.
              </span>
              <button
                type="button"
                onClick={() => setResolveOpen(true)}
                className="min-h-[44px] px-4 rounded-md border border-[var(--warn-border)] bg-surface text-text text-sm font-medium hover:bg-[var(--surface-2)] shrink-0 cursor-pointer"
              >
                Resolve
              </button>
            </div>
          )}
          <div className="invoice-print-region space-y-6">
            <MatchRateBanner
              summary={payload.result.summary}
              vendor={payload.result.invoice.vendor}
              invoiceNumber={payload.result.invoice.invoiceNumber}
            />
            <SummaryCards summary={payload.result.summary} />
            <LineTable lines={payload.result.lines} />
            <FlagsPanels flags={payload.result.flags} />
          </div>
          <ResolveUnmatchedModal
            isOpen={resolveOpen}
            onClose={() => setResolveOpen(false)}
            lines={unresolvedLines.map(
              (l): UnresolvedLine => ({
                invoiceNumber: l.invoiceNumber ?? payload.result!.invoice.invoiceNumber,
                lineNo: l.lineNo,
                shipDate: l.shipDate,
                loadNumber: l.loadNumber,
                poText: l.poText,
                amount: l.amount,
                bolNumbers: l.bolNumbers,
                note: l.note,
              })
            )}
            onResolved={() => loadMonth(selected ?? payload.month ?? undefined)}
          />
        </>
      )}
    </div>
  );
}
