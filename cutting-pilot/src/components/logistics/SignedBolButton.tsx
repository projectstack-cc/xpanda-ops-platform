"use client";
// src/components/logistics/SignedBolButton.tsx
// lgx-signed-01: "Signed BOL" row action on the v2 Shipment Dashboard. Self-contained like
// LoadingSheetButton (owns its modal, portaled to document.body because it renders inside a table cell).
// Index from GET /v2/api/shipments/signed-bol?job_id (per-load: signed / carrier / photo), bytes from
// GET /v2/api/shipments/signed-bol/file (keys resolved server-side only). Viewer chosen by the fetched
// blob's MIME type — carrier_upload can be an image or a PDF. Blob URL revoked on every switch, on
// close, and on unmount.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileCheck } from "lucide-react";
import Modal from "@/components/Modal";
import PdfViewer from "@/components/PdfViewer";
import { formatEtDateTime } from "@/lib/etDateTime";

interface SignedLoad {
  load_number: number;
  load_count: number | null;
  bol_number: string | null;
  signed: { doc_id: string; doc_type: string; created_at: string } | null;
  carrier: { doc_id: string; created_at: string } | null;
  photo: { bol_id: string } | null;
}

interface Artifact {
  key: string;
  label: string;
  timestamp: string | null;
  fileUrl: string;
}

const SIGNED_LABELS: Record<string, string> = {
  original_signed: "Signed BOL",
  driver_signed: "Driver copy (signed)",
  customer_signed: "Customer copy (signed)",
};

function artifactsFor(load: SignedLoad): Artifact[] {
  const out: Artifact[] = [];
  if (load.signed) {
    out.push({
      key: "signed",
      label: SIGNED_LABELS[load.signed.doc_type] || "Signed BOL",
      timestamp: formatEtDateTime(load.signed.created_at),
      fileUrl: `/v2/api/shipments/signed-bol/file?doc_id=${encodeURIComponent(load.signed.doc_id)}`,
    });
  }
  if (load.carrier) {
    out.push({
      key: "carrier",
      label: "Carrier copy",
      timestamp: formatEtDateTime(load.carrier.created_at),
      fileUrl: `/v2/api/shipments/signed-bol/file?doc_id=${encodeURIComponent(load.carrier.doc_id)}`,
    });
  }
  if (load.photo) {
    out.push({
      key: "photo",
      label: "Delivery photo",
      timestamp: null,
      fileUrl: `/v2/api/shipments/signed-bol/file?photo_bol_id=${encodeURIComponent(load.photo.bol_id)}`,
    });
  }
  return out;
}

const ERROR_MSG = "Couldn't load the signed BOL. Try again.";

const segmentClass = (active: boolean) =>
  `inline-flex flex-col items-start justify-center min-h-[44px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
    active
      ? "bg-[var(--surface)] text-text shadow-sm border border-[var(--border)]"
      : "text-muted hover:text-text border border-transparent"
  }`;

