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
// lgx-boldel-01 -- manager-only "Delete all BOLs" (legacy `deleteAllBolsForJob` parity) via
// `DELETE /v2/api/bols?job_id=`; refused with an inline message if any load has shipped.
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import PhotoGalleryModal from "@/components/loading/PhotoGalleryModal";
import { formatEtDateTime } from "@/lib/etDateTime";
import { formatUsdCents } from "@/lib/money";
import { StatusBadge } from "./ShipmentRow";
import AssignShipDaysModal, { fmtDay } from "./AssignShipDaysModal";
import type { ShipmentDetail, ShipmentLoad } from "./types";

// lgx-minimap-01: shared with the Carrier View. Leaflet touches `window` at import -> client-only.
const DestinationMiniMap = dynamic(() => import("@/components/DestinationMiniMap"), { ssr: false });

interface ShipmentDetailPanelProps {
  shipmentId: string;
  cache: Map<string, ShipmentDetail>;
  canManageLoading?: boolean;
  isCustomerPickup?: boolean;
  orderShipDate?: string | null;
  onShipDaysSaved?: () => void;
  /** lgx-boldel-01: row's bol_count; drives the manager-only "Delete all BOLs" button. */
  bolCount?: number;
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

export default function ShipmentDetailPanel({
  shipmentId,
  cache,
  canManageLoading = false,
  isCustomerPickup = false,
  orderShipDate = null,
  onShipDaysSaved,
  bolCount = 0,
}: ShipmentDetailPanelProps) {
  const [detail, setDetail] = useState<ShipmentDetail | null>(cache.get(shipmentId) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cache.has(shipmentId));
  // lgx-photos-01: index into allPhotos of the open gallery photo (null = closed).
  const [gallery, setGallery] = useState<number | null>(null);
  // split-days-02: Assign Ship Days modal.
  const [daysOpen, setDaysOpen] = useState(false);
  // Bumped after a ship-days save: the panel stays mounted across the list refetch, so force a fresh detail.
  const [reloadKey, setReloadKey] = useState(0);
  // lgx-boldel-01: two-step arm/confirm (house pattern -- PartsLibraryPanel/BolViewerModal), no window.confirm().
  const [delArmed, setDelArmed] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  async function handleDeleteAllBols(jobId: string) {
    setDelError(null);
    setDelBusy(true);
    try {
      const res = await fetch(`/v2/api/bols?job_id=${encodeURIComponent(jobId)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setDelError(data.detail || data.error || `HTTP ${res.status}`);
        setDelArmed(false);
        return;
      }
      setDelArmed(false);
      cache.delete(shipmentId);
      setReloadKey((k) => k + 1);
      // Generic "detail changed" refresh: the dashboard's handler clears the drill-down cache and
      // reloads the list, so the row's bol_count drops to 0 and it flips back to Generate BOL.
      onShipDaysSaved?.();
    } catch {
      setDelError("Network error — could not delete.");
    } finally {
      setDelBusy(false);
    }
  }

  // lgx-photos-01: every load's photos flattened in display order, so the gallery cycles through the
  // whole order; flatIndex lets each thumbnail open the gallery at itself. Memoized so the gallery's
  // reset-on-photos-change effect doesn't fire on unrelated re-renders.
  const { allPhotos, flatIndex } = useMemo(() => {
    const all: NonNullable<ShipmentLoad["photos"]> = [];
    const idx = new Map<string, number>();
    for (const ld of detail?.loads ?? []) {
      for (const p of ld.photos ?? []) {
        idx.set(p.id, all.length);
        all.push(p);
      }
    }
    return { allPhotos: all, flatIndex: idx };
  }, [detail]);
  const photoSrc = (pid: string) =>
    `/v2/api/shipments/${encodeURIComponent(shipmentId)}/loading-photo/${encodeURIComponent(pid)}`;

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
  }, [shipmentId, cache, reloadKey]);

  if (loading) {
    return <div className="px-4 py-4 text-sm text-muted">Loading details…</div>;
  }
  if (error) {
    return <div className="px-4 py-4 text-sm text-[var(--warn-text)]">{error}</div>;
  }
  if (!detail) return null;

  const lines = addressLines(detail);
  // split-days-02: per-load "Ships" line shows when a load's own day differs from the order date, or the
  // order's loads land on more than one distinct day.
  const orderDay = String(orderShipDate ?? "").slice(0, 10);
  const effDays = new Set((detail.loads ?? []).map((ld) => String(ld.load_ship_date ?? "").trim().slice(0, 10) || orderDay));
  const multiDay = effDays.size > 1;
  const canAssignDays = canManageLoading && !isCustomerPickup && (detail.load_count ?? 1) > 1;

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
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Loads</div>
            {canAssignDays && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDaysOpen(true);
                }}
                className="min-h-[44px] md:min-h-[32px] px-3 rounded-md border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-[var(--brand)] cursor-pointer hover:bg-[var(--ghost-bg)]"
              >
                Assign Ship Days
              </button>
            )}
          </div>
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
                    {ld.load_ship_date && (multiDay || String(ld.load_ship_date).slice(0, 10) !== orderDay) && (
                      <span className="text-xs text-muted tabular-nums">Ships {fmtDay(ld.load_ship_date)}</span>
                    )}
                  </div>
                  {(ld.photos ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {(ld.photos ?? []).map((p) => {
                        const label = `Loading photo — ${p.uploaded_by || "Unknown"} · ${formatEtDateTime(p.created_at) || "—"}`;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            aria-label={label}
                            title={label}
                            onClick={(e) => {
                              e.stopPropagation();
                              setGallery(flatIndex.get(p.id) ?? 0);
                            }}
                            className="w-14 h-14 rounded-md border border-[var(--border)] overflow-hidden cursor-pointer"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photoSrc(p.id)}
                              alt={p.filename || "Loading photo"}
                              loading="lazy"
                              className="w-full h-full object-cover"
                            />
                          </button>
                        );
                      })}
                    </div>
                  )}
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

      {canManageLoading && bolCount > 0 && detail.job_id && (
        <div
          className="flex flex-wrap items-center justify-end gap-2 pt-1"
          onClick={(e) => e.stopPropagation()}
        >
          {delError && <p className="text-xs text-[var(--danger-bg)] mr-auto">{delError}</p>}
          {delArmed ? (
            <>
              <span className="text-xs text-muted">
                Delete all {bolCount} BOL{bolCount === 1 ? "" : "s"} and their signed copies?
              </span>
              <button
                type="button"
                onClick={() => detail.job_id && handleDeleteAllBols(detail.job_id)}
                disabled={delBusy}
                className="min-h-[44px] md:min-h-[32px] px-3 rounded-md bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {delBusy ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                onClick={() => setDelArmed(false)}
                disabled={delBusy}
                className="min-h-[44px] md:min-h-[32px] px-3 rounded-md border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-text cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDelError(null);
                setDelArmed(true);
              }}
              className="min-h-[44px] md:min-h-[32px] px-3 rounded-md border border-[var(--danger-bg)] bg-[var(--surface)] text-xs font-semibold text-[var(--danger-bg)] cursor-pointer hover:bg-[color-mix(in_srgb,var(--danger-bg)_10%,transparent)]"
            >
              Delete all BOLs
            </button>
          )}
        </div>
      )}

      {canAssignDays && (
        <AssignShipDaysModal
          isOpen={daysOpen}
          shipmentId={shipmentId}
          loadCount={detail.load_count ?? 1}
          loads={detail.loads ?? []}
          orderShipDate={orderShipDate}
          onClose={() => setDaysOpen(false)}
          onSaved={() => {
            cache.delete(shipmentId);
            setReloadKey((k) => k + 1);
            onShipDaysSaved?.();
          }}
        />
      )}

      <PhotoGalleryModal
        jobId={gallery !== null ? (detail.job_id ?? "x") : null}
        onClose={() => setGallery(null)}
        photos={allPhotos}
        imageSrc={photoSrc}
        startIndex={gallery ?? 0}
      />
    </div>
  );
}
