"use client";
// One shift note as a single-tap accordion row. Unviewed notes carry a danger-tinted
// background + a small "● new" marker; viewed notes are flat surface with a
// "✓ viewed by {name}" meta suffix. Manager Mark-viewed lives inside the expanded panel.
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import type { ShiftNote } from "./ShiftNotesBoard";

// D1 datetime strings are UTC 'YYYY-MM-DD HH:MM:SS'.
function formatNoteDate(ts: string): string {
  const ms = Date.parse(ts.replace(" ", "T") + "Z");
  if (Number.isNaN(ms)) return ts;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

interface Props {
  note: ShiftNote;
  canManage: boolean;
  onViewed: () => void;
  onDeleted: () => void;
}

export default function NoteRow({ note, canManage, onViewed, onDeleted }: Props) {
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unviewed = !note.viewed_at;
  // Two-step arm/confirm delete (house pattern, lgx-boldel-01) — notes-del-01.
  const [delArmed, setDelArmed] = useState(false);
  const [delBusy, setDelBusy] = useState(false);

  // Auto-disarm after 4s if the second tap never comes.
  useEffect(() => {
    if (!delArmed || delBusy) return;
    const t = setTimeout(() => setDelArmed(false), 4000);
    return () => clearTimeout(t);
  }, [delArmed, delBusy]);

  // Collapsing the row disarms.
  useEffect(() => {
    if (!open) setDelArmed(false);
  }, [open]);

  async function deleteNote() {
    setDelBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/notes?id=${encodeURIComponent(note.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        onDeleted();
      } else {
        setError(data.error || "Failed to delete note.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setDelBusy(false);
      setDelArmed(false);
    }
  }

  async function markViewed() {
    setMarking(true);
    setError(null);
    try {
      const res = await fetch("/v2/api/notes/mark-viewed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: note.id }),
      });
      const data = await res.json();
      if (data.ok) {
        onViewed();
      } else {
        setError(data.error || "Failed to mark viewed.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setMarking(false);
    }
  }

  return (
    <div
      className={[
        "border-b border-border last:border-b-0",
        !unviewed && "bg-surface",
      ]
        .filter(Boolean)
        .join(" ")}
      // Tailwind's opacity-modifier syntax (bg-[var(--x)]/10) doesn't generate a real rule for
      // arbitrary CSS-var backgrounds in this build (verified against the compiled CSS output —
      // it silently fell back to a fully-opaque fill). color-mix() derives the tint from the
      // same --danger-bg token at runtime instead of inventing a new color value.
      style={unviewed ? { backgroundColor: "color-mix(in srgb, var(--danger-bg) 10%, transparent)" } : undefined}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full min-h-[44px] flex items-center gap-3 px-4 py-3 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {open ? (
          <ChevronDown size={16} className="shrink-0 text-muted" aria-hidden="true" />
        ) : (
          <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {unviewed && (
              <span className="text-[var(--danger-bg)] text-xs font-bold shrink-0" aria-hidden="true">
                ●
              </span>
            )}
            <span className="font-medium text-sm text-text truncate">{note.subject}</span>
            {unviewed && (
              <span className="text-[var(--danger-bg)] text-xs font-semibold shrink-0">new</span>
            )}
          </div>
          <p className="text-xs text-muted mt-0.5 truncate">
            {note.author_name} · {formatNoteDate(note.created_at)}
            {note.viewed_at && note.viewed_by_name && (
              <> · <span className="text-[var(--success-bg)]">&#10003; viewed by {note.viewed_by_name}</span></>
            )}
          </p>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pl-11">
          <p className="text-sm text-text whitespace-pre-wrap">{note.body}</p>

          {error && (
            <p className="mt-2 text-sm text-[var(--danger-bg)]" role="alert">
              {error}
            </p>
          )}

          {((canManage && unviewed) || note.can_delete) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {canManage && unviewed && (
                <button
                  type="button"
                  disabled={marking}
                  onClick={markViewed}
                  className="min-h-[44px] px-4 py-2 bg-[var(--success-bg)] text-[var(--success-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  {marking ? "Marking…" : "Mark viewed"}
                </button>
              )}

              {note.can_delete && (
                <button
                  type="button"
                  disabled={delBusy || marking}
                  onClick={() => (delArmed ? deleteNote() : setDelArmed(true))}
                  className={[
                    "min-h-[44px] px-4 py-2 rounded text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                    delArmed
                      ? "bg-[var(--danger-bg)] text-[var(--danger-text)]"
                      : "border border-border text-[var(--danger-bg)]",
                  ].join(" ")}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  {delBusy ? "Deleting…" : delArmed ? "Tap again to delete" : "Delete"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
