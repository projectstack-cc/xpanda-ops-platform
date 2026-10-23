"use client";
// src/components/marina/ReworkQueue.tsx — marina-06
// /v2/qc/marina/rework[?job=] — every rework_pending piece (GET /rework, open jobs only; ?job= → that
// job, then GET /jobs/{id} too so a completed job shows no actions), grouped by job, oldest first as
// the API returns them. Re-measure loads the part (GET /parts/{id} — the queue item carries no job
// tolerance) and opens MeasurePanel full-screen; on save it's back to the queue (an accepted piece
// drops out). "Scrap it" = the PATCH correction behind a confirm.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import type { MarinaJobDetail, MarinaPartDetail, MarinaPiece, MarinaReworkItem } from "@/lib/marina/types";
import MeasurePanel from "./MeasurePanel";
import { STATUS_LABEL, lastOutDims, waitingFor } from "./pieceUi";
import { CARD, DANGER, ERROR_TEXT, GHOST, PRIMARY, jsonInit, marinaFetch, plural } from "./ui";

interface Props {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
  canEdit: boolean;
  jobId: string | null;
}

export default function ReworkQueue({ userName, isAdmin, permissions, canEdit, jobId }: Props) {
  const [items, setItems] = useState<MarinaReworkItem[] | null>(null);
  const [job, setJob] = useState<MarinaJobDetail["job"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState<{ part: MarinaPartDetail; piece: MarinaPiece } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<{ id: string; text: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [r, j] = await Promise.all([
      marinaFetch<{ items: MarinaReworkItem[] }>(`/rework${jobId ? `?job_id=${encodeURIComponent(jobId)}` : ""}`),
      jobId ? marinaFetch<{ detail: MarinaJobDetail }>(`/jobs/${encodeURIComponent(jobId)}`) : Promise.resolve(null),
    ]);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setItems(r.data.items);
    if (j && j.ok) setJob(j.data.detail.job);
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const editable = canEdit && (!jobId || job?.status === "open");

  async function remeasure(item: MarinaReworkItem) {
    setOpening(item.piece.id);
    setOpenError(null);
    const r = await marinaFetch<{ part: MarinaPartDetail }>(`/parts/${encodeURIComponent(item.part.id)}`);
    setOpening(null);
    if (!r.ok) {
      setOpenError({ id: item.piece.id, text: r.error });
      return;
    }
    const piece = r.data.part.pieces.find((p) => p.id === item.piece.id);
    if (!piece || piece.status !== "rework_pending") {
      setOpenError({ id: item.piece.id, text: "This piece is no longer waiting for rework." });
      load();
      return;
    }
    setMeasuring({ part: r.data.part, piece });
  }

  const header = (
    <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Quality Control · v2" currentPath="/v2/qc" />
  );

  if (measuring) {
    return (
      <div className="fixed inset-0 z-40 overflow-y-auto bg-bg text-text">
        <div className="w-full max-w-5xl mx-auto px-4 py-4">
          <section className={`${CARD} min-w-0`}>
            <MeasurePanel
              partId={measuring.part.id}
              partLabel={`${measuring.part.label} · ${measuring.part.job.name}`}
              dims={measuring.part.dims}
              tolerance={measuring.part.job.tolerance_in}
              mode={{ kind: "remeasure", piece: measuring.piece }}
              onSaved={(piece) => {
                setMeasuring(null);
                setToast(`${measuring.part.label} #${piece.piece_no} — ${STATUS_LABEL[piece.status]}${piece.status === "accepted" ? " (removed from the queue)" : ""}`);
                load();
              }}
              onCancel={() => setMeasuring(null)}
            />
          </section>
        </div>
      </div>
    );
  }

  // Group by job, keeping the API's oldest-first order.
  const groups: { job: MarinaReworkItem["job"]; items: MarinaReworkItem[] }[] = [];
  for (const it of items ?? []) {
    const g = groups.find((x) => x.job.id === it.job.id);
    if (g) g.items.push(it);
    else groups.push({ job: it.job, items: [it] });
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      {header}
      <div className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 space-y-5">
        <a
          href={jobId ? `/v2/qc/marina/${encodeURIComponent(jobId)}` : "/v2/qc/marina"}
          className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-[var(--link)] no-underline"
        >
          <ArrowLeft size={16} aria-hidden="true" /> {jobId ? "Back to job" : "Marina Foam jobs"}
        </a>

        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Rework queue</h1>
          <p className="text-xs text-muted break-words">
            {jobId ? (job ? `${job.name}${job.customer ? ` · ${job.customer}` : ""}` : "One job") : "Every open Marina Foam job"} · oldest first
          </p>
          {jobId && (
            <a href="/v2/qc/marina/rework" className="inline-flex items-center min-h-[44px] text-sm font-semibold text-[var(--link)] no-underline">
              Show all jobs
            </a>
          )}
        </div>

        {jobId && job && job.status !== "open" && (
          <p role="status" className="rounded-lg border border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info-text)] text-sm font-semibold px-4 py-3">
            This job is complete — reopen it to re-measure.
          </p>
        )}
        {toast && (
          <p role="status" className="rounded-lg border border-[var(--loaded-border)] bg-[var(--loaded-bg)] text-[var(--loaded-text)] text-base font-bold px-4 py-3">
            {toast}
          </p>
        )}

        {error ? (
          <div role="alert" className={`${CARD} space-y-3`}>
            <p className={ERROR_TEXT}>{error}</p>
            <button type="button" className={GHOST} onClick={load}>Retry</button>
          </div>
        ) : items === null ? (
          <div className={`${CARD} space-y-2 animate-pulse`} aria-busy="true" aria-label="Loading rework queue">
            <div className="h-5 w-1/2 rounded bg-[var(--ghost-bg)]" />
            <div className="h-4 w-3/4 rounded bg-[var(--ghost-bg)]" />
          </div>
        ) : items.length === 0 ? (
          <p className={`${CARD} text-sm text-muted`}>No pieces waiting for rework.</p>
        ) : (
          groups.map((g) => (
            <section key={g.job.id} className={`${CARD} space-y-3`} aria-label={g.job.name}>
              <h2 className="text-base font-bold break-words">
                <a href={`/v2/qc/marina/${encodeURIComponent(g.job.id)}`} className="text-text no-underline hover:underline">
                  {g.job.name}
                </a>
                {g.job.customer && <span className="font-normal text-muted"> · {g.job.customer}</span>}
                <span className="font-normal text-muted"> · {plural(g.items.length, "piece")}</span>
              </h2>
              <ul className="divide-y divide-[var(--border)]">
                {g.items.map((it) => (
                  <ReworkRow
                    key={it.piece.id}
                    item={it}
                    editable={editable}
                    opening={opening === it.piece.id}
                    openError={openError?.id === it.piece.id ? openError.text : null}
                    onRemeasure={() => remeasure(it)}
                    onChanged={(msg) => { setToast(msg); load(); }}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function ReworkRow({
  item, editable, opening, openError, onRemeasure, onChanged,
}: {
  item: MarinaReworkItem; editable: boolean; opening: boolean; openError: string | null; onRemeasure: () => void; onChanged: (msg: string) => void;
}) {
  const [confirmScrap, setConfirmScrap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { piece, part } = item;
  const out = lastOutDims(piece, part.dims);

  async function scrap() {
    setBusy(true);
    setError(null);
    const r = await marinaFetch(`/pieces/${encodeURIComponent(piece.id)}`, jsonInit("PATCH", { status: "scrapped" }));
    setBusy(false);
    if (!r.ok) {
      setError(r.code === "job_complete" ? "This job was completed — reopen it to make changes." : r.error);
      return;
    }
    setConfirmScrap(false);
    onChanged(`${part.label} #${piece.piece_no} — Scrapped`);
  }

  return (
    <li className="py-3 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <a href={`/v2/qc/marina/parts/${encodeURIComponent(part.id)}`} className="text-lg font-bold text-text no-underline hover:underline break-words">
          {part.label}
        </a>
        <span className="text-lg font-bold">#{piece.piece_no}</span>
        <span className="text-xs text-muted">
          {plural(piece.attempts, "attempt")} · waiting {waitingFor(piece.updated_at ?? piece.created_at)}
        </span>
      </div>
      {out.length > 0 && (
        <ul className="text-sm">
          {out.map((o, i) => (
            <li key={i} className="text-[var(--danger-ink)] font-semibold">✗ {o.label} {o.text}</li>
          ))}
        </ul>
      )}
      {piece.disposition_note && <p className="text-sm text-text whitespace-pre-wrap break-words">{piece.disposition_note}</p>}
      {editable && !confirmScrap && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${PRIMARY} min-h-[56px] px-6 text-base`} onClick={onRemeasure} disabled={opening}>
            {opening ? "Opening…" : "Re-measure"}
          </button>
          <button type="button" className={`${GHOST} min-h-[56px] text-[var(--danger-ink)]`} onClick={() => setConfirmScrap(true)}>Scrap it</button>
        </div>
      )}
      {editable && confirmScrap && (
        <div className="rounded-lg border border-[var(--border)] p-3 space-y-2">
          <p className="text-sm text-text">Scrap {part.label} #{piece.piece_no}? It leaves the rework queue.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={GHOST} disabled={busy} onClick={() => setConfirmScrap(false)}>Cancel</button>
            <button type="button" className={DANGER} disabled={busy} onClick={scrap}>{busy ? "Scrapping…" : "Scrap it"}</button>
          </div>
        </div>
      )}
      {(error || openError) && <p role="alert" className={ERROR_TEXT}>{error || openError}</p>}
    </li>
  );
}
