"use client";
// src/components/board/HbChunkPlanSection.tsx
// hbplan-02 — custom Holey Board chunk list editor for the v2 edit modal. A manager builds the
// list by hand as recipe groups ("cut N chunks, each into these pieces") so one wire setup covers
// a whole group; the auto nest (max yield) stays the fallback when no list is saved.
// Writes immediately via PUT /v2/api/board/:id/hb-chunk-plan (hbplan-01) — independent of the
// modal's main Save, like the floor stock section above it. All math comes from lib/hbChunkPlan.
// Starts BLANK (no prefill); a saved list is never auto-edited — if the order or floor stock
// changes later, the NEEDED strip and the header chip show the mismatch instead.
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { HB_CHUNK_HEIGHT } from "@/lib/holeyNester";
import {
  formatFill,
  formatThickness,
  groupFill,
  hbAllowedThicknesses,
  hbNeededByThickness,
  parsePlan,
  planMismatchParts,
  planVsNeeded,
  type HbPlanGroup,
} from "@/lib/hbChunkPlan";

interface HbChunkPlanSectionProps {
  jobId: string;
  hbChunkBreakdown: string | null;
  hbChunkPlan: string | null;
  canEdit: boolean;
  onChanged: (next: { hb_chunk_plan: string | null }) => void;
}

// Draft rows keep the raw input text so a half-typed number doesn't snap back while editing.
interface DraftPiece { qty: string; thickness: number }
interface DraftGroup { key: number; count: string; pieces: DraftPiece[] }

let nextKey = 1;
const toDraft = (groups: HbPlanGroup[]): DraftGroup[] =>
  groups.map((g) => ({ key: nextKey++, count: String(g.count), pieces: g.pieces.map((p) => ({ qty: String(p.qty), thickness: p.thickness })) }));

const posInt = (raw: string): number | null => {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = parseInt(raw, 10);
  return n >= 1 ? n : null;
};

const numInput =
  "w-16 min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-2 font-mono tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-60";
const selectCls =
  "min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-2 font-mono tabular-nums cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-60";
const ghostBtn =
  "inline-flex items-center gap-1 min-h-[44px] px-3 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-50 disabled:cursor-not-allowed";
const iconBtn =
  "inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md text-muted cursor-pointer hover:bg-[var(--ghost-bg)] hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-50 disabled:cursor-not-allowed";
const chipBase = "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold font-mono tabular-nums";
const CHIP_WARN = `${chipBase} border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)]`;
const CHIP_OK = `${chipBase} border-transparent bg-[var(--success-bg)] text-[var(--success-text)]`;
const CHIP_NEUTRAL = `${chipBase} border-[var(--card-border)] text-muted`;

