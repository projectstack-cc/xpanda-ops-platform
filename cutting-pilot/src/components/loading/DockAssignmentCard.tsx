"use client";
// src/components/loading/DockAssignmentCard.tsx
// One interactive load card on the dock dashboard. Built new rather than force-fitting the wall
// board's presentational LoadCard.tsx (board-shaped, no handlers, minimal props) -- this card
// needs the full field set (trailer editing, notes, photo/BOL counts, per-status action buttons)
// and per-card permission-aware handlers the wall component was never meant to carry. Reuses
// components/loading/status.ts's statusVariant AS-IS for color/label, per doctrine.
import { useEffect, useState } from "react";
import { Camera, FileText } from "lucide-react";
import { statusVariant } from "./status";
import { advanceLabel, nextLoadingStatus, type CardActionHandlers, type DockAssignment } from "./dockTypes";

interface DockAssignmentCardProps extends CardActionHandlers {
  a: DockAssignment;
  showArchive?: boolean;
  isDragging?: boolean;
  draggable?: boolean;
  highlighted?: boolean;
  onCardDragStart?: (e: React.DragEvent) => void;
  onCardDragEnd?: () => void;
  onCardTouchStart?: (e: React.TouchEvent) => void;
  // "compact" = Overview's fixed-height tile; "comfortable" = Team View's 44px touch layout.
  density?: "compact" | "comfortable";
}

// Fixed Overview tile height (explicit height, not min-height), sized to the worst case: a
// manager on a bay card (Advance + BOL + Photos + Move to yard = two action rows). 2x6px padding +
// 2px border + row1 16 + row2 16 + row3 28 + actions 60 (2x28 + 4 gap) + 3x4px row gaps = 146,
// plus 2px slack. Must stay <= 150.
export const COMPACT_CARD_H = 148;

function formatShipDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
}

