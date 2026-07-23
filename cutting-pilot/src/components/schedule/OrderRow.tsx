// src/components/schedule/OrderRow.tsx
// One reusable order row for each day column on the TV board. Customer +
// INV# + status badge are always visible; every other field is trimmed progressively as
// density tightens (compact drops delivery time/location/method/carrier, minimal also drops
// load count + the scrap icon) — trimming fields is preferred over shrinking text below the
// legibility floor.
import { Recycle } from "lucide-react";
import type { ScheduleBoardRow } from "@/types/schedule";
import StatusBadge from "./StatusBadge";
import type { Density } from "./density";
import { formatLoadLabel } from "@/lib/truckType";

interface OrderRowProps {
  row: ScheduleBoardRow;
  density: Density;
}

// Single definition shared by customer name and INV# so they read as one visual tier — a
// later change to one moves both. font-mono/tabular-nums stacks on top for the invoice
// number since it's numeric data, without touching the shared size/weight/color.
const PRIMARY_LABEL_CLS = "text-[clamp(0.6875rem,1vh,0.8rem)] font-medium text-text";

function isScrapYes(scrapPickup: string | null): boolean {
  return (scrapPickup ?? "").trim().toUpperCase().startsWith("Y");
}

export default function OrderRow({ row, density }: OrderRowProps) {
  const showTiming = density === "full";
  const showMethodCarrier = density === "full";
  const showLoadCount = density !== "minimal";
  const showScrapIcon = density !== "minimal";
  const scrapYes = showScrapIcon && isScrapYes(row.scrap_pickup);
  const loadLabel = formatLoadLabel(row.method, row.load_count);

  return (
    <div
      className={[
        "px-1.5 border-b border-[var(--border-light)] last:border-b-0",
        density === "full" ? "py-1" : "py-0.5",
        row.unmatched ? "opacity-60 grayscale-[30%]" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-1 min-w-0">
        <span className={`truncate ${PRIMARY_LABEL_CLS}`}>{row.customer || "—"}</span>
        <span className={`shrink-0 font-mono tabular-nums ${PRIMARY_LABEL_CLS}`}>
          #{row.invoice_number}
        </span>
      </div>

      <div className="flex items-center justify-between gap-1 mt-0.5 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <StatusBadge status={row.status} unmatched={row.unmatched} sheetStatus={row.sheet_status} />
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
