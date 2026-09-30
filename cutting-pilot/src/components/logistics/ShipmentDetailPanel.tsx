"use client";
// src/components/logistics/ShipmentDetailPanel.tsx
// Inline drill-down panel for a shipment row on the /v2/logistics dashboard -- replaces the old
// "View job →" link that navigated away to /jobs/?job_id=... without showing anything
// shipment-specific. Renders shipping address, carrier, shipping time, load count, and the job's
// parts (line items) in place, under the row that was clicked (ShipmentRow.tsx + the Fragment +
// conditional-<tr> pattern from ProductionBoard.tsx). Reads from GET /v2/api/shipments/:id, which
// stays under the logistics.dashboard permission the dashboard itself already requires -- see
// that route's header comment for why it doesn't delegate to /v2/api/jobs/:id or
// /v2/api/board/:id (both gated on the separate "jobs" key).
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { formatEtDateTime } from "@/lib/etDateTime";
import { formatUsdCents } from "@/lib/money";
import { StatusBadge } from "./ShipmentRow";
import type { ShipmentDetail } from "./types";

// lgx-minimap-01: shared with the Carrier View. Leaflet touches `window` at import -> client-only.
const DestinationMiniMap = dynamic(() => import("@/components/DestinationMiniMap"), { ssr: false });

interface ShipmentDetailPanelProps {
  shipmentId: string;
  cache: Map<string, ShipmentDetail>;
}

function addressLines(d: ShipmentDetail): string[] {
  const lines: string[] = [];
  if (d.ship_to_company) lines.push(d.ship_to_company);
  if (d.ship_to_attention) lines.push(d.ship_to_attention);
  if (d.ship_to_street) lines.push(d.ship_to_street);
  if (d.ship_to_street2) lines.push(d.ship_to_street2);
  const cityLine = [d.ship_to_city, d.ship_to_state].filter(Boolean).join(", ") + (d.ship_to_zip ? ` ${d.ship_to_zip}` : "");
  if (cityLine.trim()) lines.push(cityLine.trim());
  return lines;
}

export default function ShipmentDetailPanel({ shipmentId, cache }: ShipmentDetailPanelProps) {
  const [detail, setDetail] = useState<ShipmentDetail | null>(cache.get(shipmentId) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cache.has(shipmentId));

  useEffect(() => {
    const cached = cache.get(shipmentId);
    if (cached) {
      setDetail(cached);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/v2/api/shipments/${encodeURIComponent(shipmentId)}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.ok || !json.data) {
          setError(json.error || "Couldn't load shipment details.");
          return;
        }
        cache.set(shipmentId, json.data);
        setDetail(json.data);
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
  }, [shipmentId, cache]);

  if (loading) {
    return <div className="px-4 py-4 text-sm text-muted">Loading details…</div>;
  }
  if (error) {
    return <div className="px-4 py-4 text-sm text-[var(--warn-text)]">{error}</div>;
  }
  if (!detail) return null;

  const lines = addressLines(detail);

  return (
    <div className="px-4 py-4 bg-[var(--ghost-bg)] space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">Shipping address</div>
          {lines.length ? (
            <div className="text-sm text-text leading-snug">
              {lines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted">No address on file.</div>
          )}
          {detail.dest && (
            <div onClick={(e) => e.stopPropagation()}>
              <DestinationMiniMap lat={detail.dest.lat} lng={detail.dest.lng} address={detail.dest.address} />
            </div>
          )}
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">Carrier</div>
          <div className="text-sm text-text">{detail.carrier || "—"}</div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted mt-2.5 mb-1">Shipping time</div>
          <div className="text-sm text-text">{detail.delivery_time || "—"}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">Load count</div>
          <div className="text-sm text-text">{detail.load_count ?? 1}</div>
        </div>
      </div>

      {(detail.loads ?? []).length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">Loads</div>
          <div className="rounded-lg border border-[var(--card-border)] bg-surface divide-y divide-[var(--line)]">
            {detail.loads.map((ld, i) => {
              const n = Number(ld.load_number) || 0;
              // Suffix from the integer load_number (never the bol_number string), multi-load only.
              const suffix = (detail.load_count ?? 1) > 1 && n > 0 ? `-${String(n).padStart(2, "0")}` : "";
              const deliveredAt = formatEtDateTime(ld.delivered_at);
              return (
                <div key={`${ld.load_number ?? "x"}-${i}`} className="px-3 py-2 text-sm space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono tabular-nums font-semibold text-text">{suffix || "Load"}</span>
                    <StatusBadge status={ld.loading_status} />
                    {ld.trailer_number && (
                      <span className="text-xs">
                        <span className="text-muted">Trailer </span>
                        <span className="font-mono tabular-nums text-text">{ld.trailer_number}</span>
                      </span>
                    )}
                    {deliveredAt && <span className="text-xs text-muted tabular-nums">Delivered {deliveredAt}</span>}
                  </div>
                  {ld.qr_additional_info && (
                    <div className="text-xs">
                      <span className="font-semibold text-muted">Driver note (QR): </span>
                      <span className="text-text">{ld.qr_additional_info}</span>
                    </div>
                  )}
                  {(ld.carrier_charges ?? []).length > 0 && (
                    <div className="text-xs">
                      <span className="font-semibold text-muted">Carrier fees: </span>
                      <span className="font-semibold text-text tabular-nums">{formatUsdCents(ld.carrier_charges_total_cents)}</span>
                      <ul className="mt-0.5 space-y-0.5">
                        {ld.carrier_charges.map((c, ci) => (
                          <li key={`${c.created_at}-${ci}`} className="text-muted">
                            <span className="font-semibold text-text tabular-nums">{formatUsdCents(c.fee_amount_cents)}</span>
                            {" · "}
                            <span className="text-text whitespace-pre-wrap">{c.notes}</span>
                            {" · "}
                            {c.created_by_name || "Carrier"}
                            {" · "}
                            <span className="tabular-nums">{formatEtDateTime(c.created_at)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">Parts</div>
        <div className="overflow-x-auto rounded-lg border border-[var(--card-border)] bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-xs font-semibold text-muted">
                <th className="px-3 py-2">Part #</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2">Dimensions</th>
              </tr>
            </thead>
            <tbody>
              {(detail.line_items ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-center text-sm text-muted">
                    No parts on this order.
                  </td>
                </tr>
              )}
              {(detail.line_items ?? []).map((li, i) => (
                <tr key={i} className="border-b border-[var(--line)] last:border-0">
                  <td className="px-3 py-2 font-medium text-text">{li.part_number || "Foam"}</td>
                  <td className="px-3 py-2 text-muted">{li.description || "—"}</td>
                  <td className="px-3 py-2 text-right text-muted tabular-nums">{li.quantity ?? 0}</td>
                  <td className="px-3 py-2 text-muted">{li.dimensions || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
