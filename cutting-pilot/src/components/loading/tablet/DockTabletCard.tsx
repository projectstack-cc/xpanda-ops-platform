"use client";
// src/components/loading/tablet/DockTabletCard.tsx
// dock-10: one load on the Dock Tablet page (/v2/dock). Big touch targets; every action goes
// through the shared CardActionHandlers from useDockActions -- nothing re-implemented here.
// "full" = the only load in its bay; "compact" = two or more share the bay.
import { Camera, Check, CircleCheck, Ellipsis, FileText, Info, Play } from "lucide-react";
import { formatEtClock } from "@/lib/etDateTime";
import { LD_ADVANCE_STYLE, statusVariant } from "../status";
import type { CardActionHandlers, DockAssignment } from "../dockTypes";
import { DOCK_TABLET as P } from "./palette";
import { LiveLoadPill, LiveLoadStripe } from "@/components/LiveLoadMarker";

interface DockTabletCardProps {
  a: DockAssignment;
  /** Other active rows with the same job_id. */
  siblings: DockAssignment[];
  layout: "full" | "compact";
  cardHandlers: CardActionHandlers;
  canManage: boolean;
  onMore: (a: DockAssignment, anchor: HTMLElement) => void;
}

export default function DockTabletCard({ a, siblings, layout, cardHandlers, canManage, onMore }: DockTabletCardProps) {
  const full = layout === "full";
  const variant = statusVariant(a.loading_status);
  const isLoaded = a.loading_status === "loaded";
  const cityLine = [a.ship_to_city, a.ship_to_state].filter(Boolean).join(", ");
  const multiLoad = (a.load_count ?? 1) > 1 && a.load_number != null;
  const elsewhere = siblings.filter((s) => s.bay_id && s.bay_id !== a.bay_id && s.bay_number != null);
  const loadedClock = isLoaded ? formatEtClock(a.loaded_at) : null;

  // Same photo rules as DockAssignmentCard (dock-05).
  const canAddPhoto = cardHandlers.canAddPhotos && isLoaded;
  const canOpenPhotos = a.photo_count > 0 || canAddPhoto;
  const hasBol = a.bol_count > 0;

  const invButton = (
    <button
      type="button"
      onClick={() => cardHandlers.onShowShippingInfo(a)}
      className="font-mono cursor-pointer min-h-[44px] inline-flex items-center"
      style={{ textDecoration: "underline dotted", textUnderlineOffset: 4, color: P.ink }}
    >
      {a.invoice_number || "—"}
    </button>
  );

  // Below lg (portrait tablet, two bays) compact/secondary icons drop so labels fit on one line.
  const SEC_ICON = "max-lg:hidden shrink-0";

  // --- primary action, by status
  const primaryH = full ? 72 : 60;
  const primaryFont = full ? 22 : 19;
  let primary: React.ReactNode = null;
  if (a.loading_status === "not_started" || a.loading_status === "loading") {
    const target = a.loading_status === "not_started" ? "loading" : "loaded";
    const style = LD_ADVANCE_STYLE[target];
    primary = (
      <button
        type="button"
        onClick={() => cardHandlers.onAdvance(a, target)}
        className="w-full flex items-center justify-center gap-3 font-bold cursor-pointer whitespace-nowrap overflow-hidden"
        style={{ height: primaryH, fontSize: primaryFont, borderRadius: 10, background: style.bg, color: style.text }}
      >
        {target === "loading" ? (
          <Play size={full ? 26 : 22} aria-hidden="true" className={full ? "shrink-0" : SEC_ICON} />
        ) : (
          <Check size={full ? 26 : 22} aria-hidden="true" className={full ? "shrink-0" : SEC_ICON} />
        )}
        {target === "loading" ? "Start loading" : "Mark loaded"}
      </button>
    );
  } else if (isLoaded) {
    const label = a.photo_count > 0 ? `Photos (${a.photo_count})` : canAddPhoto ? "Add trailer photos" : full ? "No photos yet" : "No photos";
    primary = (
      <button
        type="button"
        onClick={() => canOpenPhotos && cardHandlers.onShowPhotos(a)}
        disabled={!canOpenPhotos}
        className="w-full flex items-center justify-center gap-3 font-bold cursor-pointer whitespace-nowrap overflow-hidden disabled:opacity-40 disabled:cursor-default"
        style={{
          height: primaryH,
          fontSize: primaryFont,
          borderRadius: 10,
          background: P.surface,
          color: P.ink,
          border: `2px solid ${P.ink}`,
        }}
      >
        <Camera size={full ? 26 : 22} aria-hidden="true" className={full ? "shrink-0" : SEC_ICON} />
        {label}
      </button>
    );
  }

  const secBtn = (h: number, font: number) =>
    ({
      height: h,
      fontSize: font,
      borderRadius: 10,
      background: P.surface,
      color: P.ink,
      border: `1px solid ${P.btnBorder}`,
    }) as const;
  const SEC_CLASS =
    "flex items-center justify-center gap-2 font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default min-w-0 whitespace-nowrap overflow-hidden";

  const moreButton = canManage ? (
    <button
      type="button"
      aria-label="More actions"
      onClick={(e) => onMore(a, e.currentTarget)}
      className={SEC_CLASS}
      style={{ ...secBtn(full ? 56 : 60, 16), width: full ? 56 : 60 }}
    >
      <Ellipsis size={22} aria-hidden="true" />
    </button>
  ) : null;

  const bolButton = (h: number, font: number, label: string) => (
    <button
      type="button"
      onClick={() => hasBol && cardHandlers.onViewBol(a)}
      disabled={!hasBol}
      title={hasBol ? undefined : "No BOL generated yet"}
      className={SEC_CLASS}
      style={secBtn(h, font)}
    >
      <FileText size={20} aria-hidden="true" className={SEC_ICON} />
      {label}
    </button>
  );
  const photosButton = (h: number, font: number) => (
    <button
      type="button"
      onClick={() => canOpenPhotos && cardHandlers.onShowPhotos(a)}
      disabled={!canOpenPhotos}
      title={canOpenPhotos ? undefined : "No photos attached to this load yet"}
      className={SEC_CLASS}
      style={secBtn(h, font)}
    >
      <Camera size={20} aria-hidden="true" className={SEC_ICON} />
      Photos
    </button>
  );
  const infoButton = (h: number, font: number, label: string) => (
    <button type="button" onClick={() => cardHandlers.onShowShippingInfo(a)} className={SEC_CLASS} style={secBtn(h, font)}>
      <Info size={20} aria-hidden="true" className={SEC_ICON} />
      {label}
    </button>
  );

  return (
    <div
      data-assignment-id={a.id}
      className={a.live_load ? "relative flex flex-col overflow-hidden" : "flex flex-col"}
      style={{
        border: `1px solid ${P.cardBorder}`,
        borderRadius: 14,
        padding: full ? 18 : 16,
        // live-02: clear the 10px hazard stripe.
        paddingLeft: a.live_load ? (full ? 28 : 26) : undefined,
        gap: full ? 14 : 12,
        background: `linear-gradient(0deg, ${variant.border}0d, ${variant.border}0d), ${P.surface}`,
      }}
    >
      {a.live_load && <LiveLoadStripe width={10} />}
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold truncate" style={{ fontSize: full ? 26 : 24, color: P.ink, lineHeight: 1.2 }}>
            {a.customer || "—"}
          </div>
          <div className="flex items-center flex-wrap gap-x-1" style={{ fontSize: 17, color: P.muted }}>
            {cityLine && <span>{cityLine}</span>}
            {!full && (
              <>
                {cityLine && <span aria-hidden="true">·</span>}
                <span>INV#</span>
                {invButton}
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {/* live-02: same box as the status pill (padding, radius, font, 1px border) so heights match. */}
          {a.live_load && (
            <LiveLoadPill
              className="uppercase"
              style={{
                padding: "6px 12px",
                borderRadius: 9999,
                background: P.liveInk,
                color: P.liveYellow,
                border: `1px solid ${P.liveInk}`,
                fontSize: 14,
                lineHeight: "inherit",
                letterSpacing: ".06em",
              }}
            >
              Live load
            </LiveLoadPill>
          )}
          <span
            className="shrink-0 font-bold uppercase whitespace-nowrap"
            style={{
              padding: "6px 12px",
              borderRadius: 9999,
              background: variant.bg,
              border: `1px solid ${variant.border}`,
              color: variant.text,
              fontSize: 14,
              letterSpacing: ".06em",
            }}
          >
            {variant.label}
          </span>
        </div>
      </div>

      {/* Meta row */}
      {(full || multiLoad || elsewhere.length > 0 || loadedClock) && (
        <div className="flex items-center flex-wrap gap-x-4 gap-y-1" style={{ fontSize: 17, color: P.muted }}>
          {full && (
            <span className="inline-flex items-center gap-1">
              INV# {invButton}
            </span>
          )}
          {multiLoad && (
            <span className="font-mono font-bold" style={{ color: P.loadOf }}>
              Load {a.load_number} of {a.load_count}
            </span>
          )}
          {elsewhere.map((s) => (
            <span key={s.id}>
              Load {s.load_number ?? "?"} → Bay {s.bay_number}
            </span>
          ))}
          {loadedClock && <span className="font-mono">Loaded {loadedClock}</span>}
        </div>
      )}

      {isLoaded && (
        <div
          className="flex items-center gap-3"
          style={{ background: P.readyBg, border: `1px solid ${P.readyBorder}`, borderRadius: 12, padding: 16 }}
        >
          <CircleCheck size={34} aria-hidden="true" style={{ color: P.readyInk, flexShrink: 0 }} />
          <div className="min-w-0">
            <div className="font-bold" style={{ fontSize: 20, color: P.readyInk }}>
              Ready for pickup
            </div>
            <div style={{ fontSize: 15, color: P.readyInk }}>Waiting on the driver. Office marks it in transit.</div>
          </div>
        </div>
      )}

      {full ? (
        <>
          {primary}
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(${isLoaded ? 2 : 3}, minmax(0,1fr))${moreButton ? " auto" : ""}`,
            }}
          >
            {bolButton(56, 16, "View BOL")}
            {!isLoaded && photosButton(56, 16)}
            {infoButton(56, 16, "Ship info")}
            {moreButton}
          </div>
        </>
      ) : (
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `2fr 1fr 1fr 1fr${moreButton ? " auto" : ""}` }}
        >
          <div className="min-w-0">{primary}</div>
          {bolButton(60, 15, "BOL")}
          {photosButton(60, 15)}
          {infoButton(60, 15, "Info")}
          {moreButton}
        </div>
      )}
    </div>
  );
}
