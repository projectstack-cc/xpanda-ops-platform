"use client";
// src/components/orders/LoadTimesEditor.tsx
// dlv-03: per-load delivery-time editor, rendered inline wherever an order's delivery time is
// edited (order entry, /v2/board OrderEditModal, logistics ShipmentEditModal). Controlled: the
// parent owns the LoadTimeDraft[] and saves it through PUT /v2/api/orders/:id/load-times.
// Typing a pattern ("8:00AM & HRLY") and pressing Expand fills one row per load via
// parseLoadTimePattern (lib/loadTimes.ts); each row's day defaults to that load's Assign Ship Days
// date, else the order's ship date, unless the pattern leads with a weekday. Display text is only a
// preview here — the server recomputes it with formatLoadTime.
import { useEffect, useId, useState } from "react";
import CarrierSelect from "./CarrierSelect";
import {
  DAY_ABBR,
  formatLoadTime,
  hasLeadingWeekday,
  parseLoadTimePattern,
  summarizeLoadTimes,
} from "@/lib/loadTimes";

/** One stored job_load_times row, as GET /v2/api/orders/:id/load-times returns it. */
export interface LoadTimeRow {
  load_number: number;
  delivery_date: string | null;
  delivery_minutes: number | null;
  display: string;
  source: "sheet" | "manual";
  prev_display: string | null;
  changed_at: string | null;
  change_acked_at: string | null;
}

export interface LoadTimesData {
  times: LoadTimeRow[];
  load_count: number;
  ship_date: string | null;
  assigned_days: Record<number, string>;
}