export default function DockAssignmentCard({
  a,
  canManage,
  onAdvance,
  onAssignBay,
  onMoveToYard,
  onRevertToBay,
  onRevertYardToBay,
  onSendBackToQueue,
  onArchive,
  onTrailerChange,
  onViewBol,
  onShowShippingInfo,
  onShowPhotos,
  showArchive = false,
  isDragging = false,
  draggable: isDraggable = false,
  highlighted = false,
  onCardDragStart,
  onCardDragEnd,
  onCardTouchStart,
  density = "comfortable",
}: DockAssignmentCardProps) {
  const variant = statusVariant(a.loading_status);
  const next = nextLoadingStatus(a.loading_status);
  const showLoadCount = (a.load_count ?? 1) > 1;

  const trailerEditable =
    canManage && !!a.bay_id && ["not_started", "loading", "loaded"].includes(a.loading_status);
  const [trailerDraft, setTrailerDraft] = useState(a.trailer_number ?? "");
  // The card stays mounted across a refetch (same key={a.id}), so without this the input would
  // keep showing a rejected edit after a failed PUT, or a stale value after another operator's
  // change. Safe alongside DockBoard's 15s poll: this only fires when a.trailer_number actually
  // changes, and the poll skips its tick while a card's trailer input is focused.
  useEffect(() => {
    setTrailerDraft(a.trailer_number ?? "");
  }, [a.trailer_number]);

  const compact = density === "compact";
  const sz = compact ? BTN_COMPACT : BTN_COMFORTABLE;

  const trailerField = trailerEditable ? (
    <input
      type="text"
      value={trailerDraft}
      onChange={(e) => setTrailerDraft(e.target.value)}
      onBlur={() => {
        const trimmed = trailerDraft.trim();
        if (trimmed !== (a.trailer_number ?? "")) onTrailerChange(a, trimmed);
      }}
      onClick={(e) => e.stopPropagation()}
      placeholder="Trailer #"
      className={
        compact
          ? "h-7 w-24 shrink-0 px-1.5 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text font-mono text-xs"
          : "min-h-[44px] px-2 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text font-mono text-sm w-28"
      }
    />
  ) : a.trailer_number ? (
    <span className="shrink-0 font-mono tabular-nums font-semibold text-text">{a.trailer_number}</span>
  ) : null;

  // Compact mode shortens View BOL / Photos to icon + count so the worst case never needs a third
  // action row at the narrowest bay column; the label moves to title/aria-label.
  const bolTitle = a.bol_count === 0 ? "No BOL generated for this load yet" : compact ? "View BOL" : undefined;
  const photosTitle = a.photo_count === 0 ? "No photos attached to this load yet" : compact ? "Photos" : undefined;

  return (
    <div
      data-assignment-id={a.id}
      draggable={isDraggable}
      onDragStart={onCardDragStart}
      onDragEnd={onCardDragEnd}
      onTouchStart={onCardTouchStart}
      className={
        compact
          ? "rounded border px-2 py-1.5 flex flex-col gap-1 text-left w-full overflow-hidden"
          : "rounded border px-2.5 py-2 space-y-1.5 text-left w-full"
      }
      style={{
        background: `linear-gradient(0deg, ${variant.border}1a, ${variant.border}1a), var(--surface)`,
        borderColor: variant.border,
        borderLeftWidth: 4,
        height: compact ? COMPACT_CARD_H : undefined,
        opacity: isDragging ? 0.5 : 1,
        transform: isDragging ? 'scale(0.95)' : 'none',
        cursor: isDraggable ? 'grab' : undefined,
        boxShadow: highlighted ? '0 0 0 3px var(--accent)' : undefined,
      }}
    >
      <div className={`flex items-center justify-between gap-1${compact ? " h-4 shrink-0 whitespace-nowrap" : ""}`}>
        <div className={`flex items-center gap-1.5 min-w-0 ${compact ? "flex-nowrap overflow-hidden" : "flex-wrap"}`}>
          {a.invoice_number ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onShowShippingInfo(a);
              }}
              className={`${compact ? "min-w-0" : "shrink-0"} font-mono tabular-nums font-bold text-xs truncate underline decoration-dotted cursor-pointer`}
              style={{ color: variant.text }}
            >
              INV# {a.invoice_number}
            </button>
          ) : (
            <span className="shrink-0 font-mono tabular-nums font-bold text-xs truncate" style={{ color: variant.text }}>
              No INV#
            </span>
          )}
          {showLoadCount && (
            <span className="shrink-0 font-mono tabular-nums text-xs font-bold text-[#6366f1]">
              {a.load_number ?? 1} of {a.load_count}
            </span>
          )}
          {a.load_ship_date && (
            <span className="truncate font-mono tabular-nums text-xs font-semibold text-muted">
              {formatShipDay(a.load_ship_date)}
            </span>
          )}
        </div>
        <span
          className={`shrink-0 font-bold uppercase tracking-wider ${compact ? "text-[10px]" : "text-xs"}`}
          style={{ color: variant.border }}
        >
          {variant.label}
        </span>
      </div>

      <div
        className={compact ? "h-4 shrink-0 text-xs leading-4 text-muted truncate" : "text-sm text-muted truncate leading-tight"}
        title={a.customer ?? "Unknown customer"}
      >
        {a.customer || "Unknown customer"}
      </div>

      <div
        className={
          compact
            ? "h-7 shrink-0 flex items-center gap-2 flex-nowrap overflow-hidden whitespace-nowrap text-xs text-muted"
            : "flex items-center gap-2 flex-wrap text-xs text-muted"
        }
      >
        {trailerField}
        {a.ship_to_city && (
          <span className={compact ? "truncate min-w-0" : "truncate max-w-[120px]"}>
            {a.ship_to_city}
            {a.ship_to_state ? `, ${a.ship_to_state}` : ""}
          </span>
        )}
        {a.photo_count > 0 && (
          <span className="shrink-0 inline-flex items-center gap-0.5 font-mono tabular-nums font-semibold">
            <Camera size={11} aria-label="photos" />
            {a.photo_count}
          </span>
        )}
      </div>

      <div
        className={
          compact
            ? "mt-auto h-[60px] shrink-0 flex flex-wrap content-end gap-1 overflow-hidden"
            : "flex flex-wrap gap-1 pt-0.5"
        }
      >
        {a.loading_status === "awaiting" && canManage && (
          <button type="button" onClick={() => onAssignBay(a)} className={`${ACTION_BTN_ASSIGN} ${sz}`}>
            Assign to bay
          </button>
        )}
        {next && a.loading_status !== "awaiting" && (next !== "in_transit" || canManage) && (
          <button type="button" onClick={() => onAdvance(a, next)} className={`${ACTION_BTN_PRIMARY} ${sz}`}>
            {advanceLabel(next)}
          </button>
        )}
        {a.loading_status !== "awaiting" && (
          <button
            type="button"
            onClick={() => a.bol_count > 0 && onViewBol(a)}
            disabled={a.bol_count === 0}
            title={bolTitle}
            aria-label={compact ? `View BOL (${a.bol_count})` : undefined}
            className={`${ACTION_BTN} ${sz} disabled:opacity-40 disabled:cursor-default inline-flex items-center gap-1`}
          >
            <FileText size={11} aria-hidden="true" />
            {compact ? <span className="font-mono tabular-nums">{a.bol_count}</span> : "View BOL"}
          </button>
        )}
        <button
          type="button"
          onClick={() => a.photo_count > 0 && onShowPhotos(a)}
          disabled={a.photo_count === 0}
          title={photosTitle}
          aria-label={compact ? `Photos (${a.photo_count})` : undefined}
          className={`${ACTION_BTN} ${sz} disabled:opacity-40 disabled:cursor-default inline-flex items-center gap-1`}
        >
          {compact ? (
            <>
              <Camera size={11} aria-hidden="true" />
              <span className="font-mono tabular-nums">{a.photo_count}</span>
            </>
          ) : (
            "Photos"
          )}
        </button>
        {canManage && a.bay_id && ["not_started", "loading", "loaded"].includes(a.loading_status) && (
          <button type="button" onClick={() => onMoveToYard(a)} className={`${ACTION_BTN_WARN} ${sz}`}>
            Move to yard
          </button>
        )}
        {canManage && a.loading_status === "in_transit" && (
          <button type="button" onClick={() => onRevertToBay(a)} className={`${ACTION_BTN_WARN} ${sz}`}>
            Move back to bay
          </button>
        )}
        {canManage && a.location === "yard" && !["in_transit", "delivered", "archived"].includes(a.loading_status) && (
          <button type="button" onClick={() => onRevertYardToBay(a)} className={`${ACTION_BTN_WARN} ${sz}`}>
            Move back to bay
          </button>
        )}
        {canManage && a.loading_status === "delivered" && (
          <button type="button" onClick={() => onSendBackToQueue(a)} className={`${ACTION_BTN_WARN} ${sz}`}>
            Send back to queue
          </button>
        )}
        {showArchive && (
          <button type="button" onClick={() => onArchive(a)} className={`${ACTION_BTN} ${sz}`}>
            Archive
          </button>
        )}
      </div>
    </div>
  );
}

// Size classes are split from the color/border styles so compact (Overview) and comfortable
// (Team View) share one look; comfortable keeps the 44px floor touch targets.
const BTN_COMFORTABLE = "min-h-[44px] px-3 text-xs";
const BTN_COMPACT = "h-7 px-2.5 text-[11px] whitespace-nowrap";
const ACTION_BTN =
  "rounded border border-[var(--line)] bg-[var(--surface)] font-semibold text-text cursor-pointer hover:bg-[var(--ghost-bg)] transition-colors";
const ACTION_BTN_PRIMARY =
  "rounded border-none bg-[var(--primary-bg)] font-semibold text-[var(--primary-text)] cursor-pointer hover:opacity-90 transition-opacity";
const ACTION_BTN_ASSIGN =
  "rounded border border-[var(--line)] bg-[var(--accent-soft)] font-semibold text-text cursor-pointer hover:bg-[var(--ghost-bg)] transition-colors";
const ACTION_BTN_WARN =
  "rounded border border-[var(--warn-border)] bg-[var(--warn-bg)] font-semibold text-[var(--warn-text)] cursor-pointer hover:opacity-90 transition-opacity";
