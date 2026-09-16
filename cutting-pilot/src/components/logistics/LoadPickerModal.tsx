"use client";
// src/components/logistics/LoadPickerModal.tsx
// lb-ui-04 Part C (react-component-agent §9b). List/load/delete UI for saved_loads -- the SAME
// table legacy's own SKU-tab-adjacent "Saved Loads" modal reads (load-builder.html:2850-2932), so
// this list can contain legacy-authored rows too. Loading a legacy row calls deserializeSnapshot
// (savedLoad.ts), which returns a typed reject reason rather than throwing -- shown inline per row
// rather than crashing "Load".
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import Modal from "@/components/Modal";
import { deserializeSnapshot, type SavedLoadListItem, type SavedLoadRecord, type SavedLoadSnapshot } from "@/lib/savedLoad";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onLoad: (record: SavedLoadRecord, snapshot: SavedLoadSnapshot) => void;
}

export default function LoadPickerModal({ isOpen, onClose, onLoad }: Props) {
  const [loads, setLoads] = useState<SavedLoadListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [fenced, setFenced] = useState(false);

  async function refetch() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/v2/api/saved-loads");
      const body = await res.json();
      if (!res.ok || !body?.ok) throw new Error(body?.error || "Failed to load saved loads.");
      setLoads((body.loads as SavedLoadListItem[]) || []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load saved loads.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    setRowError({});
    setFenced(false);
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function handleLoad(item: SavedLoadListItem) {
    setLoadingId(item.id);
    setRowError((e) => ({ ...e, [item.id]: "" }));
    try {
      const res = await fetch(`/v2/api/saved-loads/${encodeURIComponent(item.id)}`);
      const body = await res.json();
      if (!res.ok || !body?.ok) {
        setRowError((e) => ({ ...e, [item.id]: body?.error || "Failed to load." }));
        return;
      }
      const record = body.load as SavedLoadRecord;
      const result = deserializeSnapshot(record.state_json);
      if (!result.ok) {
        setRowError((e) => ({ ...e, [item.id]: result.reason }));
        return;
      }
      onLoad(record, result.snapshot);
    } catch {
      setRowError((e) => ({ ...e, [item.id]: "Network error." }));
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDeleteConfirm(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/v2/api/saved-loads/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = await res.json();
      if (res.status === 501) {
        setFenced(true);
        return;
      }
      if (!res.ok || !body?.ok) {
        setRowError((e) => ({ ...e, [id]: body?.error || "Failed to delete." }));
        return;
      }
      setConfirmDeleteId(null);
      await refetch();
    } catch {
      setRowError((e) => ({ ...e, [id]: "Network error." }));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Load a saved load" size="lg">
      {fenced && (
        <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3">
          Deleting is disabled in the v2 preview phase. Use the legacy Logistics dashboard to delete this saved load for now.
        </div>
      )}
      {loadError && <p className="text-sm text-[var(--danger-text)] px-1">{loadError}</p>}
      <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1">
        {loading && <p className="text-sm text-muted px-2 py-3">Loading…</p>}
        {!loading && !loadError && loads.length === 0 && <p className="text-sm text-muted px-2 py-3">No saved loads yet.</p>}
        <div className="space-y-2">
          {loads.map((item) => {
            const isConfirming = confirmDeleteId === item.id;
            const err = rowError[item.id];
            return (
              <div key={item.id} className="rounded-md border border-[var(--card-border)] px-3 py-2 space-y-1.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-text truncate">{item.name || "Unnamed"}</div>
                    <div className="text-xs text-muted font-mono tabular-nums truncate">
                      {[item.customer, item.trailer_type, `saved ${new Date(item.updated_at).toLocaleDateString()}`].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {!isConfirming && (
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleLoad(item)}
                        disabled={loadingId === item.id}
                        className="px-3 py-1.5 rounded-lg text-[13px] font-semibold min-h-[36px] cursor-pointer border border-[var(--brand)] text-[var(--brand)] hover:bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] disabled:opacity-50"
                      >
                        {loadingId === item.id ? "Loading…" : "Load"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(item.id)}
                        className="p-1.5 rounded-md text-[var(--danger-text)] hover:bg-[color-mix(in_srgb,var(--danger-bg)_10%,transparent)] cursor-pointer"
                        aria-label={`Delete ${item.name || "saved load"}`}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  {isConfirming && (
                    <div className="w-full flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-[var(--danger-text)]">Delete &quot;{item.name || "Unnamed"}&quot; permanently?</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteConfirm(item.id)}
                        disabled={deletingId === item.id}
                        className="px-2.5 py-1 rounded-md text-xs font-semibold bg-[var(--danger-bg)] text-white cursor-pointer disabled:opacity-50"
                      >
                        {deletingId === item.id ? "Deleting…" : "Confirm delete"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2.5 py-1 rounded-md text-xs font-semibold border border-[var(--border)] text-muted cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                {err && <p className="text-xs text-[var(--danger-text)]">{err}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
