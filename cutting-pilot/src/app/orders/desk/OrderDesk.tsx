"use client";
// src/app/orders/desk/OrderDesk.tsx — ord-dash-02
// Orders intake desk (/v2/orders/desk, dark). KPI row (MetricTile ×4) → Needs attention (≈⅓, sticky
// on lg) beside Recent orders (≈⅔); single column on phones, attention above recent.
// Data: GET /v2/api/orders/desk?from&to (contract src/types/ordersDesk.ts). Refetched after every
// overlay close that may have changed data (entry slide-over close/Done, edit save).
// Overlays: ONE union state → only one modal / slide-over is ever open.
//   detail → OrderDetailModal (read-only: no quickEdit, no onViewBol; its cut-list viewer covers printing)
//   edit   → OrderEditModal (boardJobs omitted — see BACKLOG)
//   entry  → OrderEntryForm embedded in SlideOver size="xl"; its success screen stays in the panel.
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import MetricTile from "@/components/dashboard/MetricTile";
import { type RangeValue } from "@/components/dashboard/RangeSelector";
import SlideOver from "@/components/SlideOver";
import OrderEntryForm from "@/components/orders/OrderEntryForm";
import OrderDetailModal from "@/components/board/OrderDetailModal";
import OrderEditModal from "@/components/board/OrderEditModal";
import AttentionPanel from "@/components/orders/desk/AttentionPanel";
import RecentOrders, { SkeletonRows } from "@/components/orders/desk/RecentOrders";
import { etNowWallClock } from "@/lib/etDateTime";
import { presetRange } from "@/lib/reports/range";
import type { DeskResponse } from "@/types/ordersDesk";

interface Props {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

type Overlay =
  | { kind: "none" }
  | { kind: "detail"; id: string }
  | { kind: "edit"; id: string }
  | { kind: "entry"; invoice?: string };

const PRIMARY_BTN =
  "min-h-[44px] px-4 inline-flex items-center gap-2 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

export default function OrderDesk({ userName, isAdmin, permissions }: Props) {
  const [today] = useState(() => etNowWallClock().date);
  const [range, setRange] = useState<RangeValue>(() => ({ preset: "this_week", ...presetRange("this_week", etNowWallClock().date) }));
  const [data, setData] = useState<DeskResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>({ kind: "none" });
  const attentionRef = useRef<HTMLElement>(null);
  const reqId = useRef(0);

  const canEdit = isAdmin || !!permissions.orders?.edit;

  const load = useCallback(async (from: string, to: string) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/orders/desk?from=${from}&to=${to}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (id !== reqId.current) return;
      if (!res.ok || !body?.ok) {
        setError(body?.error || `Couldn't load the order desk (HTTP ${res.status}).`);
      } else {
        setData(body as DeskResponse);
      }
    } catch (e: any) {
      if (id !== reqId.current) return;
      setError(`Network error: ${String(e?.message || e)}`);
    }
    if (id === reqId.current) setLoading(false);
  }, []);

  useEffect(() => {
    load(range.from, range.to);
  }, [load, range.from, range.to]);

  const refetch = useCallback(() => load(range.from, range.to), [load, range.from, range.to]);

  function closeOverlay(refresh: boolean) {
    setOverlay({ kind: "none" });
    if (refresh) refetch();
  }

  const kpis = data?.kpis;
  const attentionCount = kpis ? kpis.attention_jobs + kpis.schedule_gaps : undefined;

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Orders · v2" currentPath="/v2/orders" />

      <main className="flex-1 w-full max-w-screen-2xl mx-auto px-4 py-6 space-y-5 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-text">Order desk</h1>
            <p className="text-xs text-muted">Orders entered, and what still needs fixing before they reach the floor.</p>
          </div>
          <button type="button" className={PRIMARY_BTN} onClick={() => setOverlay({ kind: "entry" })}>
            <Plus size={16} aria-hidden="true" />
            New order
          </button>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            <button type="button" onClick={refetch} className="min-h-[44px] px-3 underline cursor-pointer font-semibold text-xs">
              Retry
            </button>
          </div>
        )}

        {!data && loading ? (
          <DeskSkeleton />
        ) : !data ? null : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricTile label="Entered today" value={kpis!.entered_today} unit={kpis!.entered_today === 1 ? "order" : "orders"} />
              <MetricTile label="Entered this week" value={kpis!.entered_week} unit={kpis!.entered_week === 1 ? "order" : "orders"} />
              <MetricTile label="Board feet this week" value={kpis!.bdft_week.toLocaleString("en-US")} unit="bdft" />
              <MetricTile
                label="Needs attention"
                value={attentionCount}
                caption={attentionCount ? "Show the list" : "All clear"}
                tone={attentionCount ? "warn" : "default"}
                onClick={() => attentionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              />
            </div>

            {loading && (
              <p className="text-xs text-muted inline-flex items-center gap-1.5" aria-live="polite">
                <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Updating…
              </p>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
              <div className="lg:col-span-1 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto min-w-0">
                <AttentionPanel
                  ref={attentionRef}
                  items={data.attention}
                  onOpenJob={(id) => setOverlay({ kind: "detail", id })}
                  onNewOrder={(invoice) => setOverlay({ kind: "entry", invoice })}
                />
              </div>
              <div className={`lg:col-span-2 min-w-0 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
                <RecentOrders
                  rows={data.recent}
                  range={range}
                  today={today}
                  onRangeChange={setRange}
                  canEdit={canEdit}
                  onOpenJob={(id) => setOverlay({ kind: "detail", id })}
                  onEditJob={(id) => setOverlay({ kind: "edit", id })}
                />
              </div>
            </div>
          </>
        )}
      </main>

      <OrderDetailModal jobId={overlay.kind === "detail" ? overlay.id : null} onClose={() => closeOverlay(false)} />
      <OrderEditModal
        jobId={overlay.kind === "edit" ? overlay.id : null}
        onClose={() => closeOverlay(false)}
        onSaved={refetch}
        isAdmin={isAdmin}
        permissions={permissions}
      />
      <SlideOver isOpen={overlay.kind === "entry"} onClose={() => closeOverlay(true)} title="New order" size="xl">
        {overlay.kind === "entry" && (
          <OrderEntryForm
            userName={userName}
            isAdmin={isAdmin}
            permissions={permissions}
            embedded
            initialInvoice={overlay.invoice}
            onDone={() => closeOverlay(true)}
          />
        )}
      </SlideOver>
    </div>
  );
}

function DeskSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading the order desk">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-surface border border-[var(--card-border)] rounded p-4 space-y-2 animate-pulse motion-reduce:animate-none">
            <div className="h-3 w-2/3 rounded bg-[var(--ghost-bg)]" />
            <div className="h-6 w-1/3 rounded bg-[var(--ghost-bg)]" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <SkeletonRows />
        <div className="lg:col-span-2">
          <SkeletonRows />
        </div>
      </div>
    </div>
  );
}
