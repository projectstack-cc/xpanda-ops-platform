"use client";
// src/components/marina/EditJobModal.tsx — marina-04
// Edit a Marina job's name / customer / notes (PATCH /jobs/{id}); the parent re-fetches on save.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import type { MarinaJob } from "@/lib/marina/types";
import { JobFields, jobFieldsValid, type JobFieldValues } from "./NewJobModal";
import { ERROR_TEXT, GHOST, PRIMARY, jsonInit, marinaFetch } from "./ui";

interface Props { job: MarinaJob; isOpen: boolean; onClose: () => void; onSaved: () => void; }

export default function EditJobModal({ job, isOpen, onClose, onSaved }: Props) {
  const [values, setValues] = useState<JobFieldValues>({ name: "", customer: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setValues({ name: job.name, customer: job.customer ?? "", notes: job.notes ?? "" });
      setError(null);
    }
  }, [isOpen, job]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!jobFieldsValid(values) || busy) return;
    setBusy(true);
    setError(null);
    const r = await marinaFetch(`/jobs/${encodeURIComponent(job.id)}`, jsonInit("PATCH", values));
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={busy ? () => {} : onClose} title="Edit job">
      <form onSubmit={submit} className="space-y-4">
        <JobFields values={values} onChange={setValues} />
        {error && <p role="alert" className={ERROR_TEXT}>{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={PRIMARY} disabled={busy || !jobFieldsValid(values)}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
