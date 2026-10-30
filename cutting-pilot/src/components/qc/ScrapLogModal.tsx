"use client";
// src/components/qc/ScrapLogModal.tsx — qc-04
// The /v2/qc Scrap log popup over the native scrap database (scrap_events). Two tabs:
//   Log scrap  — 1–20 entry cards saved in one all-or-nothing POST /v2/api/qc/scrap. INV # lookup
//                (GET /v2/api/qc/scrap/lookup, on blur / Enter) fills the Part select from the order's
//                lines (Holey Board included) and prefills size + density; a not-found INV saves with
//                no order link and a typed part. Amount = pieces × T × W × L, live bdft via scrapVolume.
//   This week  — the board's week (mondayStr), voided rows struck through; Void needs `qc` edit.
// Composes the shared Modal at xl. View-only users get This week only.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/components/Modal";
import { etNowWallClock } from "@/lib/etDateTime";
import type { Nominal } from "@/lib/qc/board";
import {
  MAX_ENTRIES,
  NOTES_MAX,
  SCRAP_LINES,
  SCRAP_REASONS,
  SHIFT_LABELS,
  SHIFT_VALUES,
  VOID_REASON_MAX,
  addDaysYmd,
  defaultShiftForEtMinutes,
  scrapVolume,
  validateScrapEntry,
  type ScrapRow,
  type ShiftValue,
} from "@/lib/qc/scrap";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  canEdit: boolean;
  mondayStr: string;
}

interface LookupLine {
  id: string;
  description: string;
  dimensions: string;
  quantity: number;
  density: string | null;
  category: string | null;
  nominal: Nominal;
}

interface LookupJob {
  id: string;
  invoice_number: string;
  customer: string;
  ship_date: string;
}

type Lookup =
  | { status: "idle" }
  | { status: "loading"; inv: string }
  | { status: "found"; inv: string; job: LookupJob; lines: LookupLine[] }
  | { status: "notfound"; inv: string }
  | { status: "error"; inv: string };

interface Draft {
  key: number;
  inv: string;
  lookup: Lookup;
  lineItemId: string;
  part: string;
  pieces: string;
  t: string;
  w: string;
  l: string;
  line: string;
  shift: ShiftValue;
  operator: string;
  density: string;
  reason: string;
  notes: string;
  date: string;
  serverErrors: string[];
}

const SHIFT_ORDINAL: Record<string, string> = { "1": "1st", "2": "2nd", "3": "3rd" };

let nextKey = 1;

function blankDraft(prev?: Draft): Draft {
  const now = etNowWallClock();
  return {
    key: nextKey++,
    inv: "",
    lookup: { status: "idle" },
    lineItemId: "",
    part: "",
    pieces: "",
    t: "",
    w: "",
    l: "",
    line: prev?.line ?? "",
    shift: prev?.shift ?? defaultShiftForEtMinutes(now.minutes),
    operator: prev?.operator ?? "",
    density: "",
    reason: "",
    notes: "",
    date: prev?.date ?? now.date,
    serverErrors: [],
  };
}

function toNum(v: string): number {
  const t = v.trim();
  return t === "" ? NaN : Number(t);
}

function numText(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? String(n) : "";
}

function partLabel(line: LookupLine): string {
  const dims = line.dimensions.trim();
  return dims ? `${line.description || "Part"} — ${dims}` : line.description || "Part";
}

function partProduct(d: Draft): string {
  if (d.lookup.status === "found" && d.lookup.lines.length) {
    const line = d.lookup.lines.find((x) => x.id === d.lineItemId);
    return line ? line.description.trim() || line.dimensions.trim() : "";
  }
  return d.part;
}

function linkedJobId(d: Draft): string | null {
  return d.lookup.status === "found" ? d.lookup.job.id : null;
}

function toEntry(d: Draft) {
  const jobId = linkedJobId(d);
  return {
    event_date: d.date,
    shift: d.shift,
    inv_number: d.inv,
    job_id: jobId,
    line_item_id: jobId && d.lineItemId ? d.lineItemId : null,
    line_machine: d.line,
    operator_name: d.operator,
    part_product: partProduct(d),
    material_density: d.density,
    pieces: toNum(d.pieces),
    thickness_in: toNum(d.t),
    width_in: toNum(d.w),
    length_in: toNum(d.l),
    scrap_reason: d.reason,
    notes: d.notes,
  };
}

