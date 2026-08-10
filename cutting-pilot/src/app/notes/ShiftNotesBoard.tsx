"use client";
// Blog-style shift note list: New note composer up top, accordion rows below.
// Fully decoupled from jobs — no job_id anywhere in this surface.
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import NoteRow from "./NoteRow";
import NoteComposer from "./NoteComposer";

export interface ShiftNote {
  id: string;
  subject: string;
  body: string;
  author_name: string;
  created_at: string;
  viewed_at: string | null;
  viewed_by_name: string | null;
}

export default function ShiftNotesBoard() {
  const [notes, setNotes] = useState<ShiftNote[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const fetchNotes = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/v2/api/notes");
      const data = await res.json();
      if (data.ok) {
        setNotes(data.notes);
        setCanManage(!!data.can_manage);
      } else {
        setError(data.error || "Failed to load shift notes.");
      }
    } catch {
      setError("Network error — check connection.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center justify-between border-b border-border bg-surface px-4 py-3">
        <h2 className="text-sm font-semibold text-text">Shift Notes</h2>
        <button
          type="button"
          onClick={() => setComposerOpen(true)}
          className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 bg-[var(--primary-bg)] text-[var(--primary-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Plus size={15} aria-hidden="true" />
          New note
        </button>
      </div>

      {loading ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="border border-border rounded px-4 py-3 animate-pulse motion-reduce:animate-none"
            >
              <div className="h-4 bg-[var(--ghost-bg)] rounded w-56 mb-2" />
              <div className="h-3 bg-[var(--ghost-bg)] rounded w-32" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="px-4 py-4">
              <div className="border border-border rounded px-3 py-3 space-y-1.5">
                <p className="text-sm text-[var(--danger-bg)] font-medium">{error}</p>
                <button
                  type="button"
                  onClick={() => fetchNotes()}
                  className="text-xs text-muted underline underline-offset-2 cursor-pointer hover:text-text"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {!error && notes.length === 0 && (
            <div className="px-4 py-10 text-center space-y-3">
              <p className="text-sm text-muted">No shift notes yet. Add the first one.</p>
              <button
                type="button"
                onClick={() => setComposerOpen(true)}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--primary-bg)] text-[var(--primary-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <Plus size={15} aria-hidden="true" />
                New note
              </button>
            </div>
          )}

          {!error &&
            notes.map((note) => (
              <NoteRow key={note.id} note={note} canManage={canManage} onViewed={() => fetchNotes(true)} />
            ))}
        </div>
      )}

      <NoteComposer
        isOpen={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={() => fetchNotes(true)}
      />
    </div>
  );
}
