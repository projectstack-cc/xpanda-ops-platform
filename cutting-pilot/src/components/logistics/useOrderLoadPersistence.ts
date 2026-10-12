"use client";
// src/components/logistics/useOrderLoadPersistence.ts
// lbr-04: everything about saving a Load Builder load to its order, in one hook so lbr-05's new UI
// can reuse it unchanged. Steve (2026-10-12): the logistics manager forgets to save and has to
// rebuild loads, so a load built for an order is saved to it automatically when BOLs are generated,
// reopened on ?job_id=, never expires, and leaving with unsaved changes asks first.
//
// Rule: at most one saved load per order. Every save (auto, leave-prompt or the manual Save button)
// goes through persist(), which targets the open load, else the order's existing row, else a new
// row (resolveOrderSaveTarget).
//
// Dirty tracking compares snapshotKey(currentSnapshot) with the key last saved or loaded. The leave
// guard arms whenever the load is dirty — "unsaved", but also after a failed save ("error") or while
// one is in flight ("saving") — since in all three the work isn't on the server yet.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSavePayload,
  defaultSaveName,
  resolveOrderSaveTarget,
  snapshotKey,
  type SavedLoadListItem,
  type SavedLoadRecord,
  type SavedLoadSnapshot,
} from "@/lib/savedLoad";

export type OrderLoadStatus = "none" | "unsaved" | "saving" | "saved" | "error";

export type PersistResult = { ok: true; record: SavedLoadRecord } | { ok: false; error: string };

export interface UseOrderLoadPersistenceArgs {
  jobId: string | null;
  customer: string;
  currentSnapshot: SavedLoadSnapshot | null;
  currentSavedLoadId: string | null;
  currentSavedLoadName: string | null;
  setCurrentSavedLoadId: (id: string | null) => void;
  setCurrentSavedLoadName: (name: string | null) => void;
}

const FENCED_MESSAGE = "Saving is disabled in the v2 preview phase. Use the legacy Logistics dashboard to save this load for now.";

/** The order's newest saved load as a full record (state_json included), or null when it has none. */
export async function findSavedForJob(jobId: string): Promise<SavedLoadRecord | null> {
  const listRes = await fetch(`/v2/api/saved-loads?job_id=${encodeURIComponent(jobId)}`);
  const list = await listRes.json();
  if (!listRes.ok || !list.ok) throw new Error(list.error || `HTTP ${listRes.status}`);
  const newest = (list.loads as SavedLoadListItem[])[0];
  if (!newest) return null;
  const res = await fetch(`/v2/api/saved-loads/${encodeURIComponent(newest.id)}`);
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.load as SavedLoadRecord;
}

// A plain left click on a link that would leave this page (not new-tab, not download, not a
// same-page #hash jump) — the clicks the leave guard intercepts.
function leavingHref(e: MouseEvent): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor) return null;
  const rawHref = anchor.getAttribute("href") ?? "";
  if (!rawHref || rawHref.startsWith("#")) return null;
  if (anchor.hasAttribute("download")) return null;
  const target = anchor.getAttribute("target");
  if (target && target !== "_self") return null;
  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const here = window.location;
  if (url.origin === here.origin && url.pathname === here.pathname && url.search === here.search) return null;
  return url.href;
}

export function useOrderLoadPersistence(args: UseOrderLoadPersistenceArgs) {
  const { jobId, currentSnapshot } = args;

  const [lastSavedKey, setLastSavedKey] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const currentKey = useMemo(() => (currentSnapshot ? snapshotKey(currentSnapshot) : null), [currentSnapshot]);
  const dirty = currentKey !== null && currentKey !== lastSavedKey;
  const status: OrderLoadStatus = !currentSnapshot ? "none" : saving ? "saving" : error && dirty ? "error" : dirty ? "unsaved" : "saved";

  // Latest values for async callers (the BOL modal's onClose, the leave modal) so a save never
  // writes a stale snapshot or targets a stale row.
  const latest = useRef(args);
  latest.current = args;
  // Set just before an intentional navigation so the beforeunload prompt doesn't fire on it.
  const bypassUnload = useRef(false);

  const markSaved = useCallback((snapshot: SavedLoadSnapshot, at?: string) => {
    setLastSavedKey(snapshotKey(snapshot));
    setSavedAt(at ?? new Date().toISOString());
    setError(null);
  }, []);

  /** Save the current load. Order-linked: open load -> the order's existing row -> new row. */
  const persist = useCallback(
    async (nameOverride?: string): Promise<PersistResult> => {
      const a = latest.current;
      const snapshot = a.currentSnapshot;
      if (!snapshot) return { ok: false, error: "Nothing to save yet." };
      setSaving(true);
      setError(null);
      try {
        const existing = !a.currentSavedLoadId && a.jobId ? await findSavedForJob(a.jobId) : null;
        const target = resolveOrderSaveTarget(a.currentSavedLoadId, existing);
        const name = nameOverride ?? a.currentSavedLoadName ?? existing?.name ?? defaultSaveName(a.customer);
        const payload = buildSavePayload(name, a.customer, snapshot);
        const res = await fetch(target.method === "PUT" ? `/v2/api/saved-loads/${encodeURIComponent(target.id)}` : "/v2/api/saved-loads", {
          method: target.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 501) throw new Error(FENCED_MESSAGE);
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const record = data.load as SavedLoadRecord;
        a.setCurrentSavedLoadId(record.id);
        a.setCurrentSavedLoadName(record.name);
        markSaved(snapshot, record.updated_at);
        return { ok: true, record };
      } catch (e: unknown) {
        const message = e instanceof TypeError ? "Network error." : e instanceof Error ? e.message : "Save failed.";
        setError(message);
        return { ok: false, error: message };
      } finally {
        setSaving(false);
      }
    },
    [markSaved]
  );

  /** Save to the pulled order under its current (or default) name. Requires a jobId. */
  const saveToOrder = useCallback(async (): Promise<boolean> => {
    if (!latest.current.jobId) return false;
    const r = await persist();
    return r.ok;
  }, [persist]);

  // --- Leave guard ---

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (bypassUnload.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      const href = leavingHref(e);
      if (!href) return;
      // Capture phase on document runs before React's root listeners, so stopping here keeps
      // next/link from client-navigating; preventDefault stops a plain <a> as well.
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(href);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  const navigate = useCallback((href: string) => {
    bypassUnload.current = true;
    window.location.assign(href);
  }, []);

  /** "save": save to the order, then leave only if the save succeeded (the modal keeps showing
   * the error otherwise). "discard": leave without saving. A custom build (no jobId) can't save
   * to an order — the page opens its named-save flow instead (needsNamedSave) and calls
   * navigatePending() after that save succeeds. */
  const confirmLeave = useCallback(
    async (choice: "save" | "discard") => {
      const href = pendingHref;
      if (!href) return;
      if (choice === "discard") {
        navigate(href);
        return;
      }
      if (!latest.current.jobId) return;
      if (await saveToOrder()) navigate(href);
    },
    [pendingHref, navigate, saveToOrder]
  );

  const cancelLeave = useCallback(() => {
    setPendingHref(null);
    setError(null);
  }, []);

  const navigatePending = useCallback(() => {
    if (pendingHref) navigate(pendingHref);
  }, [pendingHref, navigate]);

  return {
    status,
    savedAt,
    error,
    saving,
    persist,
    saveToOrder,
    markSaved,
    findSavedForJob,
    pendingHref,
    confirmLeave,
    cancelLeave,
    navigatePending,
    needsNamedSave: !jobId,
  };
}
