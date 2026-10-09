"use client";
// src/components/loading/LoadedChecklistModal.tsx
// Ports legacy's "Mark Loaded" checklist (logistics/loading.html openLoadedChecklist /
// confirmLoadedChecklist / handleLoadingPhotoSelected / compressPhoto) as a real component
// composing the shared Modal primitive -- no forked modal markup. Owns its own network calls
// (PUT loading-assignments + POST loading-photos per pending photo) and reports back via onDone
// so the board can refetch (recompute, don't replay -- same rule as unit 2).
// dock-05: capture UI lives in PhotoPicker and uploads go through uploadLoadingPhoto; a failed
// upload keeps the modal open (status already saved) with "Retry upload" instead of closing silently.
import { useState } from "react";
import { X } from "lucide-react";
import Modal from "@/components/Modal";
import { uploadLoadingPhoto } from "@/lib/loadingPhotos";
import PhotoPicker, { type PendingPhoto } from "./PhotoPicker";
import type { DockAssignment } from "./dockTypes";

interface LoadedChecklistModalProps {
  assignment: DockAssignment | null;
  onClose: () => void;
  onDone: () => void;
}

export default function LoadedChecklistModal({ assignment, onClose, onDone }: LoadedChecklistModalProps) {
  const [qtyVerified, setQtyVerified] = useState(false);
  const [paperworkSecured, setPaperworkSecured] = useState(false);
  const [changesIssues, setChangesIssues] = useState(false);
  const [changesNotes, setChangesNotes] = useState("");
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // dock-05: the PUT succeeded but a photo upload failed -- checklist is locked, only uploads retry.
  const [statusSaved, setStatusSaved] = useState(false);

  function reset() {
    setQtyVerified(false);
    setPaperworkSecured(false);
    setChangesIssues(false);
    setChangesNotes("");
    setPhotos([]);
    setError(null);
    setSaving(false);
    setStatusSaved(false);
  }

  function handleClose() {
    // dock-05: once the status is saved the board must refetch, even if photos are still pending.
    const saved = statusSaved;
    reset();
    if (saved) onDone();
    else onClose();
  }

  async function handleConfirm() {
    if (!assignment) return;
    if (!statusSaved) {
      if (!qtyVerified) {
        setError("Confirm quantities have been counted and verified.");
        return;
      }
      if (!paperworkSecured) {
        setError("Confirm the paperwork was secured inside the trailer.");
        return;
      }
      setError(null);
      setSaving(true);

      const checklist = {
        qty_verified: true,
        changes_issues: changesIssues,
        changes_notes: changesIssues ? changesNotes.trim() : "",
        paperwork_secured: true,
        completed_at: new Date().toISOString(),
      };

      try {
        const res = await fetch("/v2/api/loading-assignments", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: assignment.id,
            loading_status: "loaded",
            ready_checklist: JSON.stringify(checklist),
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setError(json.error || "Couldn't mark this load as loaded.");
          setSaving(false);
          return;
        }
        setStatusSaved(true);
      } catch {
        setError("Network error — couldn't reach the server.");
        setSaving(false);
        return;
      }
    } else {
      setError(null);
      setSaving(true);
    }

    // Sequential uploads; each success drops out of the pending list, failures stay for a retry.
    const total = photos.length;
    const failedPhotos: PendingPhoto[] = [];
    let firstError: string | null = null;
    for (const photo of photos) {
      const result = await uploadLoadingPhoto({
        assignmentId: assignment.id,
        jobId: assignment.job_id,
        dataUrl: photo.dataUrl,
        filename: photo.filename,
      });
      if (result.ok) {
        setPhotos((prev) => prev.filter((p) => p !== photo));
      } else {
        failedPhotos.push(photo);
        if (!firstError) firstError = result.error;
      }
    }

    if (failedPhotos.length === 0) {
      reset();
      onDone();
      return;
    }
    setSaving(false);
    setError(
      `Load is marked loaded, but ${failedPhotos.length} of ${total} photo(s) didn't upload: ${(firstError ?? "").replace(/\.$/, "")}. Tap "Retry upload", or close and add photos later from the card's Photos button.`
    );
  }

  return (
    <Modal isOpen={!!assignment} onClose={handleClose} title="Loading completion checklist">
      <p className="text-xs text-muted">Confirm the following before marking this load complete.</p>

      <label className="flex items-start gap-2.5 cursor-pointer text-sm text-text">
        <input
          type="checkbox"
          checked={qtyVerified}
          onChange={(e) => setQtyVerified(e.target.checked)}
          disabled={statusSaved}
          className="mt-0.5 w-[18px] h-[18px] shrink-0"
        />
        Have all quantities been counted and verified?
      </label>

      <label className="flex items-start gap-2.5 cursor-pointer text-sm text-text">
        <input
          type="checkbox"
          checked={changesIssues}
          onChange={(e) => setChangesIssues(e.target.checked)}
          disabled={statusSaved}
          className="mt-0.5 w-[18px] h-[18px] shrink-0"
        />
        Were there any changes or issues?
      </label>
      {changesIssues && (
        <textarea
          value={changesNotes}
          onChange={(e) => setChangesNotes(e.target.value)}
          disabled={statusSaved}
          rows={3}
          placeholder="Describe changes or issues…"
          className="w-full ml-7 px-3 py-2 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm resize-vertical"
        />
      )}

      <label className="flex items-start gap-2.5 cursor-pointer text-sm text-text">
        <input
          type="checkbox"
          checked={paperworkSecured}
          onChange={(e) => setPaperworkSecured(e.target.checked)}
          disabled={statusSaved}
          className="mt-0.5 w-[18px] h-[18px] shrink-0"
        />
        Was the paperwork secured inside the trailer?
      </label>

      <div className="border-t border-[var(--line)] pt-3 space-y-2">
        <p className="text-xs font-semibold text-muted">Photos (optional)</p>
        <PhotoPicker onPicked={(p) => setPhotos((prev) => [...prev, ...p])} disabled={saving} />
        {photos.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {photos.map((p, i) => (
              <div key={i} className="relative w-20 h-20 rounded overflow-hidden border border-[var(--card-border)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.dataUrl} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center cursor-pointer"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-[var(--danger-text)]">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={handleClose}
          className="min-h-[44px] px-4 rounded border border-[var(--card-border)] bg-[var(--card-bg)] text-sm font-semibold text-text cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={saving}
          className="min-h-[44px] px-4 rounded bg-[var(--primary-bg)] text-[var(--primary-text)] text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-default"
        >
          {saving ? "Saving…" : statusSaved ? "Retry upload" : "Confirm & mark loaded"}
        </button>
      </div>
    </Modal>
  );
}
