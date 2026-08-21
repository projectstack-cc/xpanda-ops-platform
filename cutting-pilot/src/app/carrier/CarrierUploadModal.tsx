"use client";

import { useState } from "react";
import Modal from "@/components/Modal";

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

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const b64 = dataUrl.split(",")[1] || "";
      if (b64.length > MAX_BASE64_LEN) {
        setError("Photo is too large — please retake at a lower resolution.");
        setPreview(null);
        setBase64(null);
        return;
      }
      setPreview(dataUrl);
      setBase64(b64);
    };
    reader.readAsDataURL(file);
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
      if (!res.ok || !data.ok) {
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
      title={`Upload BOL — INV# ${row.invoice_number || "—"}${row.suffix}`}
    >
      <div className="space-y-3">
        <label
          htmlFor="carrier-upload-photo"
          className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold cursor-pointer"
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
          <img src={preview} alt="Signed BOL preview" className="w-full rounded-md border border-[var(--border)]" />
        )}

        {error && (
          <p className="text-sm font-semibold text-[var(--danger-bg)]">{error}</p>
        )}

        <button
          type="button"
          disabled={!base64 || submitting}
          onClick={handleSubmit}
          className="w-full min-h-[44px] px-4 rounded-md bg-[var(--accent)] text-[var(--surface)] text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? "Uploading…" : "Submit"}
        </button>

        <p className="text-xs text-[var(--text-hint)]">
          Use this only if the driver didn&apos;t scan the QR. This marks the load delivered.
        </p>
      </div>
    </Modal>
  );
}