function safeParse(raw: string | null): any {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export default function HbChunkPlanSection({ jobId, hbChunkBreakdown, hbChunkPlan, canEdit, onChanged }: HbChunkPlanSectionProps) {
  const needed = useMemo(() => hbNeededByThickness(hbChunkBreakdown), [hbChunkBreakdown]);
  const allowed = useMemo(() => hbAllowedThicknesses(hbChunkBreakdown), [hbChunkBreakdown]);
  const chunksOnHand = useMemo(() => {
    const n = Number(safeParse(hbChunkBreakdown)?.net?.chunks_on_hand);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [hbChunkBreakdown]);
  const saved = useMemo(() => parsePlan(hbChunkPlan), [hbChunkPlan]);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmingRevert, setConfirmingRevert] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // (Re)seed from the saved plan whenever it changes (open, save, revert). No plan = blank.
  useEffect(() => {
    setDraft(saved ? toDraft(saved.groups) : []);
  }, [saved]);

  // A different order starts collapsed and clean.
  useEffect(() => {
    setOpen(false);
    setConfirmingRevert(false);
    setError(null);
    setNotice(null);
  }, [jobId]);

  // Live view of the draft: groups with valid numbers count toward planned; invalid inputs block Save.
  const live = useMemo(() => {
    const groups: HbPlanGroup[] = [];
    let invalid = false;
    const fills: number[] = [];
    for (const g of draft) {
      const count = posInt(g.count);
      const pieces = g.pieces.map((p) => ({ thickness: p.thickness, qty: posInt(p.qty) }));
      const okPieces = pieces.filter((p): p is { thickness: number; qty: number } => p.qty !== null);
      if (count === null || okPieces.length !== pieces.length || pieces.length === 0) invalid = true;
      fills.push(groupFill({ pieces: okPieces }));
      if (count !== null && okPieces.length) groups.push({ count, pieces: okPieces });
    }
    const over = fills.some((f) => f > HB_CHUNK_HEIGHT + 1e-9);
    const total = groups.reduce((s, g) => s + g.count, 0);
    const diff = planVsNeeded(groups, needed);
    return { groups, invalid, fills, over, total, diff, mismatch: planMismatchParts(diff) };
  }, [draft, needed]);

  const savedDiff = useMemo(() => (saved ? planMismatchParts(planVsNeeded(saved.groups, needed)) : null), [saved, needed]);
  const savedMatches = !!savedDiff && savedDiff.short.length === 0 && savedDiff.over.length === 0;

  if (!hbChunkBreakdown) return null;

  const headerChip = !saved ? (
    <span className={CHIP_NEUTRAL}>Auto (max yield)</span>
  ) : savedMatches ? (
    <span className={CHIP_OK}>Custom · {saved.total} chunks</span>
  ) : (
    <span className={CHIP_WARN}>Custom · doesn&apos;t match order</span>
  );

  function update(fn: (d: DraftGroup[]) => DraftGroup[]) {
    setDraft((prev) => fn(prev));
    setNotice(null);
    setError(null);
  }
  const firstUnused = (pieces: DraftPiece[]) => allowed.find((t) => !pieces.some((p) => p.thickness === t)) ?? allowed[0];
  const addGroup = () => update((d) => [...d, { key: nextKey++, count: "1", pieces: [{ qty: "1", thickness: allowed[0] }] }]);
  const removeGroup = (key: number) => update((d) => d.filter((g) => g.key !== key));
  const patchGroup = (key: number, fn: (g: DraftGroup) => DraftGroup) => update((d) => d.map((g) => (g.key === key ? fn(g) : g)));

  async function put(groups: HbPlanGroup[] | null, okText: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/v2/api/board/${encodeURIComponent(jobId)}/hb-chunk-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(res.status === 400 && data?.error ? data.error : data?.detail || data?.error || "Couldn't save the chunk list. Try again.");
        return;
      }
      setConfirmingRevert(false);
      setNotice(okText);
      onChanged({ hb_chunk_plan: data.hb_chunk_plan ?? null });
    } catch {
      setError("Network error — couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const canSave = !busy && live.groups.length > 0 && !live.invalid && !live.over;
  const mismatchText = [
    live.mismatch.short.length ? `Short ${live.mismatch.short.join(", ")}` : "",
    live.mismatch.over.length ? `over ${live.mismatch.over.join(", ")}` : "",
  ].filter(Boolean).join(" · ");

  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex flex-wrap items-center gap-2 min-h-[44px] text-sm font-semibold text-[var(--link)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] rounded-md"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-1.5">
          {open ? <ChevronDown size={16} className="shrink-0" aria-hidden="true" /> : <ChevronRight size={16} className="shrink-0" aria-hidden="true" />}
          Chunk list
        </span>
        {headerChip}
      </button>

      {open && (
        <div className="rounded-lg border border-[var(--card-border)] p-3 space-y-3">
          {!allowed.length ? (
            <p className="text-sm text-muted">
              This order&apos;s Holey Board breakdown has no line detail. Re-save the order to refresh it, then build the list.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Needed (net of floor pieces)</p>
                <div className="flex flex-wrap gap-1.5" aria-live="polite">
                  {live.diff.map((r) => {
                    const t = `${formatThickness(r.thickness)}"`;
                    if (r.diff === 0)
                      return (
                        <span key={r.thickness} className={CHIP_OK}>
                          <Check size={12} aria-hidden="true" /> {t}: {r.needed} · {r.planned} planned
                        </span>
                      );
                    return (
                      <span key={r.thickness} className={CHIP_WARN}>
                        {t}: {r.needed} · {r.planned} planned · {r.diff < 0 ? `${-r.diff} left` : `+${r.diff} over`}
                      </span>
                    );
                  })}
                </div>
              </div>

              {chunksOnHand > 0 && (
                <p className="text-xs text-muted">
                  Uncut chunks on hand: <span className="font-mono tabular-nums">{chunksOnHand}</span> — new chunks to cut:{" "}
                  <span className="font-mono tabular-nums">{Math.max(0, live.total - chunksOnHand)}</span>
                </p>
              )}

              {!canEdit ? (
                saved ? (
                  <ul className="space-y-1 text-sm text-text">
                    {saved.groups.map((g, i) => (
                      <li key={i} className="font-mono tabular-nums">
                        {g.count} chunks × {g.pieces.map((p) => `${p.qty}× ${formatThickness(p.thickness)}"`).join(" + ")}{" "}
                        <span className="text-muted">· {formatFill(groupFill(g))}&quot; / {HB_CHUNK_HEIGHT}&quot;</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No custom list — the cut list uses the auto nest.</p>
                )
              ) : (
                <>
                  {draft.length === 0 && (
                    <p className="text-sm text-muted">
                      No custom list — the cut list uses the auto nest. Add a group to build one: a chunk count and the pieces each chunk is cut into.
                    </p>
                  )}

                  <div className="divide-y divide-[var(--line)]">
                    {draft.map((g, gi) => {
                      const fill = live.fills[gi] ?? 0;
                      const over = fill > HB_CHUNK_HEIGHT + 1e-9;
                      return (
                        <div key={g.key} className="flex flex-wrap items-center gap-2 py-2">
                          <input
                            type="number"
                            min={1}
                            step={1}
                            inputMode="numeric"
                            value={g.count}
                            onChange={(e) => patchGroup(g.key, (x) => ({ ...x, count: e.target.value }))}
                            disabled={busy}
                            aria-label={`Group ${gi + 1} chunk count`}
                            className={numInput}
                          />
                          <span className="text-sm text-muted">chunks ×</span>
                          {g.pieces.map((p, pi) => (
                            <span key={pi} className="inline-flex items-center gap-1 rounded-md border border-[var(--card-border)] pl-1">
                              <input
                                type="number"
                                min={1}
                                step={1}
                                inputMode="numeric"
                                value={p.qty}
                                onChange={(e) => patchGroup(g.key, (x) => ({ ...x, pieces: x.pieces.map((q, qi) => (qi === pi ? { ...q, qty: e.target.value } : q)) }))}
                                disabled={busy}
                                aria-label={`Group ${gi + 1} piece ${pi + 1} quantity`}
                                className={numInput}
                              />
                              <span className="text-sm text-muted">×</span>
                              <select
                                value={String(p.thickness)}
                                onChange={(e) => patchGroup(g.key, (x) => ({ ...x, pieces: x.pieces.map((q, qi) => (qi === pi ? { ...q, thickness: Number(e.target.value) } : q)) }))}
                                disabled={busy}
                                aria-label={`Group ${gi + 1} piece ${pi + 1} thickness`}
                                className={selectCls}
                              >
                                {allowed.map((t) => (
                                  <option key={t} value={String(t)}>{formatThickness(t)}&quot;</option>
                                ))}
                              </select>
                              {g.pieces.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => patchGroup(g.key, (x) => ({ ...x, pieces: x.pieces.filter((_, qi) => qi !== pi) }))}
                                  disabled={busy}
                                  aria-label={`Remove group ${gi + 1} piece ${pi + 1}`}
                                  className={iconBtn}
                                >
                                  <X size={16} aria-hidden="true" />
                                </button>
                              )}
                            </span>
                          ))}
                          <button
                            type="button"
                            onClick={() => patchGroup(g.key, (x) => ({ ...x, pieces: [...x.pieces, { qty: "1", thickness: firstUnused(x.pieces) }] }))}
                            disabled={busy}
                            className={ghostBtn}
                          >
                            <Plus size={14} aria-hidden="true" /> size
                          </button>
                          <span
                            className={`ml-auto font-mono tabular-nums text-sm ${over ? "font-semibold text-[var(--danger-ink)]" : "text-muted"}`}
                            aria-label={`Group ${gi + 1} fill`}
                          >
                            {formatFill(fill)}&quot; / {HB_CHUNK_HEIGHT}&quot;{over ? " — over" : ""}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeGroup(g.key)}
                            disabled={busy}
                            aria-label={`Remove group ${gi + 1}`}
                            className={iconBtn}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <button type="button" onClick={addGroup} disabled={busy} className={ghostBtn}>
                    <Plus size={14} aria-hidden="true" /> Add group
                  </button>

                  {live.groups.length > 0 && mismatchText && (
                    <p className="text-sm font-semibold text-[var(--warn-text)]">
                      Doesn&apos;t match order: <span className="font-mono tabular-nums">{mismatchText}</span>
                    </p>
                  )}
                  {live.over && <p className="text-sm text-[var(--danger-ink)]">A group is over the {HB_CHUNK_HEIGHT}&quot; chunk — fix it to save.</p>}

                  {error && <p role="alert" className="text-sm text-[var(--danger-ink)]">{error}</p>}
                  {notice && !error && <p className="text-sm text-[var(--success-ink)]">{notice}</p>}

                  {confirmingRevert ? (
                    <div role="alert" className="rounded-md border border-[var(--card-border)] p-3 space-y-2">
                      <p className="text-sm text-text">Revert to the auto chunk list? The custom list is deleted.</p>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button type="button" onClick={() => setConfirmingRevert(false)} disabled={busy} className={ghostBtn}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void put(null, "Reverted to auto.")}
                          disabled={busy}
                          className="min-h-[44px] px-4 rounded-md bg-[var(--danger-bg)] text-[var(--danger-text)] text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
                        >
                          {busy ? "Reverting…" : "Revert to auto"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void put(live.groups, "Chunk list saved.")}
                        disabled={!canSave}
                        className="min-h-[44px] px-4 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {busy ? "Saving…" : "Save chunk list"}
                      </button>
                      {saved && (
                        <button
                          type="button"
                          onClick={() => { setConfirmingRevert(true); setNotice(null); }}
                          disabled={busy}
                          className={ghostBtn}
                        >
                          Revert to auto
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
