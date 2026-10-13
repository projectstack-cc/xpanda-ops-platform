"use client";
// src/components/loading/ShippingInfoModal.tsx
// Port of legacy logistics/loading.html's Shipping Info modal (openShippingInfo/
// populateShippingInfo), opened from a card's INV# link. Composes the shared Modal primitive
// (no hand-rolled backdrop). The job cache is owned by DockBoard (a plain Map, matching
// legacy's module-level shippingInfoJobCache) so reopening the same job's info is instant.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import type { DockAssignment } from "./dockTypes";

interface Job {
  invoice_number?: string | null;
  customer?: string | null;
  ship_to_company?: string | null;
  ship_to_attention?: string | null;
  ship_to_street?: string | null;
  ship_to_street2?: string | null;
  ship_to_city?: string | null;
  ship_to_state?: string | null;
  ship_to_zip?: string | null;
  ship_to_contact_name?: string | null;
  ship_to_phone?: string | null;
  ship_to_email?: string | null;
  po_number?: string | null;
  ship_date?: string | null;
  delivery_time?: string | null;
  carrier?: string | null;
  method?: string | null;
  notes?: string | null;
}

interface ShippingInfoModalProps {
  assignment: DockAssignment | null;
  jobCache: Map<string, Job>;
  onClose: () => void;
}

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(String(ts).replace(" ", "T"));
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
}

function fmtShipDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 mb-1.5">
      <span className="min-w-[110px] shrink-0 text-muted font-semibold">{label}</span>
      <span className="text-text">{value}</span>
    </div>
  );
}

export default function ShippingInfoModal({ assignment, jobCache, onClose }: ShippingInfoModalProps) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!assignment) {
      setJob(null);
      setError(null);
      return;
    }
    const cached = jobCache.get(assignment.job_id);
    if (cached) {
      setJob(cached);
      setError(null);
      return;
    }
    setJob(null);
    setError(null);
    setLoading(true);
    fetch(`/v2/api/jobs/${encodeURIComponent(assignment.job_id)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok || !json.job) {
          setError("Couldn't load shipping info.");
          return;
        }
        jobCache.set(assignment.job_id, json.job);
        setJob(json.job);
      })
      .catch(() => setError("Couldn't load shipping info."))
      .finally(() => setLoading(false));
  }, [assignment, jobCache]);

  return (
    <Modal isOpen={!!assignment} onClose={onClose} title="Shipping information">
      {loading && !job && !error && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-[var(--danger-ink)]">{error}</p>}
      {assignment && job && (
        <div className="text-sm leading-relaxed">
          <div className="font-bold text-text mb-2.5 flex items-center gap-2 flex-wrap">
            INV# {assignment.invoice_number || job.invoice_number || "—"}
            {(assignment.load_count ?? 1) > 1 && (
              <span className="text-xs font-bold text-[#6366f1]">
                {assignment.load_number ?? 1} of {assignment.load_count}
              </span>
            )}
            {assignment.load_ship_date && (
              <span className="text-xs font-bold text-muted">🗓️ {fmtShipDay(assignment.load_ship_date)}</span>
            )}
          </div>
          <Row label="Customer" value={job.customer} />
          <Row label="Ship to" value={job.ship_to_company} />
          <Row label="Attention" value={job.ship_to_attention} />
          <Row label="Street" value={[job.ship_to_street, job.ship_to_street2].filter(Boolean).join(", ")} />
          <Row label="" value={[job.ship_to_city, job.ship_to_state, job.ship_to_zip].filter(Boolean).join(", ")} />
          <Row label="Contact" value={job.ship_to_contact_name} />
          <Row label="Phone" value={job.ship_to_phone} />
          <Row label="Email" value={job.ship_to_email} />
          <Row label="PO#" value={job.po_number} />
          <Row label="Ship date" value={job.ship_date} />
          <Row label="Delivery time" value={job.delivery_time} />
          <Row label="Carrier" value={job.carrier} />
          <Row label="Method" value={job.method} />
          <Row label="Loading started" value={fmtTs(assignment.started_at)} />
          <Row label="Loading completed" value={fmtTs(assignment.loaded_at)} />
          <Row label="Notes" value={job.notes} />
        </div>
      )}
    </Modal>
  );
}
