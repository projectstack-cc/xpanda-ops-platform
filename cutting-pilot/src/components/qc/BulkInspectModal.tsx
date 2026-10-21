"use client";
// src/components/qc/BulkInspectModal.tsx — qc-06
// Admin-only "Mark parts inspected" on /v2/qc. Lists the board's loaded week by ship day with each
// order's plan (planBulkInspection — the same rule the server re-runs): lines with no current
// inspection, a whole quantity and readable L/W/H are recorded as Passed at nominal; the rest are
// skipped. Orders with something to record start checked. Submit POSTs the job ids to
// /v2/api/qc/inspections/bulk (the server rebuilds the plan), then shows what was recorded and which
// lines still need a manual inspection. Records and PDFs are indistinguishable from a manual
// inspection, so no visible text here says otherwise. Composes the shared Modal (xl).
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import Modal from "@/components/Modal";
import DayGroupHeader from "@/components/dashboard/DayGroupHeader";
import {
  BULK_SKIP_LABELS,
  DEFAULT_TOLERANCE,
  TOLERANCES,
  groupByShipDay,
  planBulkInspection,
  type BulkLinePlan,
  type BulkSkipReason,
  type QcOrder,
} from "@/lib/qc/board";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  orders: QcOrder[];
  // Called once after a successful submit, when the modal closes — the board refetches.
  onDone: () => void;
}

interface BulkResult {
  created: number;
  drive_eta_minutes: number;
  orders: { job_id: string; invoice_number: string; created: number; skipped: { line_item_id: string; description: string; reason: BulkSkipReason }[] }[];
  failed: { job_id: string; invoice_number: string; error: string }[];
}

const SUBMIT_TIMEOUT_MS = 60_000;
const LABEL = "block text-xs font-semibold text-muted";
const INPUT =
  "w-full min-h-[44px] px-3 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50";
const GHOST =
  "inline-flex items-center justify-center min-h-[44px] px-3 rounded-lg border border-[var(--border)] bg-surface text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
const PRIMARY =
  "inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed";

function num(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? String(+n.toFixed(4)) : "—";
}

function recordCount(plan: BulkLinePlan[]): number {
  return plan.filter((p) => p.action === "record").length;
}

function planSummary(plan: BulkLinePlan[]): string {
  const r = recordCount(plan);
  const i = plan.filter((p) => p.reason === "already_inspected").length;
  const k = plan.length - r - i;
  return `${r} to record · ${i} already inspected · ${k} need manual`;
}

function LinePlan({ p }: { p: BulkLinePlan }) {
  const warn = p.reason === "no_dimensions" || p.reason === "no_quantity";
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 border-b border-[var(--line)] last:border-b-0">
      <span className="text-sm text-text min-w-0 break-words">{p.description || "—"}</span>
      {p.action === "record" && p.nominal ? (
        <span className="text-xs text-muted font-mono tabular-nums">
          lot {p.lot} · {p.sampleSize} samples · {p.nominal.taper ?? num(p.nominal.height)} x {num(p.nominal.width)} x {num(p.nominal.length)}
        </span>
      ) : (
        <span className={`text-xs ${warn ? "font-semibold text-[var(--warn-text)]" : "text-muted"}`}>
          {p.reason ? BULK_SKIP_LABELS[p.reason] : ""}
        </span>
      )}
    </li>
  );
}

