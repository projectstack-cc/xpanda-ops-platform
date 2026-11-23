"use client";
// src/components/orders/desk/RecentOrders.tsx — ord-dash-02
// Recent intake for /v2/orders/desk: DashboardToolbar (RangeSelector · SearchInput · source
// FilterSelect), rows grouped by created_et_date under DayGroupHeader, newest first. The range is
// owned by OrderDesk (it drives the fetch); search + source filter are client-side, here.
// Row tap → onOpenJob (read-only detail). Edit (only when canEdit) is a SIBLING button, never nested.
import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import type { DeskRecentRow } from "@/types/ordersDesk";
import DashboardToolbar from "@/components/dashboard/DashboardToolbar";
import RangeSelector, { type RangeValue } from "@/components/dashboard/RangeSelector";
import SearchInput from "@/components/dashboard/SearchInput";
import FilterSelect from "@/components/dashboard/FilterSelect";
import DayGroupHeader from "@/components/dashboard/DayGroupHeader";
import { JobStatusBadge } from "@/components/board/badges";
import { RULE_LABELS, SOURCE_OPTIONS, deskShipDay } from "@/lib/orders/deskLabels";

interface RecentOrdersProps {
  rows: DeskRecentRow[] | null;     // null while the first load is in flight
  range: RangeValue;
  today: string;
  onRangeChange: (next: RangeValue) => void;
  canEdit: boolean;
  onOpenJob: (jobId: string) => void;
  onEditJob: (jobId: string) => void;
}

const CARD = "bg-surface border border-[var(--card-border)] rounded";
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

export function filterRecent(rows: DeskRecentRow[], search: string, source: string): DeskRecentRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => {
    if (source && r.source !== source) return false;
    if (!q) return true;
    return (
      (r.invoice_number ?? "").toLowerCase().includes(q) ||
      (r.customer ?? "").toLowerCase().includes(q)
    );
  });
}

export default function RecentOrders({ rows, range, today, onRangeChange, canEdit, onOpenJob, onEditJob }: RecentOrdersProps) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");

  const days = useMemo(() => {
    const list = filterRecent(rows ?? [], search, source);
    const map = new Map<string, DeskRecentRow[]>();
    for (const r of list) {
      const k = r.created_et_date;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  }, [rows, search, source]);

  const filtering = !!search.trim() || !!source;

  return (
    <section aria-labelledby="desk-recent-title" className="space-y-3 min-w-0">
      <h2 id="desk-recent-title" className="sr-only">Recent orders</h2>
      <DashboardToolbar
        left={<RangeSelector value={range} today={today} onChange={onRangeChange} />}
        right={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Invoice # or customer" />
            <FilterSelect value={source} onChange={setSource} options={SOURCE_OPTIONS} allLabel="All sources" />
          </>
        }
      />

      {rows === null ? (
        <SkeletonRows />
      ) : days.length === 0 ? (
        <div className={`${CARD} px-5 py-10 text-sm text-muted`}>
          {filtering && rows.length > 0
            ? `No orders in this range match${search.trim() ? ` “${search.trim()}”` : ""}${source ? ` from ${SOURCE_OPTIONS.find((o) => o.value === source)?.label.toLowerCase()}` : ""}.`
            : "No orders were entered in this range."}
        </div>
      ) : (
        days.map(([day, list]) => (
          <div key={day} className="space-y-1.5">
            <DayGroupHeader dateKey={day} count={list.length} noun={["order", "orders"]} />
            <ul className={`${CARD} divide-y divide-[var(--card-border)]`}>
              {list.map((r) => (
                <Row key={r.id} row={r} canEdit={canEdit} onOpen={() => onOpenJob(r.id)} onEdit={() => onEditJob(r.id)} />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

function Row({ row, canEdit, onOpen, onEdit }: { row: DeskRecentRow; canEdit: boolean; onOpen: () => void; onEdit: () => void }) {
  const lines = row.line_count;
  const loads = row.load_count ?? 1;
  return (
    <li className="flex items-stretch">
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 min-h-[44px] px-3 py-2.5 text-left cursor-pointer hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          <span className="font-mono tabular-nums text-sm font-semibold text-text">
            {row.invoice_number ? `#${row.invoice_number}` : "No invoice #"}
          </span>
          <span className="text-sm text-text truncate max-w-full">{row.customer || "No customer"}</span>
          <JobStatusBadge status={row.status} />
          {row.archived && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--ghost-bg)] text-muted border border-[var(--border)]">
              Archived
            </span>
          )}
          {row.attention.map((rule) => (
            <span
              key={rule}
              role="img"
              aria-label={RULE_LABELS[rule].label}
              title={RULE_LABELS[rule].label}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)]"
            >
              {RULE_LABELS[rule].short}
            </span>
          ))}
        </span>
        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted font-mono tabular-nums">
          <span>Ship {deskShipDay(row.ship_date)}</span>
          <span>{row.total_bdft != null ? `${fmtInt(row.total_bdft)} bdft` : "— bdft"}</span>
          <span>{loads} {loads === 1 ? "load" : "loads"}</span>
          <span>{lines} {lines === 1 ? "line" : "lines"}</span>
        </span>
      </button>
      {canEdit && (
        <div className="flex items-center pr-2 pl-1 border-l border-[var(--card-border)]">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit order ${row.invoice_number ?? ""}`.trim()}
            className="min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold text-text cursor-pointer hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <Pencil size={14} className="text-muted" aria-hidden="true" />
            <span className="hidden sm:inline">Edit</span>
          </button>
        </div>
      )}
    </li>
  );
}

export function SkeletonRows() {
  return (
    <div className={`${CARD} divide-y divide-[var(--card-border)]`} aria-busy="true" aria-label="Loading orders">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="px-3 py-3 space-y-2 animate-pulse motion-reduce:animate-none">
          <div className="h-3.5 w-1/2 rounded bg-[var(--ghost-bg)]" />
          <div className="h-3 w-1/3 rounded bg-[var(--ghost-bg)]" />
        </div>
      ))}
    </div>
  );
}
