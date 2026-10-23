"use client";
// src/components/dashboard/RangeSelector.tsx — rpt-01
// Date-range segmented control for v2 Reports: This week (Mon → today, ET) · Last 7 days · Last 30
// days · Custom (two native date inputs, max = today). WeekSelector's exact classes, but every button
// is 44px tall (floor rule — WeekSelector's own fix is a separate BACKLOG item; it is untouched).
// Controlled: the parent holds { preset, from, to }; a Custom range is only emitted once it's valid
// (from ≤ to, ≤ MAX_RANGE_DAYS, not after today) — until then the inline error shows and the old
// range stays in force. Range maths: lib/reports/range.ts (calendar dates, DST-safe).
import { useEffect, useState } from "react";
import { presetRange, rangeLabel, validRange, type RangePreset } from "@/lib/reports/range";

export interface RangeValue { preset: RangePreset; from: string; to: string; }

interface Props {
  value: RangeValue;
  today: string;                       // ET YYYY-MM-DD (etNowWallClock().date)
  onChange: (next: RangeValue) => void;
}

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "this_week", label: "This week" },
  { key: "last_7", label: "Last 7 days" },
  { key: "last_30", label: "Last 30 days" },
  { key: "custom", label: "Custom" },
];

const DATE_INPUT =
  "min-h-[44px] px-3 rounded-lg border border-[var(--border)] bg-surface text-text text-xs font-mono tabular-nums focus:outline-hidden focus:border-[var(--brand)]";

export default function RangeSelector({ value, today, onChange }: Props) {
  const [draft, setDraft] = useState({ from: value.from, to: value.to });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft({ from: value.from, to: value.to });
  }, [value.from, value.to]);

  function pick(key: RangePreset) {
    setError(null);
    if (key === "custom") onChange({ ...value, preset: "custom" });
    else onChange({ preset: key, ...presetRange(key, today) });
  }

  function editCustom(next: { from: string; to: string }) {
    setDraft(next);
    if (!next.from || !next.to) return;
    if (next.to > today || next.from > today) {
      setError("Dates can't be in the future.");
      return;
    }
    const v = validRange(next.from, next.to);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setError(null);
    onChange({ preset: "custom", ...next });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] p-0.5 bg-[var(--ghost-bg)]" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => pick(p.key)}
            aria-pressed={value.preset === p.key}
            className={`min-h-[44px] px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              value.preset === p.key ? "bg-[var(--brand)] text-white shadow-xs" : "text-muted hover:text-text"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value.preset === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="range-from">From</label>
          <input
            id="range-from"
            type="date"
            className={DATE_INPUT}
            value={draft.from}
            max={today}
            onChange={(e) => editCustom({ ...draft, from: e.target.value })}
          />
          <span className="text-xs text-muted" aria-hidden="true">to</span>
          <label className="sr-only" htmlFor="range-to">To</label>
          <input
            id="range-to"
            type="date"
            className={DATE_INPUT}
            value={draft.to}
            max={today}
            onChange={(e) => editCustom({ ...draft, to: e.target.value })}
          />
        </div>
      )}
      <span className="text-xs font-medium text-text px-1 font-mono tabular-nums" aria-live="polite">
        {rangeLabel(value.from, value.to)}
      </span>
      {error && (
        <span role="alert" className="text-xs font-semibold text-[var(--danger-ink)]">
          {error}
        </span>
      )}
    </div>
  );
}
