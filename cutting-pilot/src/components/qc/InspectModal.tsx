"use client";
// src/components/qc/InspectModal.tsx — qc-02
// Per-line Final Inspection on /v2/qc: lot size → derived sample count (sampleSizeFor, legacy table),
// nominal L/W/H/taper pre-filled from the line (nominalFromLine, editable), tolerance (advisory only —
// the inspector still picks Pass/Fail per sample), and one card per sample. Submit POSTs to
// /v2/api/qc/inspections, which computes the overall result server-side. Composes the shared Modal;
// the form lives in a child Modal unmounts on close, so a reopen always starts fresh.
import { useCallback, useMemo, useState } from "react";
import { Check } from "lucide-react";
import Modal from "@/components/Modal";
import { formatEtDateTime } from "@/lib/etDateTime";
import {
  DEFAULT_TOLERANCE,
  TOLERANCES,
  isSampleComplete,
  nominalFromLine,
  outOfTolerance,
  sampleSizeFor,
  type QcLine,
  type QcLineInspection,
  type QcOrder,
} from "@/lib/qc/board";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  order: QcOrder;
  line: QcLine;
  inspectorName: string;
  onSaved: (lineId: string, inspection: QcLineInspection) => void;
}

interface SampleDraft {
  length: string;
  width: string;
  height: string;
  taper: string;
  visual_pass: boolean;
  result: "pass" | "fail" | null;
  notes: string;
}

const BLANK_SAMPLE: SampleDraft = { length: "", width: "", height: "", taper: "", visual_pass: true, result: null, notes: "" };

