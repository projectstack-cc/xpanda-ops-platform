"use client";
// src/components/marina/MarinaJobDetail.tsx — marina-04
// /v2/qc/marina/[jobId] — one Marina job: header (edit / complete / reopen / delete), files (upload,
// inline view, supersede, kind flip, delete) and a read-only parts list (marina-05 adds setup,
// marina-06 inspection). Every mutation re-fetches GET /jobs/{id}; no optimistic writes.
// Completed jobs hide every edit control (the API 409s anyway).
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Lock, MoreHorizontal } from "lucide-react";
import Modal from "@/components/Modal";
import PdfViewer from "@/components/PdfViewer";
import PlatformHeader from "@/components/PlatformHeader";
import { formatEtDateTime } from "@/lib/etDateTime";
import { formatInches } from "@/lib/inches";
import type { MarinaFile, MarinaJobDetail as Detail, MarinaPartSummary } from "@/lib/marina/types";
import EditJobModal from "./EditJobModal";
import TallyChips from "./TallyChips";
import UploadFileButton from "./UploadFileButton";
import {
  API, CARD, CHIP_GOOD, CHIP_INFO, CHIP_NEUTRAL, DANGER, ERROR_TEXT, GHOST, HEADER_BTN, INPUT, LABEL, PRIMARY,
  REWORK_BADGE, formatSize, jsonInit, marinaFetch, plural,
} from "./ui";

interface Props {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
  canEdit: boolean;
  jobId: string;
}

const KIND_LABEL: Record<MarinaFile["kind"], string> = { cut_sheet: "Cut sheet", customer_drawing: "Customer drawing" };