function shortMsg(m: string): string {
  if (m === "Notes are required when the reason is Other.") return "reason Other needs a note";
  const s = m.replace(/\.$/, "");
  // Keep acronyms ("INV # is required") as written.
  return /^[A-Z][A-Z]/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

// Client-side problems for one card; [] = ready to save.
function draftProblems(d: Draft, today: string): string[] {
  const out: string[] = [];
  if (d.inv.trim() && (d.lookup.status === "idle" || d.lookup.status === "loading" || d.lookup.inv !== d.inv.trim())) {
    out.push("INV # not looked up yet");
  }
  if (d.lookup.status === "found" && d.lookup.lines.length && !d.lineItemId) out.push("pick a part");
  const r = validateScrapEntry(toEntry(d), today);
  if (!r.ok) {
    for (const m of r.errors) {
      if (m === "Part is required." && out.includes("pick a part")) continue;
      out.push(shortMsg(m));
    }
  }
  return out;
}

const SHIP_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
function shipLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || "");
  if (!m) return ymd || "no ship date";
  return SHIP_FMT.format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))).replace(",", "");
}

const RANGE_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
function rangeLabel(mondayStr: string): string {
  const toDate = (ymd: string) => {
    const [y, mo, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, d));
  };
  const start = toDate(mondayStr);
  const end = toDate(addDaysYmd(mondayStr, 6));
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  return `${RANGE_FMT.format(start)} – ${sameMonth ? end.getUTCDate() : RANGE_FMT.format(end)}`;
}

function mdLabel(ymd: string): string {
  const [, mo, d] = ymd.split("-").map(Number);
  return mo && d ? `${mo}/${d}` : ymd;
}

