"use client";
// src/components/board/OrderLinksSection.tsx
// jb-06 — trailer group link/unlink + Link Combo for the v2 edit modal. Both are immediate-save
// actions through the legacy partial PUT /api/jobs ({ id, trailer_group_id } / { id, combo_id }):
// every trailer-group rule (same ship_date, merging, "never leave a group of one") stays
// server-side in routes/jobs.js — this component only mirrors legacy's candidate filter and
// shows the server's error strings verbatim. Never touches the edit modal's dirty state.
import { useEffect, useRef, useState } from "react";
import { Package, Truck, X } from "lucide-react";
import SearchPickerModal, { type SearchPickerItem } from "@/components/SearchPickerModal";
import type { BoardJob } from "./ProductionBoard";

interface GroupMember {
  id: string;
  customer: string | null;
  invoice_number: string | null;
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
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

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
  }, [jobId, trailerGroupId]);

  // Legacy openTrailerGroupPicker filter, verbatim: not self, not archived (the board payload is
  // already non-archived), same ship_date, and (no group OR the same group).
  const candidates: SearchPickerItem[] = boardJobs
    .filter((j) =>
      j.id !== jobId &&
      (j.ship_date || "") === (shipDate || "") &&
      (!j.trailer_group_id || j.trailer_group_id === trailerGroupId),
    )
    .map((j) => ({
      id: j.id,
      primary: j.customer || "Untitled",
      secondary: `${j.invoice_number || "—"} · ${j.ship_date || "—"}`,
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
    setGroupBusy(true);
    setGroupError(null);
    const err = await putJob({ trailer_group_id: targetJobId }, "Couldn't link this order.");
    setGroupBusy(false);
    if (err) { setGroupError(err); return; }
    onChanged();
  }

  async function handleUnlinkGroup() {
    setGroupBusy(true);
    setGroupError(null);
    const err = await putJob({ trailer_group_id: null }, "Couldn't unlink this order.");
    setGroupBusy(false);
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

  const others = members.filter((m) => m.id !== jobId);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-text">Trailer &amp; combo</h2>

      {/* Trailer group */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted">Trailer group</div>
        {trailerGroupId ? (
          <div className="flex flex-wrap items-center gap-2">
            {membersLoading && <span className="text-xs text-muted">Loading group…</span>}
            {!membersLoading && others.map((m) => (
              <span key={m.id} className={chipClass} title={m.customer || ""}>
                <Truck size={14} aria-hidden="true" />
                <span className="font-mono tabular-nums">{m.invoice_number || m.customer || "Untitled"}</span>
              </span>
            ))}
            {canEdit && (
              <button type="button" onClick={handleUnlinkGroup} disabled={groupBusy} className={ghostBtn}>
                {groupBusy ? "Unlinking…" : "Unlink from Trailer Group"}
              </button>
            )}
          </div>
        ) : canEdit ? (
          <button type="button" onClick={() => { setGroupError(null); setGroupPickerOpen(true); }} disabled={groupBusy} className={ghostBtn}>
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
        title="Link to another job"
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
