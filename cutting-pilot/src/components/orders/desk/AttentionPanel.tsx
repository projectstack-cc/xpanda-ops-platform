"use client";
// src/components/orders/desk/AttentionPanel.tsx — ord-dash-02
// "Needs attention" for /v2/orders/desk: the desk API's attention[] grouped by rule (RULE_ORDER,
// empty groups hidden). A job item opens the read-only OrderDetailModal (onOpenJob); a schedule gap
// has no job, so it offers "+ New order" with its invoice # prefilled (onNewOrder). All clear → a
// designed empty state. Labels live in lib/orders/deskLabels.ts (shared with ord-dash-03).
import { forwardRef } from "react";
import { CircleCheck, ChevronRight, Plus } from "lucide-react";
import type { AttentionItem, AttentionRule } from "@/types/ordersDesk";
import { RULE_LABELS, RULE_ORDER, deskShipDay, ruleDetail } from "@/lib/orders/deskLabels";

interface AttentionPanelProps {
  items: AttentionItem[];
  onOpenJob: (jobId: string) => void;
  onNewOrder: (invoice: string) => void;
}

const CARD = "bg-surface border border-[var(--card-border)] rounded";

function ItemText({ item }: { item: AttentionItem }) {
  const detail = ruleDetail(item.rule, item.detail);
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-baseline gap-2 min-w-0">
        <span className="font-mono tabular-nums text-sm font-semibold text-text shrink-0">
          {item.invoice_number ? `#${item.invoice_number}` : "No invoice #"}
        </span>
        <span className="text-sm text-text truncate">{item.customer || "No customer"}</span>
      </span>
      <span className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-xs text-muted">
        <span className="font-mono tabular-nums">Ship {deskShipDay(item.ship_date)}</span>
        {detail && <span className="font-mono tabular-nums">{detail}</span>}
      </span>
    </span>
  );
}

const AttentionPanel = forwardRef<HTMLElement, AttentionPanelProps>(function AttentionPanel(
  { items, onOpenJob, onNewOrder },
  ref
) {
  const groups = RULE_ORDER.map((rule) => ({ rule, rows: items.filter((i) => i.rule === rule) })).filter(
    (g) => g.rows.length > 0
  );
  const orderCount =
    new Set(items.filter((i) => i.job_id).map((i) => i.job_id)).size + items.filter((i) => !i.job_id).length;

  return (
    <section ref={ref} aria-labelledby="desk-attention-title" className={`${CARD} scroll-mt-4`}>
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--card-border)]">
        <h2 id="desk-attention-title" className="text-sm font-bold text-text">
          Needs attention
        </h2>
        {/* Same figure as the KPI: distinct jobs + schedule gaps (a job can sit in several groups). */}
        <span className="text-xs text-muted">
          <strong className="text-text font-mono tabular-nums">{orderCount}</strong> {orderCount === 1 ? "order" : "orders"}
        </span>
      </div>

      {groups.length === 0 ? (
        <div className="px-4 py-8 flex items-start gap-3">
          <CircleCheck size={20} className="text-[var(--success-ink)] shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-text">Nothing needs attention</p>
            <p className="mt-1 text-xs text-muted">
              Every open order has a ship date, cutting lines, dimensions and a checked address, and everything on the
              schedule sheet has been entered.
            </p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-[var(--card-border)]">
          {groups.map(({ rule, rows }) => (
            <Group key={rule} rule={rule} rows={rows} onOpenJob={onOpenJob} onNewOrder={onNewOrder} />
          ))}
        </div>
      )}
    </section>
  );
});

function Group({
  rule,
  rows,
  onOpenJob,
  onNewOrder,
}: {
  rule: AttentionRule;
  rows: AttentionItem[];
  onOpenJob: (jobId: string) => void;
  onNewOrder: (invoice: string) => void;
}) {
  const headingId = `desk-attn-${rule}`;
  return (
    <div role="group" aria-labelledby={headingId} className="py-2">
      <div className="flex items-center justify-between gap-2 px-4 py-1.5">
        <h3 id={headingId} className="text-xs font-semibold uppercase tracking-wider text-muted">
          {RULE_LABELS[rule].label}
        </h3>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold font-mono tabular-nums bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)]">
          {rows.length}
        </span>
      </div>
      <ul>
        {rows.map((item, i) => (
          <li key={`${item.job_id ?? item.invoice_number ?? "gap"}-${i}`}>
            {item.job_id ? (
              <button
                type="button"
                onClick={() => onOpenJob(item.job_id!)}
                className="w-full min-h-[44px] flex items-center gap-2 px-4 py-2 text-left cursor-pointer hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
              >
                <ItemText item={item} />
                <ChevronRight size={16} className="text-muted shrink-0" aria-hidden="true" />
              </button>
            ) : (
              <div className="min-h-[44px] flex items-center gap-2 px-4 py-2">
                <ItemText item={item} />
                <button
                  type="button"
                  onClick={() => onNewOrder(item.invoice_number ?? "")}
                  aria-label={`New order for invoice ${item.invoice_number ?? ""}`}
                  className="shrink-0 min-h-[44px] px-3 inline-flex items-center gap-1 rounded-md border border-[var(--input-border)] text-xs font-semibold text-text cursor-pointer hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <Plus size={14} aria-hidden="true" />
                  New order
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default AttentionPanel;