function fmtBdft(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function sourceLine(r: ScrapRow): string {
  if (r.voided_at) return `Voided by ${r.voided_by_name || "—"}${r.void_reason ? ` — ${r.void_reason}` : ""}`;
  if (r.source === "cutting") return "Cutting board";
  if (r.source === "legacy") return "Legacy form";
  return `QC · ${r.created_by_name || "—"}`;
}

const LABEL = "flex flex-col gap-1 min-w-0 text-xs font-semibold text-muted";
const INPUT =
  "w-full min-h-[44px] px-3 rounded-lg border border-[var(--border)] bg-surface text-text text-sm focus:outline-hidden focus:border-[var(--brand)]";
const MONO = "font-mono tabular-nums";
const BTN =
  "inline-flex items-center justify-center min-h-[44px] px-4 rounded-md border border-[var(--border)] bg-surface text-sm font-semibold text-text hover:bg-[var(--ghost-bg)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";
const BTN_PRIMARY =
  "inline-flex items-center justify-center min-h-[44px] px-5 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";
const CHIP = "inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border border-[var(--border)] bg-[var(--ghost-bg)] text-text whitespace-nowrap";

function EntryCard({
  d,
  n,
  canRemove,
  today,
  onPatch,
  onLookup,
  onRemove,
}: {
  d: Draft;
  n: number;
  canRemove: boolean;
  today: string;
  onPatch: (patch: Partial<Draft>) => void;
  onLookup: () => void;
  onRemove: () => void;
}) {
  const id = `scrap-${d.key}`;
  const vol = scrapVolume(toNum(d.pieces), toNum(d.t), toNum(d.w), toNum(d.l));
  const lk = d.lookup;
  const showSelect = lk.status === "found" && lk.lines.length > 0;

  function pickLine(lineId: string) {
    if (lk.status !== "found") return;
    const line = lk.lines.find((x) => x.id === lineId);
    if (!line) {
      onPatch({ lineItemId: "" });
      return;
    }
    onPatch({
      lineItemId: lineId,
      pieces: "1",
      t: numText(line.nominal.height),
      w: numText(line.nominal.width),
      l: numText(line.nominal.length),
      density: line.density ?? "",
    });
  }

  return (
    <section
      aria-labelledby={`${id}-h`}
      className={`rounded-xl border p-4 space-y-3 ${d.serverErrors.length ? "border-[var(--danger-ink)]" : "border-[var(--card-border)]"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={`${id}-h`} className="text-sm font-bold text-text">
          Entry {n}
        </h3>
        {canRemove && (
          <button type="button" onClick={onRemove} className={BTN} aria-label={`Remove entry ${n}`}>
            Remove
          </button>
        )}
      </div>

      {d.serverErrors.length > 0 && (
        <ul role="alert" className="rounded-lg border border-[var(--danger-ink)] bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs px-3 py-2 list-disc pl-6">
          {d.serverErrors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className={LABEL}>
          INV #
          <input
            id={`${id}-inv`}
            className={`${INPUT} ${MONO}`}
            value={d.inv}
            autoComplete="off"
            onChange={(e) => onPatch({ inv: e.target.value })}
            onBlur={onLookup}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onLookup();
              }
            }}
          />
        </label>
        <label className={`${LABEL} col-span-2 md:col-span-3`}>
          Part
          {showSelect ? (
            <select className={`${INPUT} cursor-pointer`} value={d.lineItemId} onChange={(e) => pickLine(e.target.value)}>
              <option value="">Select a part…</option>
              {lk.lines.map((line) => (
                <option key={line.id} value={line.id}>
                  {partLabel(line)}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={INPUT}
              value={d.part}
              autoComplete="off"
              maxLength={200}
              placeholder={lk.status === "idle" || lk.status === "loading" ? "Look up the INV # first, or type the part" : "Type the part / product"}
              onChange={(e) => onPatch({ part: e.target.value })}
            />
          )}
        </label>
      </div>
      {lk.status === "loading" && <p className="-mt-1 text-xs text-muted">Looking up INV {lk.inv}…</p>}
      {lk.status === "found" && (
        <p className="-mt-1 text-xs text-[var(--success-ink)]">
          {lk.job.customer || "—"} · ships {shipLabel(lk.job.ship_date)} · {lk.lines.length} {lk.lines.length === 1 ? "part" : "parts"}
        </p>
      )}
      {(lk.status === "notfound" || lk.status === "error") && (
        <p className="-mt-1 rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-xs px-2 py-1">
          {lk.status === "notfound" ? "Not on file — saved without an order link" : "Lookup failed — saved without an order link"}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
        <label className={LABEL}>
          Pieces
          <input className={`${INPUT} ${MONO}`} inputMode="numeric" value={d.pieces} onChange={(e) => onPatch({ pieces: e.target.value })} />
        </label>
        <label className={LABEL}>
          Thickness (in)
          <input className={`${INPUT} ${MONO}`} inputMode="decimal" value={d.t} onChange={(e) => onPatch({ t: e.target.value })} />
        </label>
        <label className={LABEL}>
          Width (in)
          <input className={`${INPUT} ${MONO}`} inputMode="decimal" value={d.w} onChange={(e) => onPatch({ w: e.target.value })} />
        </label>
        <label className={LABEL}>
          Length (in)
          <input className={`${INPUT} ${MONO}`} inputMode="decimal" value={d.l} onChange={(e) => onPatch({ l: e.target.value })} />
        </label>
        <div
          aria-live="polite"
          className="min-h-[44px] rounded-lg bg-[var(--ghost-bg)] px-3 py-1.5 flex flex-col justify-center"
          data-testid={`${id}-bdft`}
        >
          <span className={`${MONO} text-[15px] font-semibold text-text`}>{vol ? `${vol.boardFt.toFixed(3)} bdft` : "— bdft"}</span>
          <span className={`${MONO} text-[11px] text-muted`}>{vol ? `${vol.cubicIn.toLocaleString("en-US")} in³` : "— in³"}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <label className={LABEL}>
          Line / machine
          <select className={`${INPUT} cursor-pointer`} value={d.line} onChange={(e) => onPatch({ line: e.target.value })}>
            <option value="">Select…</option>
            {SCRAP_LINES.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Shift
          <select className={`${INPUT} cursor-pointer`} value={d.shift} onChange={(e) => onPatch({ shift: e.target.value as ShiftValue })}>
            {SHIFT_VALUES.map((s) => (
              <option key={s} value={s}>
                {SHIFT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Date
          <input type="date" className={`${INPUT} ${MONO}`} value={d.date} max={today} onChange={(e) => onPatch({ date: e.target.value })} />
        </label>
        <label className={LABEL}>
          Operator
          <input className={INPUT} value={d.operator} maxLength={100} autoComplete="off" onChange={(e) => onPatch({ operator: e.target.value })} />
        </label>
        <label className={LABEL}>
          Material / density
          <input className={INPUT} value={d.density} maxLength={100} autoComplete="off" onChange={(e) => onPatch({ density: e.target.value })} />
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className={LABEL}>
          Reason
          <select className={`${INPUT} cursor-pointer`} value={d.reason} onChange={(e) => onPatch({ reason: e.target.value })}>
            <option value="">Select…</option>
            {SCRAP_REASONS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className={`${LABEL} col-span-2 md:col-span-3`}>
          <span>
            Notes{d.reason === "Other" && <span className="text-[var(--danger-ink)]"> (required)</span>}
          </span>
          <input
            className={INPUT}
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

function VoidConfirm({
  row,
  onCancel,
  onDone,
}: {
  row: ScrapRow;
  onCancel: () => void;
  onDone: (patch: Pick<ScrapRow, "voided_at" | "voided_by_name" | "void_reason">) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/qc/scrap/${encodeURIComponent(row.id)}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error || `Couldn't void (HTTP ${res.status}).`);
        return;
      }
      onDone({ voided_at: json.voided_at, voided_by_name: json.voided_by_name, void_reason: json.void_reason });
    } catch {
      setError("Network error — couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="alertdialog" aria-labelledby="scrap-void-h" className="rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)] p-4 space-y-3">
      <h3 id="scrap-void-h" className="text-sm font-semibold text-[var(--warn-text)]">
        Void INV {row.inv_number} — {row.part_product} ({fmtBdft(row.scrap_board_ft)} bdft)?
      </h3>
      <p className="text-xs text-[var(--warn-text)]">It stays listed, struck through, and stops counting toward every total.</p>
      <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--warn-text)]">
        Reason (optional)
        <input className={INPUT} value={reason} maxLength={VOID_REASON_MAX} onChange={(e) => setReason(e.target.value)} autoFocus />
      </label>
      {error && (
        <p role="alert" className="text-xs text-[var(--danger-ink)]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={BTN} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={BTN_PRIMARY} onClick={confirm} disabled={busy} aria-busy={busy}>
          {busy ? "Voiding…" : "Void entry"}
        </button>
      </div>
    </div>
  );
}