// Empty or unparsable → null (an incomplete sample, never an error while typing).
function toNum(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function numText(n: number | null): string {
  return n === null ? "" : String(n);
}

function parseLot(v: string): number | null {
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = parseInt(t, 10);
  return n >= 1 ? n : null;
}

// Grow-only: typing a lot passes through smaller values (17 → "2" → "20" → "200"), so drafts past
// the current N are kept off-screen rather than discarded; only the first N are shown and submitted.
function grow(samples: SampleDraft[], n: number): SampleDraft[] {
  if (samples.length >= n) return samples;
  return [...samples, ...Array.from({ length: n - samples.length }, () => ({ ...BLANK_SAMPLE }))];
}

function sampleForCheck(s: SampleDraft) {
  return { length: toNum(s.length), width: toNum(s.width), height: toNum(s.height), result: s.result };
}

function listNumbers(nums: number[]): string {
  return `${nums.length === 1 ? "Sample" : "Samples"} ${nums.join(", ")} incomplete`;
}

const LABEL = "block text-xs font-semibold text-muted";
const INPUT =
  "w-full min-h-[44px] px-3 rounded-lg border bg-surface text-text font-mono tabular-nums text-sm focus:outline-hidden focus:border-[var(--brand)]";
const READONLY = "min-h-[44px] flex items-center px-3 rounded-lg bg-[var(--ghost-bg)] text-sm text-text";

function NumField({
  id,
  label,
  value,
  onChange,
  warn,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  warn?: string | null;
}) {
  return (
    <div className="space-y-1 min-w-0">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={warn ? true : undefined}
        aria-describedby={warn ? `${id}-warn` : undefined}
        className={`${INPUT} ${warn ? "border-2 border-[var(--danger-ink)]" : "border-[var(--border)]"}`}
      />
      {warn && (
        <p id={`${id}-warn`} className="text-xs text-[var(--danger-ink)]">
          {warn}
        </p>
      )}
    </div>
  );
}

function InspectForm({ order, line, inspectorName, onSaved, requestClose, markDirty }: {
  order: QcOrder;
  line: QcLine;
  inspectorName: string;
  onSaved: Props["onSaved"];
  requestClose: (force?: boolean) => void;
  markDirty: () => void;
}) {
  const initialNominal = useMemo(() => nominalFromLine(line.dimensions, line.description), [line]);
  const [nowLabel] = useState(() => formatEtDateTime(new Date().toISOString()) ?? "—");
  const [lot, setLot] = useState(String(line.quantity || ""));
  const [nomL, setNomL] = useState(numText(initialNominal.length));
  const [nomW, setNomW] = useState(numText(initialNominal.width));
  const [nomH, setNomH] = useState(numText(initialNominal.height));
  const [nomTaper, setNomTaper] = useState(initialNominal.taper ?? "");
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
  // n = sample count for the last valid lot; drafts holds at least n entries.
  const [n, setN] = useState(() => sampleSizeFor(parseLot(String(line.quantity || "")) ?? NaN) ?? 0);
  const [drafts, setDrafts] = useState<SampleDraft[]>(() => grow([], n));
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lotNum = parseLot(lot);
  const required = lotNum === null ? null : sampleSizeFor(lotNum);
  const samples = drafts.slice(0, n);
  const current = samples[Math.min(active, samples.length - 1)];
  const activeIdx = Math.min(active, Math.max(samples.length - 1, 0));

  const incomplete = samples.map((s, i) => (isSampleComplete(sampleForCheck(s)) ? 0 : i + 1)).filter(Boolean);
  const canSubmit = !busy && lotNum !== null && samples.length > 0 && incomplete.length === 0;

  function changeLot(v: string) {
    markDirty();
    setLot(v);
    const parsed = parseLot(v);
    if (parsed !== null) {
      const size = sampleSizeFor(parsed) ?? 0;
      setN(size);
      setDrafts((prev) => grow(prev, size));
      setActive((a) => Math.min(a, Math.max(size - 1, 0)));
    }
  }

  function patchSample(patch: Partial<SampleDraft>) {
    markDirty();
    setDrafts((prev) => prev.map((s, i) => (i === activeIdx ? { ...s, ...patch } : s)));
  }

  const nomNums = { length: toNum(nomL), width: toNum(nomW), height: toNum(nomH) };
  function tolWarn(measured: string, nominal: number | null): string | null {
    return outOfTolerance(toNum(measured), nominal, tolerance) ? `±${tolerance} over nominal` : null;
  }

  async function submit() {
    if (!canSubmit || lotNum === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/v2/api/qc/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_item_id: line.id,
          lot_size: lotNum,
          tolerance_in: tolerance,
          nominal: { length: nomNums.length, width: nomNums.width, height: nomNums.height, taper: nomTaper.trim() || null },
          samples: samples.map((s) => ({
            length: toNum(s.length),
            width: toNum(s.width),
            height: toNum(s.height),
            taper: s.taper.trim() || null,
            visual_pass: s.visual_pass,
            result: s.result,
            notes: s.notes.trim() || null,
          })),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error || `Couldn't save the inspection (HTTP ${res.status}).`);
        return;
      }
      onSaved(line.id, json.inspection as QcLineInspection);
      requestClose(true);
    } catch {
      setError("Network error — couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="-mt-3 text-xs text-muted font-mono tabular-nums">
        INV {order.invoice_number || "—"} · {order.customer || "—"}
      </p>

      {/* Header grid — 2 cols on phone, 4 on desktop */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="space-y-1 min-w-0">
          <span className={LABEL}>Inspector</span>
          <div className={`${READONLY} truncate`}>{inspectorName || "—"}</div>
        </div>
        <div className="space-y-1 min-w-0">
          <span className={LABEL}>Date / time (ET)</span>
          <div className={`${READONLY} font-mono tabular-nums`}>{nowLabel}</div>
        </div>
        <NumField
          id="qc-insp-lot"
          label="Lot size"
          value={lot}
          onChange={changeLot}
          warn={lotNum === null ? "Enter a whole number ≥ 1." : null}
        />
        <div className="space-y-1 min-w-0">
          <span className={LABEL}>Samples required</span>
          <div className={`${READONLY} font-mono tabular-nums`}>{required ?? "—"}</div>
        </div>
      </div>

      {/* Nominal row */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-text">Nominal</legend>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <NumField id="qc-nom-l" label="Length (in)" value={nomL} onChange={(v) => { markDirty(); setNomL(v); }} />
          <NumField id="qc-nom-w" label="Width (in)" value={nomW} onChange={(v) => { markDirty(); setNomW(v); }} />
          <NumField id="qc-nom-h" label="Height (in)" value={nomH} onChange={(v) => { markDirty(); setNomH(v); }} />
          <div className="space-y-1 min-w-0">
            <label htmlFor="qc-nom-taper" className={LABEL}>
              Taper
            </label>
            <input
              id="qc-nom-taper"
              type="text"
              autoComplete="off"
              value={nomTaper}
              onChange={(e) => { markDirty(); setNomTaper(e.target.value); }}
              className={`${INPUT} border-[var(--border)]`}
            />
          </div>
          <div className="space-y-1 min-w-0 col-span-2 md:col-span-1">
            <label htmlFor="qc-nom-tol" className={LABEL}>
              Tolerance
            </label>
            <select
              id="qc-nom-tol"
              value={tolerance}
              onChange={(e) => { markDirty(); setTolerance(Number(e.target.value)); }}
              className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--border)] bg-surface text-text text-sm cursor-pointer focus:outline-hidden focus:border-[var(--brand)]"
            >
              {TOLERANCES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      {/* Sample card */}
      {current ? (
        <section className="rounded-xl border border-[var(--card-border)] p-4 space-y-4" aria-labelledby="qc-sample-heading">
          <h3 id="qc-sample-heading" className="text-sm font-semibold text-text">
            Sample {activeIdx + 1} of {samples.length}
          </h3>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Samples">
            {samples.map((s, i) => {
              const done = isSampleComplete(sampleForCheck(s));
              const isActive = i === activeIdx;
              const cls = isActive
                ? "bg-[var(--primary-bg)] text-[var(--primary-text)] border-[var(--primary-bg)]"
                : done
                ? "bg-[var(--loaded-bg)] text-[var(--loaded-text)] border-[var(--loaded-border)]"
                : "bg-surface text-text border-[var(--border)] hover:bg-[var(--ghost-bg)]";
              return (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`Sample ${i + 1}${done ? ", complete" : ", incomplete"}`}
                  onClick={() => setActive(i)}
                  className={`inline-flex items-center justify-center gap-1 min-w-[44px] min-h-[44px] px-2 rounded-lg border text-sm font-semibold font-mono tabular-nums cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${cls}`}
                >
                  {i + 1}
                  {done && <Check size={12} aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <NumField id="qc-s-l" label="Length (in)" value={current.length} onChange={(v) => patchSample({ length: v })} warn={tolWarn(current.length, nomNums.length)} />
            <NumField id="qc-s-w" label="Width (in)" value={current.width} onChange={(v) => patchSample({ width: v })} warn={tolWarn(current.width, nomNums.width)} />
            <NumField id="qc-s-h" label="Height (in)" value={current.height} onChange={(v) => patchSample({ height: v })} warn={tolWarn(current.height, nomNums.height)} />
            <div className="space-y-1 min-w-0">
              <label htmlFor="qc-s-taper" className={LABEL}>
                Taper
              </label>
              <input
                id="qc-s-taper"
                type="text"
                autoComplete="off"
                value={current.taper}
                onChange={(e) => patchSample({ taper: e.target.value })}
                className={`${INPUT} border-[var(--border)]`}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 min-h-[44px] text-sm text-text cursor-pointer">
              <input
                type="checkbox"
                checked={current.visual_pass}
                onChange={(e) => patchSample({ visual_pass: e.target.checked })}
                className="w-5 h-5 cursor-pointer accent-[var(--brand)]"
              />
              Visual / surface OK
            </label>
            <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5 bg-[var(--ghost-bg)]" role="group" aria-label="Sample result">
              <button
                type="button"
                aria-pressed={current.result === "pass"}
                onClick={() => patchSample({ result: "pass" })}
                className={`min-h-[44px] min-w-[72px] px-4 rounded-md text-sm font-semibold border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  current.result === "pass"
                    ? "bg-[var(--loaded-bg)] text-[var(--loaded-text)] border-[var(--loaded-border)]"
                    : "border-transparent text-muted hover:text-text"
                }`}
              >
                Pass
              </button>
              <button
                type="button"
                aria-pressed={current.result === "fail"}
                onClick={() => patchSample({ result: "fail" })}
                className={`min-h-[44px] min-w-[72px] px-4 rounded-md text-sm font-semibold border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  current.result === "fail"
                    ? "bg-surface text-[var(--danger-ink)] border-[var(--danger-ink)]"
                    : "border-transparent text-muted hover:text-text"
                }`}
              >
                Fail
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="qc-s-notes" className={LABEL}>
              Notes
            </label>
            <textarea
              id="qc-s-notes"
              rows={2}
              maxLength={500}
              value={current.notes}
              onChange={(e) => patchSample({ notes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-surface text-text text-sm focus:outline-hidden focus:border-[var(--brand)]"
            />
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted">Enter a lot size to set up the samples.</p>
      )}

      {/* Footer */}
      <div className="space-y-3 pt-3 border-t border-[var(--line)]">
        <p className="text-xs text-muted">
          Saves to the platform, then files the inspection PDF to the customer's Drive folder (usually within a minute).
        </p>
        {error && (
          <div role="alert" className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-3 py-2">
            {error}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!canSubmit && !busy && incomplete.length > 0 && (
            <span className="text-xs text-muted mr-auto font-mono tabular-nums">{listNumbers(incomplete)}</span>
          )}
          <button
            type="button"
            onClick={() => requestClose()}
            className="min-h-[44px] px-4 rounded-md border border-[var(--border)] bg-surface text-sm font-semibold text-text hover:bg-[var(--ghost-bg)] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="min-h-[44px] px-5 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Saving…" : "Submit inspection"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function InspectModal({ isOpen, onClose, order, line, inspectorName, onSaved }: Props) {
  // Dirty lives here (not in the form) so Escape / backdrop / X — which Modal routes to onClose — confirm too.
  const [dirty, setDirty] = useState(false);
  const requestClose = useCallback(
    (force = false) => {
      if (!force && dirty && !window.confirm("Discard this inspection?")) return;
      setDirty(false);
      onClose();
    },
    [dirty, onClose]
  );
  const markDirty = useCallback(() => setDirty(true), []);

  return (
    <Modal isOpen={isOpen} onClose={() => requestClose()} title={`Inspect — ${line.description || "line"}`} size="xl">
      <InspectForm
        key={line.id}
        order={order}
        line={line}
        inspectorName={inspectorName}
        onSaved={onSaved}
        requestClose={requestClose}
        markDirty={markDirty}
      />
    </Modal>
  );
}
