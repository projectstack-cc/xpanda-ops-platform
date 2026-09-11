"use client";
// src/components/logistics/StatBreakdownModal.tsx
// Drilldown for the Shipment Dashboard's 4 clickable KPI tiles (Task 5). Parametrized by
// `statKey`, which must match a key in shipments/route.ts's STAT_PREDICATES map exactly --
// fetches GET /v2/api/shipments?stat=<key>, which bypasses the normal week/status/search
// filtering so the list always matches exactly what the tile counted. Read-only, no write fence.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { StatusBadge } from "./ShipmentRow";
import type { ShipmentListItem } from "./types";

interface StatBreakdownModalProps {
  statKey: string | null;
  label: string;
  onClose: () => void;
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function StatBreakdownModal({ statKey, label, onClose }: StatBreakdownModalProps) {
  const [rows, setRows] = useState<ShipmentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRows(null);
    setError(null);
    if (!statKey) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/v2/api/shipments?stat=${encodeURIComponent(statKey)}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error || "Couldn't load this breakdown.");
          return;
        }
        setRows(json.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Network error — couldn't reach the server.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [statKey]);

  return (
    <Modal isOpen={!!statKey} onClose={onClose} title={label || "Breakdown"}>
      {loading && <p className="text-sm text-muted py-6 text-center">Loading…</p>}
      {error && !loading && <p className="text-sm text-[var(--danger-text)] py-4 text-center">{error}</p>}
      {!loading && !error && rows && rows.length === 0 && (
        <p className="text-sm text-muted py-6 text-center">No shipments match this tile right now.</p>
      )}
      {!loading && !error && rows && rows.length > 0 && (
        <ul className="divide-y divide-[var(--line)] list-none p-0 m-0 max-h-[60vh] overflow-y-auto">
          {rows.map((s) => (
            <li key={s.id} className="py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-text truncate">{s.customer || "Unknown"}</div>
                <div className="text-xs text-muted font-mono tabular-nums">{fmtDate(s.ship_date)}</div>
              </div>
              <StatusBadge status={s.status} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
