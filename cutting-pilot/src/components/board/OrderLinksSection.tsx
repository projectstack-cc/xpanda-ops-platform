"use client";
// src/components/board/OrderLinksSection.tsx
// jb-06 — trailer group link/unlink + Link Combo for the v2 edit modal. Both are immediate-save
// actions through the legacy partial PUT /api/jobs ({ id, trailer_group_id } / { id, combo_id }):
// every trailer-group rule (same ship_date, merging, "never leave a group of one", the 4-stop cap)
// stays server-side in routes/jobs.js — this component only mirrors legacy's candidate filter and
// shows the server's error strings verbatim. Never touches the edit modal's dirty state.
import { useEffect, useRef, useState } from "react";
import { Package, Truck, X } from "lucide-react";
import SearchPickerModal, { type SearchPickerItem } from "@/components/SearchPickerModal";
import { countLocalGroups } from "@/lib/linkedGroups";
// jb-16: most stops per trailer group. The server is authoritative (409 group_full); boardJobs can
// undercount a group, so this only decides what the UI offers.
import { MAX_TRAILER_GROUP_JOBS, stopLabel, isStopLocked } from "@/lib/trailerStops";
import type { BoardJob } from "./ProductionBoard";

interface GroupMember {
  id: string;
  customer: string | null;
  invoice_number: string | null;
  // stops-01: GET /api/jobs/:id/group returns these, in stop order (unset last).
  trailer_stop: number | null;
  status: string | null;
  archived_at: string | null;
}

interface Combo {
  id: string;
  name: string | null;
  description: string | null;
  block_l: number | null;
  block_w: number | null;
  block_h: number | null;
}

interface OrderLinksSectionProps {
  jobId: string;
  /** The SAVED ship date — the server compares against the stored row, not the live form field. */
  shipDate: string | null;
  trailerGroupId: string | null;
  comboId: string | null;
  boardJobs: BoardJob[];
  canEdit: boolean;
  onChanged: () => void;
}

const ghostBtn =
  "min-h-[44px] px-4 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 disabled:cursor-not-allowed";
const chipClass =
  "inline-flex items-center gap-1.5 min-h-[32px] px-2.5 rounded-full bg-[var(--ghost-bg)] text-xs font-medium text-text";

