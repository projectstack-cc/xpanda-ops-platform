"use client";
// src/components/qc/CuttingScrapSection.tsx — qc-05
// Optional scrap capture on the cutting board (Main Line / Blue Line), inside CompleteLineModal and
// HandoffModal. Controlled — the parent modal owns the draft. Collapsed by default ("+ Log scrap
// (optional)"); removing the last entry collapses it again. The operator picks a part from the job's
// line items (size + density prefill via nominalFromLine, same mapping as the /v2/qc popup) or types
// one ("Other / not on the order"); date, INV, line and operator are filled in by the server
// (POST /v2/api/cutting/scrap). The card is built here rather than shared with ScrapLogModal's
// EntryCard, which is tied to the popup's INV lookup / date / operator / line fields.
import { nominalFromLine } from "@/lib/qc/board";
import { NOTES_MAX, MAX_ENTRIES, SCRAP_REASONS, SHIFT_LABELS, SHIFT_VALUES, scrapVolume, type ShiftValue } from "@/lib/qc/scrap";
import { OTHER_PART, blankScrapEntry, type CuttingScrapDraft, type DraftEntry } from "@/lib/qc/cuttingScrap";
import type { CuttingLineItem } from "@/app/cutting/types";

export {
  emptyCuttingScrapDraft,
  cuttingScrapProblems,
  toCuttingScrapEntries,
  draftHasEntries,
  type CuttingScrapDraft,
} from "@/lib/qc/cuttingScrap";

interface Props {
  lineItems: CuttingLineItem[];
  value: CuttingScrapDraft;
  onChange: (v: CuttingScrapDraft) => void;
  disabled?: boolean;
  // Display-only context line — the server fills these in.
  line: string;
  invoice: string;
  operatorName: string;
}

const LABEL = "flex flex-col gap-1 min-w-0 text-xs font-semibold text-muted";
const INPUT =
  "w-full min-h-[44px] px-3 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50";
const MONO = "font-mono tabular-nums";
const GHOST =
  "inline-flex items-center justify-center min-h-[44px] px-4 rounded border border-border bg-[var(--ghost-bg)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] disabled:opacity-50 disabled:cursor-not-allowed";

function toNum(v: string): number {
  const t = v.trim();
  return t === "" ? NaN : Number(t);
}

function numText(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? String(n) : "";
}

function partLabel(it: CuttingLineItem): string {
  const desc = it.description.trim() || it.part_number.trim() || "Part";
  const dims = it.dimensions.trim();
  return dims ? `${desc} — ${dims}` : desc;
}

