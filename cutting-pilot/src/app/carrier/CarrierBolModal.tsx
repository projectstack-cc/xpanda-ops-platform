"use client";
// src/app/carrier/CarrierBolModal.tsx
// Carrier View "View BOL": renders the UNSIGNED BOL live from bolShared (via bolDomGlue's
// buildCombinedBolPdf — the same packet logistics prints). There is no stored unsigned PDF by
// design. Consumer only — never modify bolShared.ts / bol-shared.js from here.
import { useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal";
import PdfViewer from "@/components/PdfViewer";
import { buildCombinedBolPdf } from "@/lib/bolDomGlue";
import type { BolRecord } from "@/lib/bolShared";

interface Props {
  token: string | null;
  title: string;
  onClose: () => void;
}

export default function CarrierBolModal({ token, title, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [bolNumber, setBolNumber] = useState<string>("");
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setSrc(null);
    setError(null);
    if (!token) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(`/v2/api/carrier/bol?token=${encodeURIComponent(token)}`);
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !json.ok || !json.bol) {
          setError(json.error || `Could not load the BOL (${res.status}).`);
          return;
        }
        // The route never echoes the token back; re-attach the one this page already holds so the
        // rendered driver QR matches the BOL logistics printed.
        const bol: BolRecord = { ...json.bol, access_token: token };
        setBolNumber(String(bol.bol_number || ""));
        const bytes = await buildCombinedBolPdf([bol]);
        if (cancelled) return;
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
        blobUrlRef.current = url;
        setSrc(url);
      } catch {
        if (!cancelled) setError("Could not render the BOL.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        try {
          URL.revokeObjectURL(blobUrlRef.current);
        } catch {
          // already revoked
        }
        blobUrlRef.current = null;
      }
    };
  }, [token]);

  return (
    <Modal isOpen={!!token} onClose={onClose} title={title} size="xl">
      {loading && <p className="text-sm text-[var(--text-hint)] py-6 text-center">Building BOL…</p>}
      {error && !loading && (
        <p className="text-sm font-semibold text-[var(--danger-text)] py-6 text-center">{error}</p>
      )}
      {!loading && !error && src && (
        <PdfViewer src={src} filename={`BOL_${bolNumber || "carrier"}.pdf`} title="Bill of Lading" height={560} />
      )}
    </Modal>
  );
}
