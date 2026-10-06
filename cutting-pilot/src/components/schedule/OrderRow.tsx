// src/components/schedule/OrderRow.tsx
// One reusable order row for each day column on the TV board. Every field is always shown —
// customer, INV#, chunks, status badge (+ progress / loads), shifts, scrap, and the load label.
// sched-dual-01: a job cut and loaded at once shows two pills — cutting first, then loading.
// Rows are a single roomy size (no density tiering): the board no longer sheds fields to fit, it
// scrolls (AutoScrollColumn). Delivery time/location and method/carrier remain pulled for
// matching/sorting (P313); the delivery time rides after the load label on line 2, e.g. "TL x1 @ 7a" (P424/P426).
import { Link2, Recycle } from "lucide-react";
import type { ScheduleBoardRow } from "@/types/schedule";
import StatusBadge from "./StatusBadge";
import { formatLoadLabel } from "@/lib/truckType";
import { parseDeliveryTime } from "@/lib/deliveryTime";
import { SHOW_STATUS_BADGES } from "./flags";

interface OrderRowProps {
  row: ScheduleBoardRow;
  // True when this row belongs to a trailer_group_id but none of its groupmates are in this same
  // day column (group split across days). A rail can't span columns, so a link chip renders on the
  // always-present first line instead.
  orphanedGroup?: boolean;
  // Row rendered inside a linked-group wrapper: the wrapper draws the group's top/bottom brackets,
  // so members must NOT draw their own bottom divider (would double the line / re-fragment the
  // group). Ungrouped rows always draw a bottom divider so the scroll loop seam stays uniform.
  inGroup?: boolean;
  // Desk board only: when provided AND the row has a linked job, the row becomes clickable and calls
  // this with the job_id (opens the read-only detail modal). Omitted on the TV board → not clickable,
  // behavior unchanged.
  onSelect?: (jobId: string) => void;
  // Desk board only (sched-mobile-01): roomier row below `sm` (phone portrait), with a 44px minimum tap
  // height and larger text. `sm:` restores the dense desk sizing. Omitted on the TV board, so classes
  // are unchanged.
  interactive?: boolean;
}

// Shared by customer name + INV# so they read as one visual tier.
const PRIMARY_LABEL_CLS = "text-[clamp(0.6875rem,1vh,0.8rem)] font-medium text-text";
// Desk variant (sched-mobile-01): readable on a phone, identical to PRIMARY_LABEL_CLS at `sm` and up.
const PRIMARY_LABEL_CLS_DESK = "text-[0.9375rem] sm:text-[clamp(0.6875rem,1vh,0.8rem)] font-medium text-text";

const SHIFT_LABELS: Record<string, string> = { "1st": "1st", "2nd": "2nd", "3rd": "3rd" };

function isScrapYes(scrapPickup: string | null): boolean {
  return (scrapPickup ?? "").trim().toUpperCase().startsWith("Y");
}

export default function OrderRow({ row, orphanedGroup, inGroup, onSelect, interactive }: OrderRowProps) {
  const primaryCls = interactive ? PRIMARY_LABEL_CLS_DESK : PRIMARY_LABEL_CLS;
  const smallText = interactive ? "text-xs sm:text-[10px]" : "text-[10px]";
  const clickable = !!onSelect && !!row.job_id;
  const scrapYes = isScrapYes(row.scrap_pickup);
  const loadLabel = formatLoadLabel(row.method, row.load_count);
  const deliveryTime = parseDeliveryTime(row.delivery_time);
  // Load label + delivery time share the right slot on line 2, e.g. "TL x1 @ 7a" (P426 — moved from
  // the P424 leading column). Either part may be absent.
  const loadTimeLabel = [loadLabel, deliveryTime ? `@ ${deliveryTime}` : null].filter(Boolean).join(" ");
  // Unmatched rows always show their flag (operator's only "no platform job" signal), regardless
  // of the status-badge feature flag.
  const showBadge = SHOW_STATUS_BADGES || row.unmatched;
  const showSecondLine = showBadge || scrapYes || !!loadTimeLabel;

  return (
    <div
      className={[
        interactive ? "px-3 py-2.5 min-h-[44px] sm:px-1.5 sm:py-1 sm:min-h-0" : "px-1.5 py-1",
        inGroup ? "" : "border-b border-[var(--border-light)]",
        row.unmatched ? "opacity-60 grayscale-[30%]" : "",
        clickable ? "cursor-pointer hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]" : "",
      ].join(" ")}
      {...(clickable
        ? {
            role: "button" as const,
            tabIndex: 0,
            onClick: () => onSelect!(row.job_id!),
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect!(row.job_id!);
              }
            },
          }
        : {})}
    >
      <div className="flex items-center justify-between gap-1 min-w-0">
        <span className={`truncate ${primaryCls}`}>{row.customer || "—"}</span>
        <span className="shrink-0 flex items-center gap-0.5">
          {orphanedGroup && (
            <Link2 size={10} className="shrink-0 text-[var(--brand)]" aria-label="Linked to a job on another day" />
          )}
          {row.chunks_required != null && (
            <span
              className={`shrink-0 rounded px-1 ${smallText} leading-tight font-semibold tabular-nums bg-[var(--ghost-bg)] text-[var(--text-hint)] border border-[var(--border)]`}
              title="Chunks required"
            >
              {row.chunks_required}c
            </span>
          )}
          <span className={`font-mono tabular-nums ${primaryCls}`}>#{row.invoice_number}</span>
        </span>
      </div>

      {showSecondLine && (
        <div className="flex items-center justify-between gap-1 mt-0.5 min-w-0">
          {/* sched-dual-01: flex-wrap so dual pills + shift chips wrap, not clip, in a narrow TV column. */}
          <div className="flex flex-wrap items-center gap-1 min-w-0">
            {showBadge && (
              <>
                {!row.unmatched && row.cutting_status && (
                  <StatusBadge status={row.cutting_status} unmatched={false} sheetStatus={null} progressPct={row.cutting_pct} />
                )}
                <StatusBadge
                  status={row.status}
                  unmatched={row.unmatched}
                  sheetStatus={row.sheet_status}
                  progressPct={row.progress_pct}
                  loadsDone={row.loads_done}
                  loadsTotal={row.loads_total}
                />
              </>
            )}
            {row.shifts.length > 0 && row.shifts.map((s) => (
              <span
                key={s}
                className={`inline-flex items-center px-1.5 py-0.5 rounded ${smallText} font-medium bg-slate-200 text-slate-700 shrink-0`}
              >
                {SHIFT_LABELS[s] ?? s}
              </span>
            ))}
            {scrapYes && (
              <Recycle size={11} className="shrink-0 text-[var(--warn-text)]" aria-label="Scrap pickup" />
            )}
          </div>
          {loadTimeLabel && (
            <span
              className={`shrink-0 font-mono tabular-nums ${smallText} text-text-hint`}
              title={row.delivery_time ?? undefined}
            >
              {loadTimeLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