export default function OrderLinksSection({
  jobId, shipDate, trailerGroupId, comboId, boardJobs, canEdit, onChanged,
}: OrderLinksSectionProps) {
  // ── Trailer group ─────────────────────────────────────────────
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [groupBusy, setGroupBusy] = useState<"link" | "unlink" | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  // jb-16: adding a stop leaves trailerGroupId unchanged, so it needs its own members re-read.
  const [membersVersion, setMembersVersion] = useState(0);

  useEffect(() => {
    if (!trailerGroupId) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    setMembersLoading(true);
    fetch(`/api/jobs/${encodeURIComponent(jobId)}/group`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return;
        setMembers(ok && d?.ok && Array.isArray(d.members) ? d.members : []);
      })
      .catch(() => { if (!cancelled) setMembers([]); })
      .finally(() => { if (!cancelled) setMembersLoading(false); });
    return () => { cancelled = true; };
  }, [jobId, trailerGroupId, membersVersion]);

  const boardGroupCounts = countLocalGroups(boardJobs);
  // The server's member list once loaded; the board's count while it loads (or if it failed).
  const groupSize = !membersLoading && members.length > 0
    ? members.length
    : (trailerGroupId ? boardGroupCounts.get(trailerGroupId) ?? 0 : 0);
  const groupFull = groupSize >= MAX_TRAILER_GROUP_JOBS;

  // Same filter as legacy openTrailerGroupPicker: not self, not archived (the board payload is
  // already non-archived), same ship_date, and unlinked — or, when this job is unlinked too, in a
  // group with room to join. A grouped job never lists other groups (409 group_conflict) or its own.
  const candidates: SearchPickerItem[] = boardJobs
    .filter((j) =>
      j.id !== jobId &&
      (j.ship_date || "") === (shipDate || "") &&
      (!j.trailer_group_id ||
        (!trailerGroupId && (boardGroupCounts.get(j.trailer_group_id) ?? 0) < MAX_TRAILER_GROUP_JOBS)),
    )
    .map((j) => ({
      id: j.id,
      primary: j.customer || "Untitled",
      secondary: `${j.invoice_number || "—"} · ${j.ship_date || "—"}${
        j.trailer_group_id ? ` · in group (${boardGroupCounts.get(j.trailer_group_id) ?? 0})` : ""
      }`,
    }));

  async function putJob(payload: Record<string, unknown>, fallbackError: string): Promise<string | null> {
    try {
      const res = await fetch("/api/jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: jobId, ...payload }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) return data?.error || fallbackError;
      return null;
    } catch {
      return "Network error — couldn't reach the server.";
    }
  }

  async function handleLinkGroup(targetJobId: string) {
    setGroupPickerOpen(false);
    setGroupBusy("link");
    setGroupError(null);
    const err = await putJob({ trailer_group_id: targetJobId }, "Couldn't link this order.");
    setGroupBusy(null);
    if (err) { setGroupError(err); return; }
    setMembersVersion((v) => v + 1);
    onChanged();
  }

  async function handleUnlinkGroup() {
    setGroupBusy("unlink");
    setGroupError(null);
    const err = await putJob({ trailer_group_id: null }, "Couldn't unlink this order.");
    setGroupBusy(null);
    if (err) { setGroupError(err); return; }
    onChanged();
  }

  // ── Combo ─────────────────────────────────────────────────────
  // Lazy-loaded once per modal open (this section mounts with the loaded job), cached in a ref.
  const combosRef = useRef<Combo[] | null>(null);
  const [combos, setCombos] = useState<Combo[] | null>(null);
  const [combosLoading, setCombosLoading] = useState(false);
  const [combosError, setCombosError] = useState<string | null>(null);
  const [comboPickerOpen, setComboPickerOpen] = useState(false);
  const [comboBusy, setComboBusy] = useState(false);
  const [comboError, setComboError] = useState<string | null>(null);

  async function ensureCombos() {
    if (combosRef.current || combosLoading) return;
    setCombosLoading(true);
    setCombosError(null);
    try {
      const res = await fetch("/api/combos");
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setCombosError(data?.error || "Couldn't load saved combos.");
        return;
      }
      const list: Combo[] = Array.isArray(data.combos) ? data.combos : [];
      combosRef.current = list;
      setCombos(list);
    } catch {
      setCombosError("Network error — couldn't reach the server.");
    } finally {
      setCombosLoading(false);
    }
  }

  // A linked combo needs the list for its real name.
  useEffect(() => {
    if (comboId) void ensureCombos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comboId]);

  const linkedCombo = comboId ? (combos ?? []).find((c) => c.id === comboId) : undefined;
  const comboName = linkedCombo?.name || "Linked combo";

  const comboItems: SearchPickerItem[] = (combos ?? []).map((c) => ({
    id: c.id,
    primary: c.name || "Untitled combo",
    secondary: [c.description || "", `${c.block_l ?? "?"}×${c.block_w ?? "?"}×${c.block_h ?? "?"}`]
      .filter(Boolean)
      .join(" · "),
  }));

  async function setCombo(next: string | null) {
    setComboPickerOpen(false);
    setComboBusy(true);
    setComboError(null);
    const err = await putJob({ combo_id: next }, next ? "Couldn't link the combo." : "Couldn't clear the combo.");
    setComboBusy(false);
    if (err) { setComboError(err); return; }
    onChanged();
  }

  // ── Stops (stops-01) ──────────────────────────────────────────
  // Draft stop per member, reset from the server's members on every (re)load. Unset = null (no
  // auto-fill). The whole group is saved in one PUT so a 1↔2 swap never passes a duplicate.
  const [stopDraft, setStopDraft] = useState<Record<string, number | null>>({});
  const [stopsBusy, setStopsBusy] = useState(false);
  const [stopsError, setStopsError] = useState<string | null>(null);

  useEffect(() => {
    setStopDraft(Object.fromEntries(members.map((m) => [m.id, m.trailer_stop ?? null])));
    setStopsError(null);
  }, [members]);

  const stopsDirty = members.some((m) => (stopDraft[m.id] ?? null) !== (m.trailer_stop ?? null));
  const stopCounts = new Map<number, number>();
  for (const m of members) {
    const v = stopDraft[m.id] ?? null;
    if (v != null) stopCounts.set(v, (stopCounts.get(v) ?? 0) + 1);
  }
  const clashes = (id: string) => {
    const v = stopDraft[id] ?? null;
    return v != null && (stopCounts.get(v) ?? 0) > 1;
  };
  const hasClash = members.some((m) => clashes(m.id));
  // Options run 1..N; a saved stop above N (left behind by an unlink) stays visible so it can be changed.
  const stopOptionCount = Math.max(members.length, ...members.map((m) => m.trailer_stop ?? 0));

  async function saveStops() {
    if (!trailerGroupId) return;
    setStopsBusy(true);
    setStopsError(null);
    try {
      const res = await fetch("/v2/api/board/trailer-stops", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_id: trailerGroupId,
          stops: Object.fromEntries(members.map((m) => [m.id, stopDraft[m.id] ?? null])),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setStopsError(data?.error || "Couldn't save the stops.");
        return;
      }
      setMembersVersion((v) => v + 1);
      onChanged();
    } catch {
      setStopsError("Network error — couldn't reach the server.");
    } finally {
      setStopsBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-text">Trailer &amp; combo</h2>

      {/* Trailer group */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted">Trailer group</div>
        {trailerGroupId ? (
          <div className="space-y-2">
          {membersLoading && <span className="text-xs text-muted">Loading group…</span>}
          {!membersLoading && members.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-muted">Stops</div>
              <ul className="space-y-1.5">
                {members.map((m) => {
                  const locked = !canEdit || isStopLocked(m);
                  const lockedWhy = !canEdit
                    ? "You can view stops but not change them."
                    : "This order is shipped or archived, so its stop can't change.";
                  const value = stopDraft[m.id] ?? null;
                  const isSelf = m.id === jobId;
                  return (
                    <li key={m.id} className="flex items-center gap-2 min-w-0">
                      <Truck size={14} aria-hidden="true" className="shrink-0 text-muted" />
                      <span className="font-mono tabular-nums text-sm text-text shrink-0">
                        {m.invoice_number || "—"}
                      </span>
                      <span className="text-xs text-muted truncate min-w-0 flex-1" title={m.customer || ""}>
                        {isSelf ? "This order" : (m.customer || "Untitled")}
                      </span>
                      {locked ? (
                        <span className="min-h-[44px] inline-flex items-center px-2 text-sm text-text shrink-0" title={lockedWhy}>
                          {value != null ? stopLabel(value) : "—"}
                        </span>
                      ) : (
                        <select
                          aria-label={`Stop for ${m.invoice_number || m.customer || "order"}`}
                          value={value == null ? "" : String(value)}
                          onChange={(e) => {
                            const v = e.target.value ? Number(e.target.value) : null;
                            setStopDraft((d) => ({ ...d, [m.id]: v }));
                          }}
                          disabled={stopsBusy}
                          className={`min-h-[44px] shrink-0 rounded-md border bg-[var(--input-bg)] text-text text-sm px-2 ${
                            clashes(m.id) ? "border-2 border-[var(--danger-ink)]" : "border-[var(--input-border)]"
                          }`}
                        >
                          <option value="">—</option>
                          {Array.from({ length: stopOptionCount }, (_, i) => i + 1)
                            .filter((n) => n <= members.length || n === m.trailer_stop)
                            .map((n) => (
                              <option key={n} value={String(n)}>{stopLabel(n)}</option>
                            ))}
                        </select>
                      )}
                    </li>
                  );
                })}
              </ul>
              {hasClash && <p className="text-sm text-[var(--danger-ink)]">Two orders can&apos;t be the same stop.</p>}
              {stopsError && <p className="text-sm text-[var(--warn-text)]">{stopsError}</p>}
              {canEdit && (
                <button
                  type="button"
                  onClick={saveStops}
                  disabled={!stopsDirty || hasClash || stopsBusy}
                  className="min-h-[44px] px-4 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {stopsBusy ? "Saving…" : "Save stops"}
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && !groupFull && (
              <button type="button" onClick={() => { setGroupError(null); setGroupPickerOpen(true); }} disabled={!!groupBusy} className={ghostBtn}>
                {groupBusy === "link" ? "Linking…" : "Add Another Stop"}
              </button>
            )}
            {canEdit && (
              <button type="button" onClick={handleUnlinkGroup} disabled={!!groupBusy} className={ghostBtn}>
                {groupBusy === "unlink" ? "Unlinking…" : "Unlink from Trailer Group"}
              </button>
            )}
            {groupFull && (
              <span className="text-xs text-muted">
                {MAX_TRAILER_GROUP_JOBS} of {MAX_TRAILER_GROUP_JOBS} stops — max reached
              </span>
            )}
          </div>
          </div>
        ) : canEdit ? (
          <button type="button" onClick={() => { setGroupError(null); setGroupPickerOpen(true); }} disabled={!!groupBusy} className={ghostBtn}>
            {groupBusy ? "Linking…" : "Link to Another Job"}
          </button>
        ) : (
          <p className="text-xs text-muted">Not linked</p>
        )}
        {groupError && <p className="text-sm text-[var(--warn-text)]">{groupError}</p>}
      </div>

      {/* Combo */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted">Combo</div>
        {comboId ? (
          <span className={chipClass}>
            <Package size={14} aria-hidden="true" />
            {comboName}
            {canEdit && (
              <button
                type="button"
                onClick={() => setCombo(null)}
                disabled={comboBusy}
                aria-label="Remove combo link"
                className="min-w-[32px] min-h-[32px] -mr-1.5 inline-flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-[var(--card-border)] cursor-pointer disabled:opacity-50"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </span>
        ) : canEdit ? (
          <button
            type="button"
            onClick={() => { setComboError(null); setComboPickerOpen(true); void ensureCombos(); }}
            disabled={comboBusy}
            className={ghostBtn}
          >
            {comboBusy ? "Linking…" : "Link combo"}
          </button>
        ) : (
          <p className="text-xs text-muted">No combo linked</p>
        )}
        {comboError && <p className="text-sm text-[var(--warn-text)]">{comboError}</p>}
      </div>

      <SearchPickerModal
        isOpen={groupPickerOpen}
        onClose={() => setGroupPickerOpen(false)}
        title={trailerGroupId ? "Add another stop" : "Link to another job"}
        items={candidates}
        onPick={handleLinkGroup}
        emptyText="No other orders ship the same day."
        searchPlaceholder="Search customer or invoice…"
      />

      <SearchPickerModal
        isOpen={comboPickerOpen}
        onClose={() => setComboPickerOpen(false)}
        title="Link combo"
        items={comboItems}
        onPick={(id) => setCombo(id)}
        loading={combosLoading}
        error={combosError}
        emptyText="No saved combos."
        searchPlaceholder="Search combos…"
      />
    </section>
  );
}
