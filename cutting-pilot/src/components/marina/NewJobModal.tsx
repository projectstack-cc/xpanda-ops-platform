"use client";
// src/components/marina/NewJobModal.tsx — marina-04
// Create a Marina job (POST /jobs: name 1–120, customer ≤ 80, notes ≤ 2000), then go straight to it.
// JobFields is shared with EditJobModal.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import type { MarinaJob } from "@/lib/marina/types";
import { ERROR_TEXT, GHOST, INPUT, LABEL, PRIMARY, TEXTAREA, jsonInit, marinaFetch } from "./ui";

export interface JobFieldValues { name: string; customer: string; notes: string; }

export function JobFields({ values, onChange }: { values: JobFieldValues; onChange: (v: JobFieldValues) => void }) {
  return (
    <div className="space-y-3">
      <label className={LABEL}>
        Name *
        <input
          className={INPUT}
          value={values.name}
          maxLength={120}
          required
          autoFocus
          onChange={(e) => onChange({ ...values, name: e.target.value })}
        />
      </label>
      <label className={LABEL}>
        Customer
        <input className={INPUT} value={values.customer} maxLength={80} onChange={(e) => onChange({ ...values, customer: e.target.value })} />
      </label>
      <label className={LABEL}>
        Notes
        <textarea className={TEXTAREA} value={values.notes} maxLength={2000} onChange={(e) => onChange({ ...values, notes: e.target.value })} />
      </label>
    </div>
  );
}

export function jobFieldsValid(v: JobFieldValues): boolean {
  const n = v.name.trim();
  return n.length >= 1 && n.length <= 120 && v.customer.trim().length <= 80 && v.notes.length <= 2000;
}

interface Props { isOpen: boolean; onClose: () => void; }

export default function NewJobModal({ isOpen, onClose }: Props) {
  const [values, setValues] = useState<JobFieldValues>({ name: "", customer: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setValues({ name: "", customer: "", notes: "" });
      setError(null);
    }
  }, [isOpen]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!jobFieldsValid(values) || busy) return;
    setBusy(true);
    setError(null);
    const r = await marinaFetch<{ job: MarinaJob }>("/jobs", jsonInit("POST", values));
    if (!r.ok) {
      setError(r.error);
      setBusy(false);
      return;
    }
    window.location.href = `/v2/qc/marina/${encodeURIComponent(r.data.job.id)}`;
  }

  return (
    <Modal isOpen={isOpen} onClose={busy ? () => {} : onClose} title="New Marina job">
      <form onSubmit={submit} className="space-y-4">
        <JobFields values={values} onChange={setValues} />
        {error && <p role="alert" className={ERROR_TEXT}>{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={PRIMARY} disabled={busy || !jobFieldsValid(values)}>
            {busy ? "Creating…" : "Create job"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
