"use client";
// src/components/board/JobPrintsSection.tsx
// board-prints-02 — job prints (customer drawings / spec sheets) for BOTH board modals:
// mode="view" in OrderDetailModal (read-only, also used for archived jobs), mode="edit" in
// OrderEditModal (Add Print / Delete when canEdit). Uploads and deletes hit
// /v2/api/board/:id/prints immediately — never part of a modal's Save. Collapsed by default;
// one inline preview open at a time (shared PdfViewer for PDFs, <img> for images).
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Plus, Trash2 } from "lucide-react";
import PdfViewer from "@/components/PdfViewer";

interface JobPrint {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_by_name: string | null;
  created_at: string;
}

interface JobPrintsSectionProps {
  jobId: string;
  canEdit: boolean;
  mode: "view" | "edit";
}

const ACCEPT = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 25 * 1024 * 1024;
const TYPE_LABEL: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/webp": "WEBP",
};

const linkBtn =
  "flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-[var(--link)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
const ghostBtn =
  "min-h-[44px] px-4 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50";

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// created_at is D1 datetime('now') — UTC "YYYY-MM-DD HH:MM:SS".
function formatDate(s: string): string {
  const d = new Date(s.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"));
  return isNaN(d.getTime()) ? s : d.toLocaleDateString();
}

export default function JobPrintsSection({ jobId, canEdit, mode }: JobPrintsSectionProps) {
  const [prints, setPrints] = useState<JobPrint[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const base = `/v2/api/board/${encodeURIComponent(jobId)}/prints`;
  const editable = mode === "edit" && canEdit;

  const load = useCallback(async () => {
    try {
      const res = await fetch(base);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setLoadError(data?.error || `Couldn't load prints (HTTP ${res.status}).`);
        setPrints((p) => p ?? []);
        return;
      }
      setLoadError(null);
      setPrints(data.prints ?? []);
    } catch (e: any) {
      setLoadError(`Couldn't load prints: ${String(e?.message || e)}`);
      setPrints((p) => p ?? []);
    }
  }, [base]);

  useEffect(() => {
    setPrints(null);
    setOpen(false);
    setPreviewId(null);
    setConfirmingId(null);
    setUploadErrors([]);
    load();
  }, [load]);

  async function handleFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (fileInput.current) fileInput.current.value = "";
    if (!files.length) return;
    const errors: string[] = [];
    setUploadErrors([]);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setProgress(`Uploading ${i + 1} of ${files.length}…`);
      if (!ACCEPT.includes(f.type)) {
        errors.push(`${f.name}: must be a PDF, PNG, JPG or WEBP file.`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        errors.push(`${f.name}: file is too large. The limit is 25 MB.`);
        continue;
      }
      try {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch(base, { method: "POST", body: fd });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) errors.push(`${f.name}: ${data?.error || `upload failed (HTTP ${res.status}).`}`);
      } catch (e: any) {
        errors.push(`${f.name}: ${String(e?.message || e)}`);
      }
    }
    setProgress(null);
    setUploadErrors(errors);
    setOpen(true);
    await load();
  }

  async function handleDelete(p: JobPrint) {
    setDeletingId(p.id);
    setDeleteError(null);
    try {
      const res = await fetch(`${base}/${encodeURIComponent(p.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setDeleteError(data?.error || `Delete failed (HTTP ${res.status}).`);
      } else {
        setConfirmingId(null);
        if (previewId === p.id) setPreviewId(null);
      }
    } catch (e: any) {
      setDeleteError(String(e?.message || e));
    } finally {
      setDeletingId(null);
      await load();
    }
  }

  const count = prints?.length ?? 0;
  const countText = prints === null ? "…" : String(count);
  const label = mode === "view" ? `View Prints (${countText})` : `Prints (${countText})`;
  const busy = progress !== null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4">
        {mode === "view" && prints !== null && count === 0 && !loadError ? (
          <p className="flex items-center min-h-[44px] text-sm text-muted">No prints</p>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={prints === null}
            className={linkBtn}
            aria-expanded={open}
          >
            {open ? <ChevronDown size={16} className="shrink-0" aria-hidden="true" /> : <ChevronRight size={16} className="shrink-0" aria-hidden="true" />}
            {label}
          </button>
        )}
        {editable && (
          <>
            <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className={linkBtn}>
              <Plus size={16} className="shrink-0" aria-hidden="true" />
              Add Print
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </>
        )}
      </div>

      {progress && <p className="text-sm text-muted">{progress}</p>}
      {loadError && <p className="text-sm text-[var(--warn-text)]">{loadError}</p>}
      {uploadErrors.map((m, i) => (
        <p key={i} className="text-sm text-[var(--warn-text)]">{m}</p>
      ))}

      {open && prints !== null && (
        <ul className="space-y-2">
          {count === 0 && <li className="text-sm text-muted">No prints yet.</li>}
          {prints.map((p) => {
            const url = `${base}/${encodeURIComponent(p.id)}`;
            const previewing = previewId === p.id;
            const isPdf = p.content_type === "application/pdf";
            return (
              <li key={p.id} className="rounded-md border border-[var(--card-border)] p-2 space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button
                    type="button"
                    onClick={() => setPreviewId(previewing ? null : p.id)}
                    className="flex-1 min-w-0 min-h-[44px] flex items-center gap-1.5 text-left cursor-pointer"
                    aria-expanded={previewing}
                  >
                    {previewing ? <ChevronDown size={16} className="shrink-0 text-[var(--link)]" aria-hidden="true" /> : <ChevronRight size={16} className="shrink-0 text-[var(--link)]" aria-hidden="true" />}
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-text break-words">{p.filename}</span>
                      <span className="block text-xs text-muted">
                        {TYPE_LABEL[p.content_type] || p.content_type} · {formatSize(p.size_bytes)} · {p.uploaded_by_name || "Unknown"} · {formatDate(p.created_at)}
                      </span>
                    </span>
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 min-h-[44px] text-sm font-semibold text-[var(--link)]"
                  >
                    <ExternalLink size={14} className="shrink-0" aria-hidden="true" />
                    Open in new tab
                  </a>
                  {editable && confirmingId !== p.id && (
                    <button
                      type="button"
                      onClick={() => { setConfirmingId(p.id); setDeleteError(null); }}
                      className="flex items-center gap-1 min-h-[44px] px-2 text-sm font-semibold text-[var(--warn-text)] cursor-pointer"
                    >
                      <Trash2 size={14} className="shrink-0" aria-hidden="true" />
                      Delete
                    </button>
                  )}
                </div>

                {editable && confirmingId === p.id && (
                  <div role="alert" className="rounded-md border border-[var(--card-border)] p-3 space-y-2">
                    <p className="text-sm text-text">Delete print &ldquo;{p.filename}&rdquo;? This can&apos;t be undone.</p>
                    {deleteError && <p className="text-sm text-[var(--warn-text)]">{deleteError}</p>}
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { setConfirmingId(null); setDeleteError(null); }}
                        disabled={deletingId === p.id}
                        className={ghostBtn}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p)}
                        disabled={deletingId === p.id}
                        className="min-h-[44px] px-4 rounded-md bg-[var(--danger-bg)] text-[var(--danger-text)] text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
                      >
                        {deletingId === p.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                )}

                {previewing &&
                  (isPdf ? (
                    <PdfViewer src={url} filename={p.filename} title={p.filename} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={p.filename} className="max-w-full h-auto rounded-md" />
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
