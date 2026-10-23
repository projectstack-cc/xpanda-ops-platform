"use client";
// src/components/marina/PartInspect.tsx — marina-06
// /v2/qc/marina/parts/[partId] — one Marina part at the block: header (label, job link, ±tolerance,
// tallies, callout notes, collapsible cut-sheet page), the pieces list with full attempt history, and
// "Inspect next piece" → MeasurePanel. Mutations render from the response ({ piece, part } summary
// merged into the loaded detail); delete drops the piece locally. Completed jobs / view-only users see
// everything with no actions.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import { formatEtDateTime } from "@/lib/etDateTime";
import { formatInches } from "@/lib/inches";
import type { MarinaPartDetail, MarinaPartSummary, MarinaPiece } from "@/lib/marina/types";
import MeasurePanel, { type MeasureMode } from "./MeasurePanel";
import PageCanvas, { useMarinaPdf } from "./PageCanvas";
import TallyChips from "./TallyChips";
import { STATUS_CHIP, STATUS_LABEL, attemptsOf, deviationText, lastMeasurement } from "./pieceUi";
import {
  CARD, DANGER, ERROR_TEXT, GHOST, PRIMARY, REWORK_BADGE, TEXTAREA, jsonInit, marinaFetch, plural,
} from "./ui";

interface Props {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
  canEdit: boolean;
  partId: string;
}

const upsertPiece = (pieces: MarinaPiece[], p: MarinaPiece) =>
  [...pieces.filter((x) => x.id !== p.id), p].sort((a, b) => a.piece_no - b.piece_no);