function ScrapLogBody({
  canEdit,
  mondayStr,
  requestClose,
  setDirty,
}: {
  canEdit: boolean;
  mondayStr: string;
  requestClose: (force?: boolean) => void;
  setDirty: (dirty: boolean) => void;
}) {
  const [tab, setTab] = useState<"log" | "week">(canEdit ? "log" : "week");
  const [drafts, setDrafts] = useState<Draft[]>(() => [blankDraft()]);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rows, setRows] = useState<ScrapRow[] | null>(null);
  const [weekError, setWeekError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [voidTarget, setVoidTarget] = useState<ScrapRow | null>(null);
  const today = etNowWallClock().date;
  const lookupSeq = useRef(new Map<number, number>());

  const loadWeek = useCallback(async () => {
    setWeekError(null);
    try {
      const res = await fetch(`/v2/api/qc/scrap?week=${encodeURIComponent(mondayStr)}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setWeekError(json?.error || "Couldn't load this week's scrap.");
        return;
      }
      setRows(json.rows ?? []);
    } catch {
      setWeekError("Network error — couldn't reach the server.");
    }
  }, [mondayStr]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  const patch = useCallback(
    (key: number, p: Partial<Draft>) => {
      setDirty(true);
      setDrafts((prev) =>
        prev.map((d) => {
          if (d.key !== key) return d;
          const next = { ...d, ...p, serverErrors: [] };
          // Retyping the INV drops the old order link until it's looked up again.
          if (p.inv !== undefined && p.inv.trim() !== (d.lookup.status === "idle" ? "" : d.lookup.inv)) {
            next.lookup = { status: "idle" };
            next.lineItemId = "";
          }
          return next;
        })
      );
    },
    [setDirty]
  );

  const lookup = useCallback(async (key: number, invRaw: string) => {
    const inv = invRaw.trim();
    if (!inv) return;
    const seq = (lookupSeq.current.get(key) ?? 0) + 1;
    lookupSeq.current.set(key, seq);
    const set = (lk: Lookup) =>
      setDrafts((prev) => prev.map((d) => (d.key === key && lookupSeq.current.get(key) === seq ? { ...d, lookup: lk, lineItemId: "" } : d)));
    set({ status: "loading", inv });
    try {
      const res = await fetch(`/v2/api/qc/scrap/lookup?inv=${encodeURIComponent(inv)}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) set({ status: "error", inv });
      else if (!json.found) set({ status: "notfound", inv });
      else set({ status: "found", inv, job: json.job, lines: json.lines ?? [] });
    } catch {
      set({ status: "error", inv });
    }
  }, []);

  const problems = useMemo(
    () => drafts.flatMap((d, i) => draftProblems(d, today).map((m) => `Entry ${i + 1}: ${m}`)),
    [drafts, today]
  );
  const totalBdft = useMemo(
    () =>
      drafts.reduce((sum, d) => {
        const v = scrapVolume(toNum(d.pieces), toNum(d.t), toNum(d.w), toNum(d.l));
        return sum + (v ? v.boardFt : 0);
      }, 0),
    [drafts]
  );
  const n = drafts.length;
  const canSave = !busy && problems.length === 0;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setSaveError(null);
    try {
      const res = await fetch("/v2/api/qc/scrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: drafts.map(toEntry) }),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 201 && json?.ok) {
        const saved: ScrapRow[] = json.entries ?? [];
        setHighlight(new Set(saved.map((r) => r.id)));
        setDrafts([blankDraft(drafts[drafts.length - 1])]);
        setDirty(false);
        await loadWeek();
        setTab("week");
        return;
      }
      if (res.status === 400 && Array.isArray(json?.errors)) {
        const byIndex = new Map<number, string[]>();
        for (const e of json.errors) byIndex.set(Number(e.index), e.messages ?? []);
        setDrafts((prev) => prev.map((d, i) => (byIndex.has(i) ? { ...d, serverErrors: byIndex.get(i)! } : d)));
      }
      setSaveError(json?.error || `Couldn't save (HTTP ${res.status}).`);
    } catch {
      setSaveError("Network error — couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const live = rows?.filter((r) => !r.voided_at) ?? [];
  const weekBdft = live.reduce((s, r) => s + (Number(r.scrap_board_ft) || 0), 0);

  const tabCls = (on: boolean) =>
    `min-h-[44px] px-4 border-b-2 text-sm font-semibold cursor-pointer ${
      on ? "border-[var(--brand)] text-text" : "border-transparent text-muted hover:text-text"
    }`;

  return (
    <div className="space-y-4">
      <nav aria-label="Scrap log sections" role="tablist" className="-mt-2 flex gap-1 border-b border-[var(--line)]">
        {canEdit && (
          <button type="button" role="tab" aria-selected={tab === "log"} className={tabCls(tab === "log")} onClick={() => setTab("log")}>
            Log scrap
          </button>
        )}
        <button type="button" role="tab" aria-selected={tab === "week"} className={tabCls(tab === "week")} onClick={() => setTab("week")}>
          This week <span className={`${MONO} text-xs text-muted`}>({rows ? live.length : "…"})</span>
        </button>
      </nav>

      {tab === "log" && canEdit ? (
        <>
          <div className="space-y-3">
            {drafts.map((d, i) => (
              <EntryCard
                key={d.key}
                d={d}
                n={i + 1}
                canRemove={n > 1}
                today={today}
                onPatch={(p) => patch(d.key, p)}
                onLookup={() => {
                  const inv = d.inv.trim();
                  if (!inv) return;
                  if (d.lookup.status !== "idle" && d.lookup.inv === inv) return;
                  lookup(d.key, inv);
                }}
                onRemove={() => {
                  setDirty(true);
                  setDrafts((prev) => prev.filter((x) => x.key !== d.key));
                }}
              />
            ))}
            {n < MAX_ENTRIES && (
              <button
                type="button"
                className={BTN}
                onClick={() => {
                  setDirty(true);
                  setDrafts((prev) => [...prev, blankDraft(prev[prev.length - 1])]);
                }}
              >
                + Add another entry
              </button>
            )}
          </div>

          <div className="sticky -bottom-6 -mx-6 -mb-6 px-6 pt-3 pb-6 border-t border-[var(--line)] bg-surface space-y-2">
            {saveError && (
              <div role="alert" className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-3 py-2">
                {saveError}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className={`${MONO} text-sm text-muted`}>
                {n} {n === 1 ? "entry" : "entries"} · {fmtBdft(totalBdft)} bdft total
              </span>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button type="button" className={BTN} onClick={() => requestClose()}>
                  Cancel
                </button>
                <button type="button" className={BTN_PRIMARY} onClick={save} disabled={!canSave} aria-busy={busy}>
                  {busy ? "Saving…" : `Save ${n} ${n === 1 ? "entry" : "entries"}`}
                </button>
              </div>
            </div>
            {!busy && problems.length > 0 && (
              <p className="text-xs text-muted text-right" data-testid="scrap-problems">
                {problems.slice(0, 3).join(" · ")}
                {problems.length > 3 ? ` · +${problems.length - 3} more` : ""}
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-text">
              {rangeLabel(mondayStr)} · <span className={MONO}>{fmtBdft(weekBdft)} bdft</span> across {live.length}{" "}
              {live.length === 1 ? "entry" : "entries"}
            </span>
            <span className="text-xs text-muted">Voided entries stay listed, struck through, and don&apos;t count.</span>
          </div>

          {voidTarget && (
            <VoidConfirm
              row={voidTarget}
              onCancel={() => setVoidTarget(null)}
              onDone={(p) => {
                setRows((prev) => (prev ? prev.map((r) => (r.id === voidTarget.id ? { ...r, ...p } : r)) : prev));
                setVoidTarget(null);
              }}
            />
          )}

          {weekError ? (
            <div className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <span>{weekError}</span>
              <button type="button" className="min-h-[44px] px-3 underline font-semibold text-xs cursor-pointer" onClick={loadWeek}>
                Retry
              </button>
            </div>
          ) : !rows ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="rounded-lg border border-[var(--card-border)] p-6 text-center text-sm text-muted">No scrap logged this week.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--card-border)]">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="bg-[var(--ghost-bg)] text-left text-xs font-semibold text-muted">
                    <th className="px-3 py-2 whitespace-nowrap">Date · shift</th>
                    <th className="px-3 py-2">Line</th>
                    <th className="px-3 py-2">INV · part</th>
                    <th className="px-3 py-2 text-right">Pieces</th>
                    <th className="px-3 py-2 text-right">bdft</th>
                    <th className="px-3 py-2">Reason</th>
                    <th className="px-3 py-2">Operator</th>
                    <th className="px-3 py-2">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const voided = !!r.voided_at;
                    const strike = voided ? "line-through text-[var(--text-faint)]" : "";
                    return (
                      <tr
                        key={r.id}
                        data-voided={voided || undefined}
                        className={`border-t border-[var(--line)] align-middle ${highlight.has(r.id) ? "bg-[var(--info-bg)]" : ""}`}
                      >
                        <td className={`px-3 py-2 ${MONO} whitespace-nowrap ${strike}`}>
                          {mdLabel(r.event_date)} · {SHIFT_ORDINAL[r.shift] ?? r.shift}
                        </td>
                        <td className={`px-3 py-2 ${strike}`}>{r.line_machine}</td>
                        <td className={`px-3 py-2 ${strike}`}>
                          <span className={`${MONO} font-semibold`}>{r.inv_number}</span> · {r.part_product}
                        </td>
                        <td className={`px-3 py-2 text-right ${MONO} ${strike}`}>{r.pieces ?? "—"}</td>
                        <td className={`px-3 py-2 text-right ${MONO} ${strike}`}>{fmtBdft(Number(r.scrap_board_ft) || 0)}</td>
                        <td className={`px-3 py-2 ${strike}`}>
                          <span className={voided ? "" : CHIP}>{r.scrap_reason}</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={strike}>{r.operator_name}</span>
                          <div className="text-[11px] text-muted">{sourceLine(r)}</div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {voided ? (
                            <span className="text-xs text-muted">Voided</span>
                          ) : canEdit ? (
                            <button type="button" className={BTN} onClick={() => setVoidTarget(r)}>
                              Void
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ScrapLogModal({ isOpen, onClose, canEdit, mondayStr }: Props) {
  // Dirty lives here so the X (Modal routes it to onClose) confirms too. Backdrop and Escape no longer close (modal-01).
  const [dirty, setDirty] = useState(false);
  const requestClose = useCallback(
    (force = false) => {
      if (!force && dirty && !window.confirm("Discard the unsaved scrap entries?")) return;
      setDirty(false);
      onClose();
    },
    [dirty, onClose]
  );

  return (
    <Modal isOpen={isOpen} onClose={() => requestClose()} title="Scrap log" size="xl">
      <ScrapLogBody canEdit={canEdit} mondayStr={mondayStr} requestClose={requestClose} setDirty={setDirty} />
    </Modal>
  );
}