export interface LoadTimeDraft {
  load_number: number;
  delivery_date: string | null;
  delivery_minutes: number | null;
  /** null = not saved yet */
  source: "sheet" | "manual" | null;
  prev_display: string | null;
  /** Sheet changed this load and nobody has acknowledged it yet. */
  changed_unacked: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function emptyDraft(n: number): LoadTimeDraft {
  return { load_number: n, delivery_date: null, delivery_minutes: null, source: null, prev_display: null, changed_unacked: false };
}

/** One draft per load 1..loadCount, seeded from the stored rows. */
export function draftsFromRows(rows: LoadTimeRow[], loadCount: number): LoadTimeDraft[] {
  const byLoad = new Map(rows.map((r) => [Number(r.load_number), r]));
  const out: LoadTimeDraft[] = [];
  for (let n = 1; n <= Math.max(1, loadCount); n++) {
    const r = byLoad.get(n);
    out.push(
      r
        ? {
            load_number: n,
            delivery_date: r.delivery_date,
            delivery_minutes: r.delivery_minutes,
            source: r.source,
            prev_display: r.prev_display,
            changed_unacked: !!r.changed_at && !r.change_acked_at,
          }
        : emptyDraft(n)
    );
  }
  return out;
}

export function resizeDrafts(drafts: LoadTimeDraft[], loadCount: number): LoadTimeDraft[] {
  const count = Math.max(1, loadCount);
  const out = drafts.slice(0, count);
  for (let n = out.length + 1; n <= count; n++) out.push(emptyDraft(n));
  return out;
}

/** Stable comparison key — only the fields the PUT sends. */
export function draftsKey(drafts: LoadTimeDraft[]): string {
  return JSON.stringify(drafts.map((d) => [d.load_number, d.delivery_date, d.delivery_minutes]));
}

export function draftsToPut(drafts: LoadTimeDraft[]) {
  return drafts.map((d) => ({ load_number: d.load_number, delivery_date: d.delivery_date, delivery_minutes: d.delivery_minutes }));
}

export function draftsHaveTime(drafts: LoadTimeDraft[]): boolean {
  return drafts.some((d) => d.delivery_minutes != null);
}

// mlc-02: per-load carrier column. The map is load_number → explicit carrier; "" / missing =
// follow the order carrier. The server (PUT /v2/api/orders/:id/load-carriers) prunes values equal
// to the order carrier.

/** Seed the carrier map from GET …/load-carriers `carriers` (sparse overrides). */
export function carriersFromPayload(rows: { load_number: number; carrier: string }[], loadCount: number): Record<number, string> {
  const out: Record<number, string> = {};
  for (const r of rows || []) {
    const n = Number(r.load_number);
    if (n >= 1 && n <= Math.max(1, loadCount) && r.carrier) out[n] = r.carrier;
  }
  return out;
}

/** Stable comparison key for dirty tracking, trimmed to 1..loadCount. */
export function carriersKey(map: Record<number, string>, loadCount: number): string {
  const out: string[] = [];
  for (let n = 1; n <= Math.max(1, loadCount); n++) out.push((map[n] ?? "").trim());
  return JSON.stringify(out);
}

/** One entry per load 1..loadCount, "" for blanks. */
export function carriersToPut(map: Record<number, string>, loadCount: number) {
  const out: { load_number: number; carrier: string }[] = [];
  for (let n = 1; n <= Math.max(1, loadCount); n++) out.push({ load_number: n, carrier: (map[n] ?? "").trim() });
  return out;
}

const normCarrier = (x: unknown) => String(x ?? "").trim().toLowerCase();

export function draftsSummary(drafts: LoadTimeDraft[]): string {
  return summarizeLoadTimes(
    drafts.map((d) => ({
      load_number: d.load_number,
      date: d.delivery_date,
      minutes: d.delivery_minutes,
      display: formatLoadTime(d.delivery_date, d.delivery_minutes),
    }))
  );
}

/**
 * Expand a pattern into drafts. Null when no time was found. A load the pattern gives no time is
 * cleared (day and time), never guessed.
 */
export function expandPattern(
  pattern: string,
  drafts: LoadTimeDraft[],
  loadCount: number,
  shipDate: string | null,
  assignedDays: Record<number, string>
): LoadTimeDraft[] | null {
  const count = Math.max(1, loadCount);
  const parsed = parseLoadTimePattern(pattern, count, shipDate);
  if (!parsed) return null;
  const keepDay = hasLeadingWeekday(pattern);
  return resizeDrafts(drafts, count).map((d, i) => {
    const p = parsed[i];
    const minutes = p?.minutes ?? null;
    const date = minutes == null ? null : keepDay ? p.date : assignedDays[d.load_number] ?? shipDate ?? null;
    return { ...d, delivery_date: date, delivery_minutes: minutes, source: "manual", changed_unacked: false };
  });
}

// ── Day options ──────────────────────────────────────────────────────────────────────────────

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function dayOptionLabel(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${DAY_ABBR[weekdayOf(date)]} ${m}/${d}`;
}

function todayLocal(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** Sun..Sat of the ship week, then the following Mon..Fri. */
function dayOptions(base: string): string[] {
  const sunday = addDays(base, -weekdayOf(base));
  const out: string[] = [];
  for (let i = 0; i < 7; i++) out.push(addDays(sunday, i));
  for (let i = 8; i <= 12; i++) out.push(addDays(sunday, i));
  return out;
}

function minutesToInput(m: number | null): string {
  if (m == null) return "";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function inputToMinutes(v: string): number | null {
  const m = v.match(/^(\d{2}):(\d{2})/);
  if (!m) return null;
  const total = Number(m[1]) * 60 + Number(m[2]);
  return total >= 0 && total <= 1439 ? total : null;
}

// ── Component ────────────────────────────────────────────────────────────────────────────────

const inputClass =
  "w-full min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-50 disabled:cursor-not-allowed";
const labelClass = "block text-xs font-semibold text-muted mb-1";
const chipBase = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap";

interface LoadTimesEditorProps {
  loadCount: number;
  shipDate: string | null;
  assignedDays: Record<number, string>;
  value: LoadTimeDraft[];
  onChange: (next: LoadTimeDraft[]) => void;
  readOnlyReason?: string;
  /** Optional controlled pattern text (order entry sends it as jobs.delivery_time). */
  pattern?: string;
  onPatternChange?: (text: string) => void;
  /** mlc-02: per-load carrier column. Omitted → no column (unchanged behavior). */
  carriers?: Record<number, string>; // load_number → explicit carrier ("" / missing = follow order)
  onCarriersChange?: (next: Record<number, string>) => void;
  defaultCarrier?: string; // the order carrier as currently typed in the parent (unsaved)
}

export default function LoadTimesEditor({
  loadCount,
  shipDate,
  assignedDays,
  value,
  onChange,
  readOnlyReason,
  pattern: patternProp,
  onPatternChange,
  carriers,
  onCarriersChange,
  defaultCarrier,
}: LoadTimesEditorProps) {
  const [patternLocal, setPatternLocal] = useState("");
  const pattern = patternProp ?? patternLocal;
  const setPattern = (t: string) => {
    if (onPatternChange) onPatternChange(t);
    if (patternProp === undefined) setPatternLocal(t);
  };
  const patternId = useId();
  const [error, setError] = useState<string | null>(null);
  const [droppedNote, setDroppedNote] = useState<string | null>(null);
  const count = Math.max(1, Math.floor(Number(loadCount)) || 1);
  const readOnly = !!readOnlyReason;
  const showCarrier = !!carriers && !!onCarriersChange && count > 1;
  const validShip = shipDate && DATE_RE.test(shipDate) ? shipDate : null;

  // Rows follow the load count. Shrinking drops trailing rows with a visible note.
  useEffect(() => {
    if (value.length === count) return;
    if (value.length > count) {
      const lost = value.slice(count).filter((d) => d.delivery_minutes != null || d.delivery_date).map((d) => d.load_number);
      setDroppedNote(
        lost.length
          ? `Load count is now ${count} — the time for load${lost.length === 1 ? "" : "s"} ${lost.join(", ")} will be removed on save.`
          : null
      );
    } else {
      setDroppedNote(null);
    }
    onChange(resizeDrafts(value, count));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, value.length]);

  function handleExpand() {
    if (readOnly) return;
    const next = expandPattern(pattern, value, count, validShip, assignedDays);
    if (!next) {
      setError("Couldn't find a time in that");
      return;
    }
    setError(null);
    onChange(next);
  }

  function updateRow(n: number, patch: Partial<LoadTimeDraft>) {
    onChange(value.map((d) => (d.load_number === n ? { ...d, ...patch, source: "manual", changed_unacked: false } : d)));
  }

  const base = validShip ?? value.find((d) => d.delivery_date)?.delivery_date ?? todayLocal();
  const options = dayOptions(base);

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={patternId} className={labelClass}>
          Delivery time
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id={patternId}
            type="text"
            value={pattern}
            onChange={(e) => {
              setPattern(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleExpand();
              }
            }}
            placeholder="e.g. 8:00AM & HRLY"
            disabled={readOnly}
            className={inputClass}
          />
          <button
            type="button"
            onClick={handleExpand}
            disabled={readOnly || !pattern.trim()}
            className="min-h-[44px] px-4 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            Expand
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-1 text-xs font-semibold text-[var(--danger-ink)]">
            {error}
          </p>
        )}
      </div>

      <div className="space-y-2">
        {value.map((d) => {
          const preview = formatLoadTime(d.delivery_date, d.delivery_minutes);
          const opts = d.delivery_date && !options.includes(d.delivery_date) ? [d.delivery_date, ...options] : options;
          return (
            <div
              key={d.load_number}
              className={`grid grid-cols-1 ${
                showCarrier
                  ? "sm:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)]"
                  : "sm:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]"
              } gap-2 items-center rounded-md border border-[var(--border)] p-2`}
            >
              <span className="text-sm font-semibold text-text">Load {d.load_number}</span>
              <select
                aria-label={`Load ${d.load_number} day`}
                value={d.delivery_date ?? ""}
                onChange={(e) => updateRow(d.load_number, { delivery_date: e.target.value || null })}
                disabled={readOnly}
                className={inputClass}
              >
                <option value="">— Day —</option>
                {opts.map((o) => (
                  <option key={o} value={o}>
                    {dayOptionLabel(o)}
                  </option>
                ))}
              </select>
              <input
                type="time"
                aria-label={`Load ${d.load_number} time`}
                value={minutesToInput(d.delivery_minutes)}
                onChange={(e) => updateRow(d.load_number, { delivery_minutes: inputToMinutes(e.target.value) })}
                disabled={readOnly}
                className={inputClass}
              />
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <span className={`text-sm tabular-nums ${preview ? "text-text font-semibold" : "text-muted"}`}>{preview || "No time"}</span>
                {d.changed_unacked ? (
                  <span
                    className={`${chipBase} border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)]`}
                    title={d.prev_display ? `was ${d.prev_display}` : undefined}
                  >
                    Changed by sheet
                  </span>
                ) : d.source === "sheet" ? (
                  <span className={`${chipBase} border border-[var(--border)] bg-[var(--ghost-bg)] text-text`}>Sheet</span>
                ) : d.source === "manual" ? (
                  <span className={`${chipBase} border border-[var(--border)] text-muted`}>Manual</span>
                ) : null}
              </div>
              {showCarrier && carriers && onCarriersChange && (() => {
                const explicit = carriers[d.load_number] ?? "";
                const split = explicit.trim() !== "" && normCarrier(explicit) !== normCarrier(defaultCarrier);
                return (
                  <div className="min-w-0">
                    <label
                      htmlFor={`${patternId}-carrier-${d.load_number}`}
                      className={`${labelClass} ${d.load_number === 1 ? "sm:block" : "sm:sr-only"}`}
                    >
                      Carrier
                    </label>
                    <div className="flex items-center gap-2">
                      <CarrierSelect
                        id={`${patternId}-carrier-${d.load_number}`}
                        value={explicit}
                        onChange={(v) => onCarriersChange({ ...carriers, [d.load_number]: v })}
                        placeholder={defaultCarrier?.trim() ? `Follow order (${defaultCarrier.trim()})` : "Follow order"}
                        disabled={readOnly}
                        className={inputClass}
                      />
                      {split && (
                        <span
                          className={`${chipBase} border border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info-text)]`}
                          title="This load ships on a different carrier than the order"
                        >
                          Split
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {droppedNote && (
        <p role="status" className="rounded border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] px-3 py-2 text-xs font-semibold">
          {droppedNote}
        </p>
      )}
      {readOnlyReason && <p className="text-xs text-muted">{readOnlyReason}</p>}
      <p className="text-[11px] text-muted">The schedule sheet updates these automatically and overrides manual times.</p>
    </div>
  );
}
