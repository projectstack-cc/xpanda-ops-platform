"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { compressPhoto } from "@/lib/compressPhoto";

interface CarrierRow {
  invoice_number: string | null;
  suffix: string;
  access_token: string | null;
  loading_status: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  row: CarrierRow;
  onDone: () => void;
}

const MAX_BASE64_LEN = 3 * 1024 * 1024;

export default function CarrierUploadModal({ isOpen, onClose, row, onDone }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const delivered = row.loading_status === "delivered";

  // quickwin-09: downscale before upload instead of bouncing full-res phone photos. 2000 px / 0.8
  // (larger than the dock checklist's 1200 / 0.6) — this is a signed legal document, so signatures
  // and handwriting must stay legible. The server stores carrier uploads as image/jpeg regardless.
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPreparing(true);
    try {
      const dataUrl = await compressPhoto(file, 2000, 0.8);
      const b64 = dataUrl.split(",")[1] || "";
      if (b64.length > MAX_BASE64_LEN) {
        setError("Couldn't shrink this photo enough — please try again.");
        setPreview(null);
        setBase64(null);
        return;
      }
      setPreview(dataUrl);
      setBase64(b64);
    } catch {
      setError("Couldn't read this photo — please try another.");
      setPreview(null);
      setBase64(null);
    } finally {
      setPreparing(false);
    }
  }

  async function handleSubmit() {
    if (!base64 || !row.access_token) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/bol-delivery/${row.access_token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "carrier_upload", signed_photo_base64: base64 }),
      });
      const data = await res.json().catch(() => ({}));
      // Success = a fresh delivery ({stage:'delivered'}) or a post-delivery physical-copy store
      // ({stored:'carrier_upload'}).
      const succeeded = res.ok && data.ok && (data.stored === "carrier_upload" || data.stage === "delivered");
      if (!succeeded) {
        setError(data.error || `Upload failed (${res.status}).`);
        setSubmitting(false);
        return;
      }
      onDone();
      onClose();
    } catch {
      setError("Network error — could not reach the server.");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${delivered ? "Upload physical BOL" : "Upload BOL"} — INV# ${row.invoice_number || "—"}${row.suffix}`}
    >
      <div className="space-y-3">
        <label
          htmlFor="carrier-upload-photo"
          className="inline-flex items-center justify-center min-h-[44px] px-4 rounded border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold cursor-pointer"
        >
          📷 Take / choose photo
        </label>
        <input
          id="carrier-upload-photo"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFile}
          className="hidden"
        />

        {preview && (
          <img src={preview} alt="Signed BOL preview" className="w-full rounded border border-[var(--border)]" />
        )}

        {error && (
          <p className="text-sm font-semibold text-[var(--danger-bg)]">{error}</p>
        )}

        <button
          type="button"
          disabled={!base64 || submitting || preparing}
          onClick={handleSubmit}
          className="w-full min-h-[44px] px-4 rounded bg-[var(--accent)] text-[var(--surface)] text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {preparing ? "Preparing photo…" : submitting ? "Uploading…" : "Submit"}
        </button>

        <p className="text-xs text-[var(--text-hint)]">
          {delivered
            ? "Upload your physical copy with any edits. The driver-signed copy is kept."
            : "Use this only if the driver didn’t scan the QR. This marks the load delivered."}
        </p>
      </div>
    </Modal>
  );
}