export default function SignedBolButton({ jobId }: { jobId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loads, setLoads] = useState<SignedLoad[] | null>(null);
  const [loadIdx, setLoadIdx] = useState(0);
  const [artifactKey, setArtifactKey] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [view, setView] = useState<{ src: string; mime: string } | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const fileReqRef = useRef(0);

  const revoke = useCallback(() => {
    if (blobUrlRef.current) {
      try { URL.revokeObjectURL(blobUrlRef.current); } catch {}
      blobUrlRef.current = null;
    }
  }, []);

  useEffect(() => revoke, [revoke]);

  const currentLoad = loads && loads.length ? loads[Math.min(loadIdx, loads.length - 1)] : null;
  const artifacts = currentLoad ? artifactsFor(currentLoad) : [];
  const current = artifacts.find((a) => a.key === artifactKey) || null;

  // Fetch the selected artifact's bytes whenever the selection changes.
  const fileUrl = isOpen ? current?.fileUrl ?? null : null;
  useEffect(() => {
    if (!fileUrl) return;
    const req = ++fileReqRef.current;
    revoke();
    setView(null);
    setFileError(null);
    setFileLoading(true);
    (async () => {
      try {
        const res = await fetch(fileUrl, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (req !== fileReqRef.current) return;
        const mime = (blob.type || res.headers.get("Content-Type") || "").toLowerCase();
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setView({ src: url, mime });
      } catch (e) {
        if (req !== fileReqRef.current) return;
        console.error("Signed BOL file failed:", e);
        setFileError(ERROR_MSG);
      } finally {
        if (req === fileReqRef.current) setFileLoading(false);
      }
    })();
  }, [fileUrl, revoke]);

  function selectLoad(idx: number) {
    if (!loads) return;
    setLoadIdx(idx);
    setArtifactKey(artifactsFor(loads[idx])[0]?.key ?? null);
  }

  async function handleOpen() {
    revoke();
    fileReqRef.current++;
    setView(null);
    setFileError(null);
    setFileLoading(false);
    setError(null);
    setLoads(null);
    setLoadIdx(0);
    setArtifactKey(null);
    setIsOpen(true);
    setLoading(true);
    try {
      const res = await fetch(`/v2/api/shipments/signed-bol?job_id=${encodeURIComponent(jobId)}`, { credentials: "same-origin" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
      const list: SignedLoad[] = Array.isArray(body.loads) ? body.loads : [];
      setLoads(list);
      setArtifactKey(list.length ? artifactsFor(list[0])[0]?.key ?? null : null);
    } catch (e) {
      console.error("Signed BOL index failed:", e);
      setError(ERROR_MSG);
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setIsOpen(false);
    fileReqRef.current++;
    revoke();
    setView(null);
    setFileLoading(false);
  }

  const filename = `signed-bol-${currentLoad?.bol_number || jobId}.pdf`;

  const modal = (
    <Modal isOpen={isOpen} onClose={handleClose} title="Signed BOL" size="xl">
      {loading && <p className="text-sm text-muted">Loading signed BOL…</p>}
      {!loading && error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}
      {!loading && !error && loads && loads.length === 0 && (
        <p className="text-sm text-muted">No signed copy on file.</p>
      )}
      {!loading && !error && currentLoad && (
        <div className="flex flex-col gap-3">
          {loads!.length > 1 && (
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Loads">
              {loads!.map((l, i) => (
                <button
                  key={l.load_number}
                  type="button"
                  role="tab"
                  aria-selected={i === loadIdx}
                  onClick={() => selectLoad(i)}
                  className={`min-h-[44px] px-4 rounded-lg border text-sm font-semibold transition-colors cursor-pointer ${
                    i === loadIdx
                      ? "border-[var(--brand)] text-[var(--brand)] bg-[var(--ghost-bg)]"
                      : "border-[var(--border)] text-muted hover:text-text bg-[var(--surface)]"
                  }`}
                >
                  {l.load_count ? `Load ${l.load_number} of ${l.load_count}` : `Load ${l.load_number}`}
                </button>
              ))}
            </div>
          )}

          <div className="inline-flex flex-wrap self-start gap-1 rounded-lg border border-[var(--border)] p-0.5 bg-[var(--ghost-bg)]" role="group" aria-label="Signed artifacts">
            {artifacts.map((a) => (
              <button
                key={a.key}
                type="button"
                aria-pressed={a.key === artifactKey}
                onClick={() => setArtifactKey(a.key)}
                className={segmentClass(a.key === artifactKey)}
              >
                <span>{a.label}</span>
                {a.timestamp && <span className="text-[11px] font-normal text-muted">{a.timestamp} ET</span>}
              </button>
            ))}
          </div>

          {fileLoading && <p className="text-sm text-muted">Loading…</p>}
          {!fileLoading && fileError && <p className="text-sm text-[var(--danger-text)]">{fileError}</p>}
          {!fileLoading && !fileError && view && (
            view.mime.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={view.src}
                alt={current?.label || "Signed BOL"}
                className="max-w-full max-h-[70vh] object-contain mx-auto rounded-lg border border-[var(--border)]"
              />
            ) : (
              <PdfViewer src={view.src} filename={filename} title={current?.label || "Signed BOL"} />
            )
          )}
        </div>
      )}
    </Modal>
  );

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] transition-colors cursor-pointer whitespace-nowrap"
        title="View the signed Bill of Lading"
      >
        <FileCheck size={14} aria-hidden="true" className="text-muted" />
        Signed BOL
      </button>
      {isOpen && typeof document !== "undefined" ? createPortal(modal, document.body) : null}
    </>
  );
}
