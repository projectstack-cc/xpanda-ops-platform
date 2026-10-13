"use client";
// src/app/logistics/load-builder/ForceSizesList.tsx
// lbr-10: the Force sizes queue editor in the Load tab's Settings card (legacy parity: load-builder
// .html's forced-trailer rows — type select, count 1–10, ×, "+ Add trailer"). Presentational: the
// queue and its setter come from LoadPlanView via LoadTab. Every target is ≥ 44px; rows wrap at 390px.
import { Minus, Plus, Trash2 } from "lucide-react";
import { FORCED_COUNT_MAX, FORCED_COUNT_MIN, type ForcedTrailer } from "@/lib/forcedPack";
import { BTN_GHOST, SELECT } from "./loadBuilderUi";

interface ForceSizesListProps {
  queue: ForcedTrailer[];
  trailerTypeKeys: string[];
  /** The Settings card's trailer type — new rows start as this, and it carries anything left over. */
  defaultTypeKey: string;
  disabled: boolean;
  onChange: (next: ForcedTrailer[]) => void;
}

const STEP =
  "min-h-[44px] min-w-[44px] rounded-lg border border-[var(--border)] text-text flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";

export function forcedSummary(queue: ForcedTrailer[], defaultTypeKey: string): string {
  return `Will load: ${queue.map((f) => `${f.count} × ${f.type}`).join(" → ")}, then ${defaultTypeKey} for anything left.`;
}

export default function ForceSizesList({ queue, trailerTypeKeys, defaultTypeKey, disabled, onChange }: ForceSizesListProps) {
  const update = (i: number, patch: Partial<ForcedTrailer>) => onChange(queue.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="space-y-2" aria-label="Forced trucks, loaded in order">
      <ol className="space-y-2">
        {queue.map((f, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-5 text-xs font-mono tabular-nums text-muted" aria-hidden="true">
              {i + 1}.
            </span>
            <select
              value={f.type}
              onChange={(e) => update(i, { type: e.target.value })}
              disabled={disabled}
              aria-label={`Truck ${i + 1} type`}
              className={`${SELECT} min-w-0 flex-1 basis-40`}
            >
              {trailerTypeKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => update(i, { count: f.count - 1 })} disabled={disabled || f.count <= FORCED_COUNT_MIN} aria-label={`One fewer ${f.type}`} className={STEP}>
                <Minus size={16} aria-hidden="true" />
              </button>
              <span className="min-w-[32px] text-center text-sm font-semibold font-mono tabular-nums text-text" aria-label={`${f.count} trucks`}>
                {f.count}
              </span>
              <button type="button" onClick={() => update(i, { count: f.count + 1 })} disabled={disabled || f.count >= FORCED_COUNT_MAX} aria-label={`One more ${f.type}`} className={STEP}>
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => onChange(queue.filter((_, j) => j !== i))}
              disabled={disabled}
              aria-label={`Remove truck ${i + 1}`}
              className={`${STEP} text-[var(--danger-ink)] hover:bg-[color-mix(in_srgb,var(--danger-bg)_8%,transparent)]`}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => onChange([...queue, { type: defaultTypeKey, count: 1 }])} disabled={disabled} className={BTN_GHOST}>
        <Plus size={16} aria-hidden="true" /> Add truck
      </button>
      {queue.length > 0 ? (
        <p className="text-xs text-muted">{forcedSummary(queue, defaultTypeKey)}</p>
      ) : (
        <p className="text-xs text-muted">No trucks picked — the load uses {defaultTypeKey} as usual.</p>
      )}
    </div>
  );
}