export default function BulkInspectModal({ isOpen, onClose, orders, onDone }: Props) {
  const plans = useMemo(() => new Map(orders.map((o) => [o.job_id, planBulkInspection(o)])), [orders]);
  const groups = useMemo(() => groupByShipDay(orders), [orders]);
  const recordable = useMemo(() => orders.filter((o) => recordCount(plans.get(o.job_id) ?? []) > 0).map((o) => o.job_id), [orders, plans]);

  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  // Fresh state on every open; the default selection is every order with something to record.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setTolerance(DEFAULT_TOLERANCE);
      setSelected(new Set(recordable));
      setExpanded(new Set());
      setBusy(false);
      setError(null);
      setResult(null);
    }
    wasOpen.current = isOpen;
  }, [isOpen, recordable]);

  const total = useMemo(
    () => Array.from(selected).reduce((n, id) => n + recordCount(plans.get(id) ?? []), 0),
    [selected, plans]
  );
  const orderCount = Array.from(selected).filter((id) => recordCount(plans.get(id) ?? []) > 0).length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function close() {
    if (busy) return;
    if (result) onDone();
    onClose();
  }

  async function submit() {
    const jobIds = Array.from(selected).filter((id) => recordCount(plans.get(id) ?? []) > 0);
    if (!jobIds.length || busy) return;
    setBusy(true);
    setError(null);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), SUBMIT_TIMEOUT_MS);
    try {
      const res = await fetch("/v2/api/qc/inspections/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_ids: jobIds, tolerance_in: tolerance }),
        signal: ac.signal,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error || `Couldn't record the inspections (HTTP ${res.status}).`);
        return;
      }
      setResult(json as BulkResult);
    } catch (e) {
      setError(
        (e as any)?.name === "AbortError"
          ? "No answer after 60 s — close this and refresh the board to see what was recorded."
          : "Network error — couldn't reach the server."
      );
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  if (result) {
    const manual = result.orders.flatMap((o) =>
      o.skipped.filter((s) => s.reason !== "already_inspected").map((s) => ({ ...s, invoice_number: o.invoice_number }))
    );
    return (
      <Modal isOpen={isOpen} onClose={close} title="Mark parts inspected" size="xl">
        <div className="space-y-4">
          <p role="status" className="text-sm text-text">
            Recorded <strong className="tabular-nums">{result.created}</strong> {result.created === 1 ? "inspection" : "inspections"}.
            {result.created > 0 && <> PDFs will file to Drive over the next ~{result.drive_eta_minutes} minutes.</>}
          </p>

          {manual.length > 0 && (
            <section aria-labelledby="bulk-manual-h" className="space-y-2">
              <h3 id="bulk-manual-h" className="text-sm font-semibold text-text">
                Still need a manual inspection ({manual.length})
              </h3>
              <ul className="rounded-lg border border-[var(--card-border)] px-3">
                {manual.map((m) => (
                  <li key={m.line_item_id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 border-b border-[var(--line)] last:border-b-0">
                    <span className="text-sm text-text min-w-0 break-words">
                      <span className="font-mono font-semibold">INV {m.invoice_number || "—"}</span> · {m.description || "—"}
                    </span>
                    <span className="text-xs font-semibold text-[var(--warn-text)]">{BULK_SKIP_LABELS[m.reason]}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.failed.length > 0 && (
            <section role="alert" className="space-y-1 text-[var(--danger-ink)]">
              <h3 className="text-sm font-semibold">Not recorded ({result.failed.length})</h3>
              <ul className="text-sm space-y-0.5">
                {result.failed.map((f) => (
                  <li key={f.job_id}>
                    <span className="font-mono font-semibold">INV {f.invoice_number || "—"}</span> — {f.error}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex justify-end">
            <button type="button" onClick={close} className={PRIMARY}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={close} title="Mark parts inspected" size="xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-56">
            <label htmlFor="bulk-tolerance" className={LABEL}>
              Tolerance
            </label>
            <select
              id="bulk-tolerance"
              className={`${INPUT} cursor-pointer mt-1`}
              value={tolerance}
              disabled={busy}
              onChange={(e) => setTolerance(Number(e.target.value))}
            >
              {TOLERANCES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={GHOST} disabled={busy || !recordable.length} onClick={() => setSelected(new Set(recordable))}>
              Select all with open parts
            </button>
            <button type="button" className={GHOST} disabled={busy || selected.size === 0} onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        </div>

        {orders.length === 0 ? (
          <p className="text-sm text-muted">No orders on the board this week.</p>
        ) : (
          <div className="space-y-4">
            {groups.map(({ dateKey, orders: dayOrders }) => (
              <div key={dateKey} className="space-y-2">
                <DayGroupHeader dateKey={dateKey} count={dayOrders.length} noun={["order", "orders"]} />
                <ul className="rounded-xl border border-[var(--card-border)] bg-surface">
                  {dayOrders.map((o) => {
                    const plan = plans.get(o.job_id) ?? [];
                    const canRecord = recordCount(plan) > 0;
                    const checked = canRecord && selected.has(o.job_id);
                    const open = expanded.has(o.job_id);
                    const cbId = `bulk-o-${o.job_id}`;
                    return (
                      <li key={o.job_id} className="border-b border-[var(--line)] last:border-b-0">
                        <div className="flex items-stretch">
                          <label
                            htmlFor={cbId}
                            className={`flex flex-1 min-w-0 items-center gap-3 min-h-[44px] px-3 py-2 ${canRecord && !busy ? "cursor-pointer hover:bg-[var(--ghost-bg)]" : "opacity-60 cursor-not-allowed"}`}
                          >
                            <input
                              id={cbId}
                              type="checkbox"
                              className="h-5 w-5 shrink-0 accent-[var(--brand)]"
                              checked={checked}
                              disabled={!canRecord || busy}
                              onChange={() => toggle(o.job_id)}
                            />
                            <span className="min-w-0">
                              <span className="block text-sm text-text break-words">
                                <span className="font-mono font-semibold">{o.invoice_number || "—"}</span> · {o.customer || "—"}
                              </span>
                              <span className="block text-xs text-muted">{canRecord ? planSummary(plan) : "Nothing to record"}</span>
                            </span>
                          </label>
                          <button
                            type="button"
                            onClick={() => toggleExpanded(o.job_id)}
                            aria-expanded={open}
                            aria-label={`${open ? "Hide" : "Show"} parts for INV ${o.invoice_number || "—"}`}
                            className="flex items-center justify-center min-w-[44px] min-h-[44px] text-muted hover:text-text cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                          >
                            {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                          </button>
                        </div>
                        {open && (
                          <ul className="mx-3 mb-2 px-3 rounded-lg bg-[var(--ghost-bg)]">
                            {plan.map((p) => (
                              <LinePlan key={p.line_item_id} p={p} />
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-[var(--danger-ink)]">
            {error}
          </p>
        )}

        <div className="sticky bottom-0 -mx-6 -mb-6 px-6 py-3 border-t border-[var(--line)] bg-surface flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted" aria-live="polite">
            Will record <strong className="text-text tabular-nums">{total}</strong> {total === 1 ? "inspection" : "inspections"} as Passed on{" "}
            <strong className="text-text tabular-nums">{orderCount}</strong> {orderCount === 1 ? "order" : "orders"}
          </p>
          <div className="flex gap-2 ml-auto">
            <button type="button" className={GHOST} disabled={busy} onClick={close}>
              Cancel
            </button>
            <button type="button" className={PRIMARY} disabled={busy || total === 0} aria-busy={busy} onClick={submit}>
              {busy ? "Recording…" : `Mark ${total} ${total === 1 ? "part" : "parts"} inspected`}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
