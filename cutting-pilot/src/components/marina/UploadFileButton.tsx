"use client";
// src/components/marina/UploadFileButton.tsx — marina-04
// Upload a PDF to a Marina job: pick a file → choose Cut sheet (default) / Customer drawing → client
// checks (PDF, ≤ 25 MB, same as the server) → countPdfPages → multipart POST /jobs/{id}/files
// (file, kind, page_count — omitted when pdf.js couldn't count). The parent re-fetches on success.
import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { countPdfPages } from "@/lib/pdfjs";
import type { MarinaFileKind } from "@/lib/marina/types";
import { API, ERROR_TEXT, GHOST, HEADER_BTN, PRIMARY, formatSize } from "./ui";

const MAX_BYTES = 25 * 1024 * 1024;

function isPdf(f: File): boolean {
  return f.type === "application/pdf" || ((f.type === "" || f.type === "application/octet-stream") && /\.pdf$/i.test(f.name));
}

interface Props { jobId: string; onUploaded: () => void; }

export default function UploadFileButton({ jobId, onUploaded }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<MarinaFileKind>("cut_sheet");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(list: FileList | null) {
    const f = list?.[0] ?? null;
    if (input.current) input.current.value = "";
    if (!f) return;
    setError(null);
    if (!isPdf(f)) {
      setError(`${f.name}: must be a PDF.`);
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(`${f.name}: file is too large. The limit is 25 MB.`);
      return;
    }
    setKind("cut_sheet");
    setFile(f);
  }

  async function upload() {
    if (!file) return;
    setError(null);
    setBusy("Reading pages…");
    const pages = await countPdfPages(file);
    setBusy("Uploading…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      if (pages != null) fd.append("page_count", String(pages));
      const res = await fetch(`${API}/jobs/${encodeURIComponent(jobId)}/files`, { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || `Upload failed (HTTP ${res.status}).`);
      } else {
        setFile(null);
        onUploaded();
      }
    } catch (e: any) {
      setError(`Upload failed: ${String(e?.message || e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {!file && (
        <button type="button" className={HEADER_BTN} onClick={() => input.current?.click()}>
          <Upload size={14} className="text-muted" aria-hidden="true" />
          Upload PDF
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => pick(e.target.files)}
      />

      {file && (
        <div className="rounded-lg border border-[var(--border)] p-3 space-y-3">
          <p className="text-sm text-text break-words">
            <span className="font-semibold">{file.name}</span>{" "}
            <span className="text-muted">· {formatSize(file.size)}</span>
          </p>
          <div role="radiogroup" aria-label="File type" className="flex flex-wrap gap-2">
            {([
              ["cut_sheet", "Cut sheet"],
              ["customer_drawing", "Customer drawing"],
            ] as [MarinaFileKind, string][]).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                disabled={busy !== null}
                onClick={() => setKind(k)}
                className={
                  kind === k
                    ? "min-h-[44px] px-4 rounded-lg border-2 border-[var(--brand)] bg-[var(--ghost-bg)] text-text text-sm font-semibold cursor-pointer"
                    : "min-h-[44px] px-4 rounded-lg border border-[var(--border)] bg-surface text-muted text-sm font-semibold cursor-pointer"
                }
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {busy && <span className="text-sm text-muted mr-auto" aria-live="polite">{busy}</span>}
            <button type="button" className={GHOST} disabled={busy !== null} onClick={() => { setFile(null); setError(null); }}>
              Cancel
            </button>
            <button type="button" className={PRIMARY} disabled={busy !== null} onClick={upload}>
              {busy ? "Uploading…" : "Upload"}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className={ERROR_TEXT}>{error}</p>}
    </div>
  );
}
