// src/components/schedule/OrderRow.tsx
// One reusable order row for each day column on the TV board. Customer +
// INV# + status badge are always visible; every other field is trimmed progressively as
// density tightens (compact drops delivery time/location/method/carrier, minimal also drops
// load count + the scrap icon) — trimming fields is preferred over shrinking text below the
// legibility floor.
import { Link2, Recycle } from "lucide-react";
import type { ScheduleBoardRow } from "@/types/schedule";
import StatusBadge from "./StatusBadge";
import type { Density } from "./density";
import { formatLoadLabel } from "@/lib/truckType";
import { SHOW_STATUS_BADGES } from "./flags";

interface OrderRowProps {
  row: ScheduleBoardRow;
  density: Density;
  // True when this row belongs to a trailer_group_id but none of its groupmates are visible in
  // this same day column (DayColumn computes this — the group is split across days, not just
  // clipped: DayColumn never partially clips a group). A rail can't span two day columns, so
  // this renders a link chip instead, on the row's always-present first line so it survives
  // every density tier without adding a line of height.
  orphanedGroup?: boolean;
  // True only for the last row actually rendered in the column. Grouped rows sit inside their
  // own wrapper div now (for the rail border), so a plain `last:` CSS selector would scope to
  // that wrapper and drop the border under the last member of every group, not just the column's
  // true last row. DayColumn computes this explicitly instead.
  isLastInColumn?: boolean;
}

// Single definition shared by customer name and INV# so they read as one visual tier — a
// later change to one moves both. font-mono/tabular-nums stacks on top for the invoice
// number since it's numeric data, without touching the shared size/weight/color.
const PRIMARY_LABEL_CLS = "text-[clamp(0.6875rem,1vh,0.8rem)] font-medium text-text";

function isScrapYes(scrapPickup: string | null): boolean {
  return (scrapPickup ?? "").trim().toUpperCase().startsWith("Y");
}

export default function OrderRow({ row, density, orphanedGroup, isLastInColumn }: OrderRowProps) {
  const showTiming = density === "full";
  const showMethodCarrier = density === "full";
  const showLoadCount = density !== "minimal";
  const showScrapIcon = density !== "minimal";
  const scrapYes = showScrapIcon && isScrapYes(row.scrap_pickup);
  const loadLabel = formatLoadLabel(row.method, row.load_count);
  // Unmatched rows keep their flag regardless of the badge flag — it's the operator's only
  // signal that a sheet row has no platform job, not a derived production status.
  const showBadge = SHOW_STATUS_BADGES || row.unmatched;
  const showSecondLine = showBadge || scrapYes || (showLoadCount && !!loadLabel);

  return (
    <div
      className={[
        "px-1.5",
        isLastInColumn ? "" : "border-b border-[var(--border-light)]",
        density === "full" ? "py-1" : "py-0.5",
        row.unmatched ? "opacity-60 grayscale-[30%]" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-1 min-w-0">
        <span className={`truncate ${PRIMARY_LABEL_CLS}`}>{row.customer || "—"}</span>
        <span className="shrink-0 flex items-center gap-0.5">
          {orphanedGroup && (
            <Link2
              size={10}
              className="shrink-0 text-[var(--brand)]"
              aria-label="Linked to a job on another day"
            />
          )}
          <span className={`font-mono tabular-nums ${PRIMARY_LABEL_CLS}`}>
            #{row.invoice_number}
          </span>
        </span>
      </div>

      {showSecondLine && (
        <div className="flex items-center justify-between gap-1 mt-0.5 min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            {showBadge && (
              <StatusBadge status={row.status} unmatched={row.unmatched} sheetStatus={row.sheet_status} />
            )}
            {scrapYes && (
              <Recycle size={11} className="shrink-0 text-[var(--warn-text)]" aria-label="Scrap pickup" />
            )}
          </div>
          {showLoadCount && loadLabel && (
            <span className="shrink-0 font-mono tabular-nums text-[10px] text-text-hint">
              {loadLabel}
            </span>
          )}
        </div>
      )}

      {showTiming && (row.delivery_time || row.location) && (
        <div className="mt-0.5 text-[10px] text-text-faint truncate">
          {[row.delivery_time, row.location].filter(Boolean).join(" · ")}
        </div>
      )}

      {showMethodCarrier && (row.method || row.carrier) && (
        <div className="text-[10px] text-text-faint truncate">
          {[row.method, row.carrier].filter(Boolean).join(" / ")}
        </div>
      )}
    </div>
  );
}