function EntryCard({
  d,
  n,
  lineItems,
  disabled,
  onPatch,
  onRemove,
}: {
  d: DraftEntry;
  n: number;
  lineItems: CuttingLineItem[];
  disabled?: boolean;
  onPatch: (patch: Partial<DraftEntry>) => void;
  onRemove: () => void;
}) {
  const id = `cut-scrap-${d.key}`;
  const vol = scrapVolume(toNum(d.pieces), toNum(d.t), toNum(d.w), toNum(d.l));

  function pickPart(value: string) {
    if (value === OTHER_PART || value === "") {
      onPatch({ lineItemId: value, part: "" });
      return;
    }
    const it = lineItems.find((x) => x.id === value);
    if (!it) return;
    const nominal = nominalFromLine(it.dimensions, it.description);
    onPatch({
      lineItemId: it.id,
      part: it.description.trim() || it.dimensions.trim(),
      pieces: "1",
      t: numText(nominal.height),
      w: numText(nominal.width),
      l: numText(nominal.length),
      density: it.density ?? "",
    });
  }

  return (
    <section aria-labelledby={`${id}-h`} className="rounded border border-border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 id={`${id}-h`} className="text-sm font-bold text-text">
          Entry {n}
        </h4>
        <button type="button" disabled={disabled} onClick={onRemove} className={GHOST} aria-label={`Remove scrap entry ${n}`}>
          Remove
        </button>
      </div>

      <label className={LABEL}>
        Part
        <select className={`${INPUT} cursor-pointer`} disabled={disabled} value={d.lineItemId} onChange={(e) => pickPart(e.target.value)}>
          <option value="">Select a part…</option>
          {lineItems.map((it) => (
            <option key={it.id} value={it.id}>
              {partLabel(it)}
            </option>
          ))}
          <option value={OTHER_PART}>Other / not on the order</option>
        </select>
      </label>
      {d.lineItemId === OTHER_PART && (
        <label className={LABEL}>
          Part / product
          <input
            className={INPUT}
            disabled={disabled}
            value={d.part}
            maxLength={200}
            autoComplete="off"
            placeholder="Type the part / product"
            onChange={(e) => onPatch({ part: e.target.value })}
          />
        </label>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className={LABEL}>
          Pieces
          <input className={`${INPUT} ${MONO}`} disabled={disabled} inputMode="numeric" value={d.pieces} onChange={(e) => onPatch({ pieces: e.target.value })} />
        </label>
        <label className={LABEL}>
          Thickness (in)
          <input className={`${INPUT} ${MONO}`} disabled={disabled} inputMode="decimal" value={d.t} onChange={(e) => onPatch({ t: e.target.value })} />
        </label>
        <label className={LABEL}>
          Width (in)
          <input className={`${INPUT} ${MONO}`} disabled={disabled} inputMode="decimal" value={d.w} onChange={(e) => onPatch({ w: e.target.value })} />
        </label>
        <label className={LABEL}>
          Length (in)
          <input className={`${INPUT} ${MONO}`} disabled={disabled} inputMode="decimal" value={d.l} onChange={(e) => onPatch({ l: e.target.value })} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 items-end">
        <label className={LABEL}>
          Material / density
          <input className={INPUT} disabled={disabled} value={d.density} maxLength={100} autoComplete="off" onChange={(e) => onPatch({ density: e.target.value })} />
        </label>
        <div
          aria-live="polite"
          className="min-h-[44px] rounded bg-[var(--ghost-bg)] px-3 py-1.5 flex flex-col justify-center"
          data-testid={`${id}-bdft`}
        >
          <span className={`${MONO} text-[15px] font-semibold text-text`}>{vol ? `${vol.boardFt.toFixed(3)} bdft` : "— bdft"}</span>
          <span className={`${MONO} text-[11px] text-muted`}>{vol ? `${vol.cubicIn.toLocaleString("en-US")} in³` : "— in³"}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className={LABEL}>
          Reason
          <select className={`${INPUT} cursor-pointer`} disabled={disabled} value={d.reason} onChange={(e) => onPatch({ reason: e.target.value })}>
            <option value="">Select…</option>
            {SCRAP_REASONS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          <span>
            Notes{d.reason === "Other" && <span className="text-[var(--danger-ink)]"> (required)</span>}
          </span>
          <input
            className={INPUT}
            disabled={disabled}
            value={d.notes}
            maxLength={NOTES_MAX}
            placeholder="Optional unless reason is Other"
            onChange={(e) => onPatch({ notes: e.target.value })}
          />
        </label>
      </div>
    </section>
  );
}

export default function CuttingScrapSection({ lineItems, value, onChange, disabled, line, invoice, operatorName }: Props) {
  if (!value.open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange({ ...value, open: true, entries: [blankScrapEntry()] })}
        className={`${GHOST} w-full`}
      >
        + Log scrap (optional)
      </button>
    );
  }

  function patchEntry(key: number, patch: Partial<DraftEntry>) {
    onChange({ ...value, entries: value.entries.map((e) => (e.key === key ? { ...e, ...patch } : e)) });
  }

  function removeEntry(key: number) {
    const entries = value.entries.filter((e) => e.key !== key);
    onChange({ ...value, open: entries.length > 0, entries });
  }

  return (
    <div className="rounded border border-border px-3 py-3 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-text">Scrap</h3>
        <p className="text-xs text-muted">
          {line} · INV <span className={MONO}>{invoice || "—"}</span> · {operatorName || "—"} · today
        </p>
      </div>

      <label className={`${LABEL} max-w-[16rem]`}>
        Shift
        <select
          className={`${INPUT} cursor-pointer`}
          disabled={disabled}
          value={value.shift}
          onChange={(e) => onChange({ ...value, shift: e.target.value as ShiftValue })}
        >
          {SHIFT_VALUES.map((s) => (
            <option key={s} value={s}>
              {SHIFT_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      {value.entries.map((d, i) => (
        <EntryCard
          key={d.key}
          d={d}
          n={i + 1}
          lineItems={lineItems}
          disabled={disabled}
          onPatch={(p) => patchEntry(d.key, p)}
          onRemove={() => removeEntry(d.key)}
        />
      ))}

      {value.entries.length < MAX_ENTRIES && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...value, entries: [...value.entries, blankScrapEntry()] })}
          className={GHOST}
        >
          + Add another
        </button>
      )}
    </div>
  );
}

/** Inline problems under the section — the primary button stops here until they're fixed. */
export function CuttingScrapProblems({ problems }: { problems: string[] }) {
  if (!problems.length) return null;
  return (
    <ul role="alert" className="rounded border border-[var(--danger-ink)] bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs px-3 py-2 list-disc pl-6">
      {problems.map((m, i) => (
        <li key={i}>{m}</li>
      ))}
    </ul>
  );
}

/** Scrap POST failed: Retry, or Continue without scrap (discards the entries, runs the normal flow). */
export function CuttingScrapSaveError({
  error,
  busy,
  onRetry,
  onSkip,
}: {
  error: string;
  busy: boolean;
  onRetry: () => void;
  onSkip: () => void;
}) {
  return (
    <div role="alert" className="rounded border border-[var(--danger-ink)] bg-[var(--danger-bg)] text-[var(--danger-text)] px-3 py-2 space-y-2">
      <p className="text-sm">
        <span className="font-semibold">Scrap not saved.</span> {error}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={onRetry} className={GHOST}>
          Retry
        </button>
        <button type="button" disabled={busy} onClick={onSkip} className={GHOST}>
          Continue without scrap
        </button>
      </div>
    </div>
  );
}