export default function MarinaJobDetail({ userName, isAdmin, permissions, canEdit, jobId }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await marinaFetch<{ detail: Detail }>(`/jobs/${encodeURIComponent(jobId)}`);
    if (!r.ok) {
      if (r.status === 404) setNotFound(true);
      else setLoadError(r.error);
      return;
    }
    setLoadError(null);
    setNotFound(false);
    setDetail(r.data.detail);
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  const header = (
    <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Quality Control · v2" currentPath="/v2/qc" />
  );
  const backLink = (
    <a href="/v2/qc/marina" className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-[var(--link)] no-underline">
      <ArrowLeft size={16} aria-hidden="true" /> Marina Foam jobs
    </a>
  );

  if (notFound || (loadError && !detail) || !detail) {
    return (
      <div className="min-h-screen flex flex-col bg-bg text-text">
        {header}
        <div className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 space-y-4">
          {backLink}
          {notFound ? (
            <div className={`${CARD} space-y-1`}>
              <h1 className="text-lg font-bold">Job not found</h1>
              <p className="text-sm text-muted">It may have been deleted.</p>
            </div>
          ) : loadError ? (
            <div role="alert" className={`${CARD} space-y-3`}>
              <p className={ERROR_TEXT}>{loadError}</p>
              <button type="button" className={GHOST} onClick={() => { setLoadError(null); load(); }}>Retry</button>
            </div>
          ) : (
            <div className={`${CARD} space-y-2 animate-pulse`} aria-busy="true" aria-label="Loading job">
              <div className="h-6 w-1/2 rounded bg-[var(--ghost-bg)]" />
              <div className="h-4 w-1/3 rounded bg-[var(--ghost-bg)]" />
            </div>
          )}
        </div>
      </div>
    );
  }

  const { job, files, parts } = detail;
  const isOpen = job.status === "open";
  const editable = canEdit && isOpen;
  const reworkPending = parts.reduce((s, p) => s + p.tallies.rework_pending, 0);
  const pieceCount = parts.reduce((s, p) => s + p.tallies.pieces, 0);
  const liveFiles = files.filter((f) => !f.superseded_at);
  const supersededFiles = files.filter((f) => f.superseded_at);
  const hasLiveCutSheet = liveFiles.some((f) => f.kind === "cut_sheet");

  async function setStatus(status: "open" | "complete") {
    setBusy(true);
    setActionError(null);
    const r = await marinaFetch(`/jobs/${encodeURIComponent(job.id)}`, jsonInit("PATCH", { status }));
    setBusy(false);
    setConfirmComplete(false);
    if (!r.ok) setActionError(r.error);
    await load();
  }

  function onMarkComplete() {
    if (reworkPending > 0) setConfirmComplete(true);
    else setStatus("complete");
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      {header}
      <div className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 space-y-5">
        {backLink}

        <section className={`${CARD} space-y-3`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight break-words">{job.name}</h1>
                <span className={isOpen ? CHIP_INFO : CHIP_GOOD}>{isOpen ? "Open" : "Complete"}</span>
              </div>
              {job.customer && <p className="text-sm text-muted break-words">{job.customer}</p>}
              <p className="text-xs text-muted">
                Created{job.created_by ? ` by ${job.created_by}` : ""} · {formatEtDateTime(job.created_at) ?? "—"}
                {job.completed_at && <> · Completed {formatEtDateTime(job.completed_at)}</>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <TallyChips tallies={{ parts: parts.length, ...sumTallies(parts) }} />
              {reworkPending > 0 && <span className={REWORK_BADGE}>{reworkPending} rework pending</span>}
            </div>
          </div>
          {job.notes && <p className="text-sm text-text whitespace-pre-wrap break-words">{job.notes}</p>}

          {canEdit && (
            <div className="flex flex-wrap gap-2 pt-1">
              {isOpen && (
                <button type="button" className={HEADER_BTN} onClick={() => setEditOpen(true)} disabled={busy}>Edit</button>
              )}
              {isOpen ? (
                <button type="button" className={HEADER_BTN} onClick={onMarkComplete} disabled={busy}>Mark complete</button>
              ) : (
                <button type="button" className={HEADER_BTN} onClick={() => setStatus("open")} disabled={busy}>Reopen</button>
              )}
              <button
                type="button"
                className={`${HEADER_BTN} text-[var(--danger-ink)]`}
                onClick={() => setDeleteOpen(true)}
                disabled={busy}
              >
                Delete job
              </button>
            </div>
          )}
          {confirmComplete && (
            <div role="alert" className="rounded-lg border border-[var(--info-border)] bg-[var(--info-bg)] p-3 space-y-2">
              <p className="text-sm text-[var(--info-text)] font-semibold">
                {plural(reworkPending, "piece")} still need{reworkPending === 1 ? "s" : ""} rework — complete anyway?
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className={GHOST} onClick={() => setConfirmComplete(false)} disabled={busy}>Cancel</button>
                <button type="button" className={PRIMARY} onClick={() => setStatus("complete")} disabled={busy}>Complete anyway</button>
              </div>
            </div>
          )}
          {actionError && <p role="alert" className={ERROR_TEXT}>{actionError}</p>}
        </section>

        {!isOpen && (
          <p role="status" className="rounded-lg border border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info-text)] text-sm font-semibold px-4 py-3">
            This job is complete — reopen it to make changes.
          </p>
        )}

        <section className={`${CARD} space-y-3`} aria-labelledby="marina-files">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="marina-files" className="text-base font-bold">Files ({liveFiles.length})</h2>
          </div>
          {editable && <UploadFileButton jobId={job.id} onUploaded={load} />}
          <FileList files={liveFiles} canEdit={editable} onChanged={load} emptyText="No files yet." />
          {supersededFiles.length > 0 && <SupersededFiles files={supersededFiles} canEdit={editable} onChanged={load} />}
        </section>

        <section className={`${CARD} space-y-3`} aria-labelledby="marina-parts">
          <h2 id="marina-parts" className="text-base font-bold">Parts ({parts.length})</h2>
          {parts.length === 0 ? (
            <p className="text-sm text-muted">{hasLiveCutSheet ? "No parts yet." : "Upload a cut sheet to set up parts."}</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {parts.map((p) => <PartRow key={p.id} part={p} />)}
            </ul>
          )}
        </section>
      </div>

      {canEdit && <EditJobModal job={job} isOpen={editOpen} onClose={() => setEditOpen(false)} onSaved={load} />}
      {canEdit && (
        <DeleteJobModal
          isOpen={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          jobId={job.id}
          jobName={job.name}
          counts={{ parts: parts.length, pieces: pieceCount, files: files.length }}
        />
      )}
    </div>
  );
}

function sumTallies(parts: MarinaPartSummary[]) {
  const t = { pieces: 0, pass: 0, accepted: 0, rework_pending: 0, scrapped: 0 };
  for (const p of parts) {
    t.pieces += p.tallies.pieces;
    t.pass += p.tallies.pass;
    t.accepted += p.tallies.accepted;
    t.rework_pending += p.tallies.rework_pending;
    t.scrapped += p.tallies.scrapped;
  }
  return t;
}

// ── Parts (read-only in marina-04) ───────────────────────────────────────────────────────────

function PartRow({ part }: { part: MarinaPartSummary }) {
  const dims = part.dims.map((d) => `${d.label} ${d.nominal_text ?? formatInches(d.nominal_in)}`).join(" · ");
  return (
    <li className="py-3 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold break-words">{part.label}</span>
        {part.locked && (
          <Lock size={16} className="text-muted shrink-0" role="img" aria-label="Dims locked — pieces measured" />
        )}
      </div>
      {dims && <p className="text-sm text-text break-words">{dims}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <TallyChips tallies={part.tallies} />
        {part.tallies.rework_pending > 0 && <span className={REWORK_BADGE}>{part.tallies.rework_pending} rework pending</span>}
      </div>
      {part.notes && <p className="text-sm text-muted whitespace-pre-wrap break-words">{part.notes}</p>}
    </li>
  );
}

// ── Files ────────────────────────────────────────────────────────────────────────────────────

function SupersededFiles({ files, canEdit, onChanged }: { files: MarinaFile[]; canEdit: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-[var(--link)] cursor-pointer"
      >
        {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        Superseded ({files.length})
      </button>
      {open && <FileList files={files} canEdit={canEdit} onChanged={onChanged} emptyText="" />}
    </div>
  );
}

// One inline viewer open at a time across the live + superseded lists (module-level would leak
// across jobs; a window event keeps the two lists in sync without lifting state).
const VIEW_EVENT = "marina-file-view";

function FileList({ files, canEdit, onChanged, emptyText }: { files: MarinaFile[]; canEdit: boolean; onChanged: () => void; emptyText: string }) {
  const [viewId, setViewId] = useState<string | null>(null);
  useEffect(() => {
    const h = (e: Event) => setViewId((e as CustomEvent<string | null>).detail);
    window.addEventListener(VIEW_EVENT, h);
    return () => window.removeEventListener(VIEW_EVENT, h);
  }, []);
  const toggle = (id: string) => {
    window.dispatchEvent(new CustomEvent(VIEW_EVENT, { detail: viewId === id ? null : id }));
  };
  if (files.length === 0) return emptyText ? <p className="text-sm text-muted">{emptyText}</p> : null;
  return (
    <ul className="space-y-2">
      {files.map((f) => (
        <FileRow key={f.id} file={f} canEdit={canEdit} viewing={viewId === f.id} onToggleView={() => toggle(f.id)} onChanged={onChanged} />
      ))}
    </ul>
  );
}

function FileRow({
  file, canEdit, viewing, onToggleView, onChanged,
}: { file: MarinaFile; canEdit: boolean; viewing: boolean; onToggleView: () => void; onChanged: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `${API}/files/${encodeURIComponent(file.id)}`;
  const name = file.filename || "Untitled.pdf";

  async function act(init: RequestInit) {
    setBusy(true);
    setError(null);
    const r = await marinaFetch(`/files/${encodeURIComponent(file.id)}`, init);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setMenuOpen(false);
    setConfirmDelete(false);
    onChanged();
  }

  const meta = [
    file.page_count != null ? plural(file.page_count, "page") : null,
    formatSize(file.size_bytes) || null,
    file.uploaded_by,
    formatEtDateTime(file.uploaded_at),
  ].filter(Boolean).join(" · ");

  return (
    <li className="rounded-lg border border-[var(--border)] p-2 space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex-1 min-w-[12rem] px-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-text break-all">{name}</span>
            <span className={CHIP_NEUTRAL}>{KIND_LABEL[file.kind]}</span>
          </div>
          <p className="text-xs text-muted">{meta}</p>
        </div>
        <div className="flex gap-2 ml-auto">
          <button type="button" className={GHOST} onClick={onToggleView} aria-expanded={viewing}>
            {viewing ? "Hide" : "View"}
          </button>
          {canEdit && (
            <button
              type="button"
              className={`${GHOST} px-3`}
              onClick={() => { setMenuOpen((v) => !v); setConfirmDelete(false); setError(null); }}
              aria-expanded={menuOpen}
              aria-label={`Actions for ${name}`}
            >
              <MoreHorizontal size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {canEdit && menuOpen && !confirmDelete && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={GHOST} disabled={busy}
            onClick={() => act(jsonInit("PATCH", { superseded: !file.superseded_at }))}>
            {file.superseded_at ? "Restore" : "Mark superseded"}
          </button>
          <button type="button" className={GHOST} disabled={busy}
            onClick={() => act(jsonInit("PATCH", { kind: file.kind === "cut_sheet" ? "customer_drawing" : "cut_sheet" }))}>
            {file.kind === "cut_sheet" ? "Change to customer drawing" : "Change to cut sheet"}
          </button>
          <button type="button" className={`${GHOST} text-[var(--danger-ink)]`} disabled={busy}
            onClick={() => { setConfirmDelete(true); setError(null); }}>
            Delete
          </button>
        </div>
      )}
      {canEdit && confirmDelete && (
        <div className="rounded-lg border border-[var(--border)] p-3 space-y-2">
          <p className="text-sm text-text">Delete &ldquo;{name}&rdquo;? This can&apos;t be undone.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={GHOST} disabled={busy} onClick={() => { setConfirmDelete(false); setError(null); }}>Cancel</button>
            <button type="button" className={DANGER} disabled={busy} onClick={() => act({ method: "DELETE" })}>
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className={ERROR_TEXT}>{error}</p>}

      {viewing && <PdfViewer src={url} filename={name} title={name} />}
    </li>
  );
}

// ── Delete job ───────────────────────────────────────────────────────────────────────────────

function DeleteJobModal({
  isOpen, onClose, jobId, jobName, counts,
}: { isOpen: boolean; onClose: () => void; jobId: string; jobName: string; counts: { parts: number; pieces: number; files: number } }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTyped("");
      setError(null);
    }
  }, [isOpen]);

  async function del() {
    setBusy(true);
    setError(null);
    const r = await marinaFetch(`/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    window.location.href = "/v2/qc/marina";
  }

  const matches = typed.trim() === jobName.trim();
  return (
    <Modal isOpen={isOpen} onClose={busy ? () => {} : onClose} title="Delete job">
      <div className="space-y-4">
        <p className="text-sm text-text">
          This permanently removes <span className="font-semibold">{jobName}</span>: {plural(counts.parts, "part")},{" "}
          {plural(counts.pieces, "measured piece")} with all their measurements, and {plural(counts.files, "file")}.
          This can&apos;t be undone.
        </p>
        <label className={LABEL}>
          Type the job name to confirm
          <input className={INPUT} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </label>
        {error && <p role="alert" className={ERROR_TEXT}>{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={DANGER} onClick={del} disabled={busy || !matches}>
            {busy ? "Deleting…" : "Delete job"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