export default function PartInspect({ userName, isAdmin, permissions, canEdit, partId }: Props) {
  const [part, setPart] = useState<MarinaPartDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<MeasureMode | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [after, setAfter] = useState<{ pieceNo: number } | null>(null);
  const [showSheet, setShowSheet] = useState(false);

  const load = useCallback(async () => {
    const r = await marinaFetch<{ part: MarinaPartDetail }>(`/parts/${encodeURIComponent(partId)}`);
    if (!r.ok) {
      if (r.status === 404) setNotFound(true);
      else setLoadError(r.error);
      return;
    }
    setLoadError(null);
    setPart(r.data.part);
  }, [partId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const { pdf, error: pdfError } = useMarinaPdf(showSheet && part?.file ? part.file.id : null);

  // Merge a { piece?, part } response (part is a summary — keep job / file / pieces).
  const apply = useCallback((summary: MarinaPartSummary | null | undefined, piece?: MarinaPiece, removedId?: string) => {
    setPart((cur) => {
      if (!cur) return cur;
      let pieces = cur.pieces;
      if (piece) pieces = upsertPiece(pieces, piece);
      if (removedId) pieces = pieces.filter((x) => x.id !== removedId);
      return { ...cur, ...(summary ?? {}), job: cur.job, file: cur.file, pieces };
    });
  }, []);

  const header = (
    <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Quality Control · v2" currentPath="/v2/qc" />
  );

  if (notFound || loadError || !part) {
    return (
      <div className="min-h-screen flex flex-col bg-bg text-text">
        {header}
        <div className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 space-y-4">
          <a href="/v2/qc/marina" className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-[var(--link)] no-underline">
            <ArrowLeft size={16} aria-hidden="true" /> Marina Foam jobs
          </a>
          {notFound ? (
            <div className={`${CARD} space-y-1`}>
              <h1 className="text-lg font-bold">Part not found</h1>
              <p className="text-sm text-muted">It may have been deleted.</p>
            </div>
          ) : loadError ? (
            <div role="alert" className={`${CARD} space-y-3`}>
              <p className={ERROR_TEXT}>{loadError}</p>
              <button type="button" className={GHOST} onClick={() => { setLoadError(null); load(); }}>Retry</button>
            </div>
          ) : (
            <div className={`${CARD} space-y-2 animate-pulse`} aria-busy="true" aria-label="Loading part">
              <div className="h-6 w-1/2 rounded bg-[var(--ghost-bg)]" />
              <div className="h-4 w-1/3 rounded bg-[var(--ghost-bg)]" />
            </div>
          )}
        </div>
      </div>
    );
  }

  const jobHref = `/v2/qc/marina/${encodeURIComponent(part.job.id)}`;
  const editable = canEdit && part.job.status === "open";
  const nextNo = part.pieces.reduce((m, p) => Math.max(m, p.piece_no), 0) + 1;
  const canInspect = editable && part.dims.length > 0;

  function onSaved(piece: MarinaPiece, summary: MarinaPartSummary) {
    const wasNew = panel?.kind === "new";
    apply(summary, piece);
    setPanel(null);
    setDirty(false);
    setToast(`#${piece.piece_no} — ${STATUS_LABEL[piece.status]}`);
    setAfter(wasNew ? { pieceNo: piece.piece_no } : null);
  }

  function openNew() {
    setAfter(null);
    setToast(null);
    setPanel({ kind: "new", pieceNo: nextNo });
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      {header}
      <div className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 space-y-4 min-w-0">
        <a
          href={jobHref}
          onClick={(e) => {
            if (dirty) {
              e.preventDefault();
              setConfirmLeave(true);
            }
          }}
          className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-[var(--link)] no-underline"
        >
          <ArrowLeft size={16} aria-hidden="true" /> Back to job
        </a>
        {confirmLeave && (
          <div role="alert" className="rounded-lg border border-[var(--info-border)] bg-[var(--info-bg)] p-3 space-y-2">
            <p className="text-sm font-semibold text-[var(--info-text)]">This piece has unsaved values — leave without saving?</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setConfirmLeave(false)}>Stay</button>
              <a href={jobHref} className={`${PRIMARY} no-underline`}>Leave</a>
            </div>
          </div>
        )}

        <section className={`${CARD} space-y-3`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h1 className="text-3xl font-bold tracking-tight break-words">{part.label}</h1>
              <a href={jobHref} className="block text-sm font-semibold text-[var(--link)] no-underline break-words">
                {part.job.name}{part.job.customer ? ` · ${part.job.customer}` : ""}
              </a>
              <p className="text-sm text-text">
                Tolerance <span className="font-bold">±{formatInches(part.job.tolerance_in)}&quot;</span>
                {part.dims.length > 0 && (
                  <span className="text-muted"> · {part.dims.map((d) => `${d.label} ${d.nominal_text ?? formatInches(d.nominal_in)}`).join(" · ")}</span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <TallyChips tallies={part.tallies} />
              {part.tallies.rework_pending > 0 && <span className={REWORK_BADGE}>{part.tallies.rework_pending} rework pending</span>}
            </div>
          </div>
          {part.notes && (
            <p className="rounded-lg border-2 border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info-text)] text-base font-bold px-3 py-2 whitespace-pre-wrap break-words">
              {part.notes}
            </p>
          )}
          {part.job.status !== "open" && (
            <p role="status" className="text-sm font-semibold text-muted">This job is complete — reopen it to inspect.</p>
          )}
          {part.file && (
            <div className="space-y-2">
              <button
                type="button"
                className={GHOST}
                aria-expanded={showSheet}
                onClick={() => setShowSheet((v) => !v)}
              >
                {showSheet ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                View cut sheet{part.page_no ? ` (page ${part.page_no})` : ""}
              </button>
              {showSheet && (
                pdfError ? <p className={ERROR_TEXT}>{pdfError}</p>
                  : pdf ? <PageCanvas pdf={pdf} pageNo={part.page_no ?? 1} />
                    : <p className="text-sm text-muted animate-pulse">Opening the cut sheet…</p>
              )}
            </div>
          )}
        </section>

        {toast && (
          <p role="status" className="rounded-lg border border-[var(--loaded-border)] bg-[var(--loaded-bg)] text-[var(--loaded-text)] text-base font-bold px-4 py-3">
            {toast}
          </p>
        )}

        {panel ? (
          <section className={`${CARD} min-w-0`}>
            <MeasurePanel
              partId={part.id}
              partLabel={part.label}
              dims={part.dims}
              tolerance={part.job.tolerance_in}
              mode={panel}
              onSaved={onSaved}
              onCancel={() => setPanel(null)}
              onDirtyChange={setDirty}
            />
          </section>
        ) : canInspect ? (
          after ? (
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <button type="button" className={`${PRIMARY} min-h-[64px] text-lg`} onClick={openNew}>Inspect another #{nextNo}</button>
              <button type="button" className={`${GHOST} min-h-[64px] text-lg`} onClick={() => setAfter(null)}>Done</button>
            </div>
          ) : (
            <button type="button" className={`${PRIMARY} w-full min-h-[64px] text-lg`} onClick={openNew}>
              Inspect next piece (#{nextNo})
            </button>
          )
        ) : editable && part.dims.length === 0 ? (
          <p className={`${CARD} text-sm text-muted`}>This part has no dims yet — add them from the job page.</p>
        ) : null}

        <section className={`${CARD} space-y-3`} aria-labelledby="marina-pieces">
          <h2 id="marina-pieces" className="text-base font-bold">Pieces ({part.pieces.length})</h2>
          {part.pieces.length === 0 ? (
            <p className="text-sm text-muted">No pieces measured yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {part.pieces.map((p) => (
                <PieceRow
                  key={p.id}
                  piece={p}
                  part={part}
                  editable={editable && !panel}
                  onRemeasure={() => { setAfter(null); setToast(null); setPanel({ kind: "remeasure", piece: p }); }}
                  onApplied={apply}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function PieceRow({
  piece, part, editable, onRemeasure, onApplied,
}: {
  piece: MarinaPiece;
  part: MarinaPartDetail;
  editable: boolean;
  onRemeasure: () => void;
  onApplied: (summary: MarinaPartSummary | null | undefined, piece?: MarinaPiece, removedId?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"none" | "note" | "delete" | "status">("none");
  const [note, setNote] = useState(piece.disposition_note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = lastMeasurement(piece);
  const dimName = new Map(part.dims.map((d) => [d.id, d.label]));
  const correction = piece.status === "rework_pending" ? "scrapped" : piece.status === "scrapped" ? "rework_pending" : null;

  async function act(path: string, init: RequestInit, onOk: (data: any) => void) {
    setBusy(true);
    setError(null);
    const r = await marinaFetch<any>(path, init);
    setBusy(false);
    if (!r.ok) {
      setError(r.code === "job_complete" ? "This job was completed — reopen it to make changes." : r.error);
      return;
    }
    setMode("none");
    onOk(r.data);
  }
  const url = `/pieces/${encodeURIComponent(piece.id)}`;

  return (
    <li className="py-3 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1 min-h-[44px] cursor-pointer"
      >
        {open ? <ChevronDown size={16} aria-hidden="true" className="text-muted" /> : <ChevronRight size={16} aria-hidden="true" className="text-muted" />}
        <span className="text-lg font-bold">#{piece.piece_no}</span>
        <span className={STATUS_CHIP[piece.status]}>{STATUS_LABEL[piece.status]}</span>
        <span className="text-xs text-muted">
          {plural(piece.attempts, "attempt")}
          {last ? ` · ${last.measured_by ?? "—"} · ${formatEtDateTime(last.measured_at) ?? ""}` : ""}
        </span>
      </button>
      {piece.disposition_note && <p className="text-sm text-text whitespace-pre-wrap break-words pl-7">{piece.disposition_note}</p>}

      {open && (
        <div className="pl-7 space-y-2">
          {attemptsOf(piece).map(({ attempt, rows }) => (
            <div key={attempt} className="rounded-lg border border-[var(--border)] p-2">
              <p className="text-xs font-semibold text-muted">Attempt {attempt}{rows[0] ? ` · ${rows[0].measured_by ?? "—"} · ${formatEtDateTime(rows[0].measured_at) ?? ""}` : ""}</p>
              <ul className="text-sm">
                {rows.map((m) => (
                  <li key={m.id} className={m.in_tol ? "text-text" : "text-[var(--danger-ink)] font-semibold"}>
                    {m.in_tol ? "✓" : "✗"} {dimName.get(m.dim_id) ?? "Dim"} {formatInches(m.nominal_in)} → {m.measured_text ?? formatInches(m.measured_in)}
                    {!m.in_tol && ` (${deviationText(m)} ${m.measured_in > m.nominal_in ? "OVER" : "UNDER"})`}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {editable && mode === "none" && (
        <div className="flex flex-wrap gap-2 pl-7">
          {piece.status === "rework_pending" && (
            <button type="button" className={PRIMARY} onClick={onRemeasure}>Re-measure</button>
          )}
          {correction && (
            <button type="button" className={GHOST} onClick={() => setMode("status")}>
              {correction === "scrapped" ? "Change to scrapped" : "Back to rework"}
            </button>
          )}
          <button type="button" className={GHOST} onClick={() => { setNote(piece.disposition_note ?? ""); setMode("note"); }}>Edit note</button>
          <button type="button" className={`${GHOST} text-[var(--danger-ink)]`} onClick={() => setMode("delete")}>Delete piece</button>
        </div>
      )}
      {editable && mode === "status" && correction && (
        <div className="ml-7 rounded-lg border border-[var(--border)] p-3 space-y-2">
          <p className="text-sm text-text">
            {correction === "scrapped" ? `Scrap piece #${piece.piece_no}?` : `Send piece #${piece.piece_no} back to rework?`}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={GHOST} disabled={busy} onClick={() => setMode("none")}>Cancel</button>
            <button
              type="button"
              className={correction === "scrapped" ? DANGER : PRIMARY}
              disabled={busy}
              onClick={() => act(url, jsonInit("PATCH", { status: correction }), (d) => onApplied(d.part, d.piece))}
            >
              {correction === "scrapped" ? "Scrap it" : "Back to rework"}
            </button>
          </div>
        </div>
      )}
      {editable && mode === "note" && (
        <div className="ml-7 space-y-2">
          <textarea className={TEXTAREA} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} aria-label={`Note for piece #${piece.piece_no}`} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={GHOST} disabled={busy} onClick={() => setMode("none")}>Cancel</button>
            <button
              type="button"
              className={PRIMARY}
              disabled={busy}
              onClick={() => act(url, jsonInit("PATCH", { disposition_note: note.trim() || null }), (d) => onApplied(d.part, d.piece))}
            >
              Save note
            </button>
          </div>
        </div>
      )}
      {editable && mode === "delete" && (
        <div className="ml-7 rounded-lg border border-[var(--border)] p-3 space-y-2">
          <p className="text-sm text-text">
            Delete piece #{piece.piece_no} and its {plural(piece.measurements.length, "measurement")}? This can&apos;t be undone.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={GHOST} disabled={busy} onClick={() => setMode("none")}>Cancel</button>
            <button type="button" className={DANGER} disabled={busy} onClick={() => act(url, { method: "DELETE" }, (d) => onApplied(d.part, undefined, piece.id))}>
              {busy ? "Deleting…" : "Delete piece"}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className={`${ERROR_TEXT} pl-7`}>{error}</p>}
    </li>
  );
}
