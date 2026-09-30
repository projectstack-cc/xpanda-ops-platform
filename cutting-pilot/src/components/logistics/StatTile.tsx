// src/components/logistics/StatTile.tsx
// lgx-widgets-01: one KPI tile on the v2 Shipment Dashboard (was 4 copy-pasted blocks). Shows orders
// (shipment rows matching the tile's STAT_PREDICATES entry) and loads (trailers: load_count per order,
// orders linked on one trailer via jobs.trailer_group_id collapsed). `tileProps` is the dashboard's
// statTileProps(key) — role/tabIndex/click/Enter/Space that open the StatBreakdownModal drilldown.
import type { HTMLAttributes, ReactNode } from "react";

interface StatTileProps {
  tileProps: HTMLAttributes<HTMLDivElement>;
  label: string;
  orders: number | undefined;
  loads: number | undefined;
  caption: string;
  iconWrapClassName: string;
  icon: ReactNode;
}

export default function StatTile({ tileProps, label, orders, loads, caption, iconWrapClassName, icon }: StatTileProps) {
  return (
    <div
      {...tileProps}
      className="bg-surface border border-[var(--card-border)] rounded-xl p-4 shadow-sm flex items-center justify-between cursor-pointer hover:border-[var(--brand)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
    >
      <div>
        <div className="text-xs font-semibold text-muted uppercase tracking-wider">{label}</div>
        <div className="text-2xl font-bold tabular-nums text-text mt-1">
          {orders ?? "—"}
          <span className="ml-1.5 text-xs font-semibold text-muted normal-case tracking-normal">
            {orders === 1 ? "order" : "orders"}
          </span>
        </div>
        <div className="text-sm font-semibold tabular-nums text-text">
          {loads ?? "—"}
          <span className="ml-1 text-xs font-semibold text-muted">{loads === 1 ? "load" : "loads"}</span>
        </div>
        <div className="text-[11px] text-muted mt-0.5">{caption}</div>
      </div>
      <div className={iconWrapClassName}>
        {icon}
      </div>
    </div>
  );
}
