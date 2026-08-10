"use client";
// "New note" composer — composes the shared Modal primitive. No author field: identity
// comes from the server (X-User-Id/X-User-Name headers), never a client form.
import { useState } from "react";
import Modal from "@/components/Modal";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function NoteComposer({ isOpen, onClose, onCreated }: Props) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSubject("");
    setBody("");
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function submit() {
    if (!subject.trim() || !body.trim()) {
      setError("Subject and body are both required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/v2/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject.trim(), body: body.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        reset();
        onCreated();
        onClose();
      } else {
        setError(data.error || "Failed to save note.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New shift note">
      <div className="space-y-3">
        <div>
          <label htmlFor="note-subject" className="block text-xs font-medium text-muted mb-1">
            Subject
          </label>
          <input
            id="note-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Wire break on line 3"
            className="min-h-[44px] w-full rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        <div>
          <label htmlFor="note-body" className="block text-xs font-medium text-muted mb-1">
            Note
          </label>
          <textarea
            id="note-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder="What happened, what was done, anything the next shift should know…"
            className="w-full rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>

        {error && (
          <p className="text-sm text-[var(--danger-bg)]" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={handleClose}
            className="min-h-[44px] px-4 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={submit}
            className="min-h-[44px] px-4 py-2 bg-[var(--primary-bg)] text-[var(--primary-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {submitting ? "Saving…" : "Add note"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
