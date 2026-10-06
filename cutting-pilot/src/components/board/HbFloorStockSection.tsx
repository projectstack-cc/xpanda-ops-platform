"use client";
// src/components/board/HbFloorStockSection.tsx
// jb-05 — HB floor stock editor for the v2 edit modal. Mirrors legacy hb-onhand-02
// (jobs/index.html renderHbOnHandSection / saveHbOnHand / clearHbOnHand): pieces + uncut chunks
// already on the floor, written immediately via the legacy PUT /api/jobs/:id/hb-on-hand (the
// server re-nests and returns the new hb_chunk_breakdown). Changes only the cut list's Chunk
// Breakdown page — never line-item quantities. Reads the SAVED order (hb_chunk_breakdown.lines).
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface HbLine {
  part_id: string;
  part_number?: string | null;
  thickness?: number | string | null;
  qty?: number | string | null;
}

interface HbNet {
  order_chunks_required?: number;
  chunks_required?: number;
  chunks_on_hand?: number;
  chunks_to_cut?: number;
}

interface HbFloorStockSectionProps {
  jobId: string;
  hbChunkBreakdown: string | null;
  hbOnHand: string | null;
  canEdit: boolean;
  onChanged: (next: { hb_on_hand: string | null; hb_chunk_breakdown: string | null }) => void;
}

function safeParse(raw: string | null): any {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const inputClass =
  "w-20 min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-2 font-mono tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-60";

export default function HbFloorStockSection({ jobId, hbChunkBreakdown, hbOnHand, canEdit, onChanged }: HbFloorStockSectionProps) {
  const breakdown = useMemo(() => safeParse(hbChunkBreakdown), [hbChunkBreakdown]);
  const lines: HbLine[] = breakdown && Array.isArray(breakdown.lines) ? breakdown.lines : [];
  const net: HbNet | null = breakdown && breakdown.net && typeof breakdown.net === "object" ? breakdown.net : null;

  const [open, setOpen] = useState(false);
  const [pcs, setPcs] = useState<Record<string, string>>({});
  const [chunks, setChunks] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // (Re)seed the inputs from the saved hb_on_hand whenever it changes (open, save, clear).
  useEffect(() => {
    const onHand = safeParse(hbOnHand);
    const stored = onHand && onHand.pcs && typeof onHand.pcs === "object" ? onHand.pcs : {};
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(stored)) {
      if (v !== undefined && v !== null) next[k] = String(v);
    }
    setPcs(next);
    setChunks(onHand && onHand.chunks !== undefined && onHand.chunks !== null ? String(onHand.chunks) : "");
  }, [hbOnHand]);

  // A different order starts collapsed and clean.
  useEffect(() => {
    setOpen(false);
    setConfirmingClear(false);
    setError(null);
    setNotice(null);
  }, [jobId]);

  if (!lines.length) return null;

  // Clamp to 0..max (blank stays blank — legacy omits blanks from the payload).
  function clamp(raw: string, max?: number): string {
    if (raw === "") return "";
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return "";
    let v = Math.max(0, n);
    if (max !== undefined) v = Math.min(v, max);
    return String(v);
  }

  async function put(payload: { pcs: Record<string, number>; chunks: number }, okText: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/hb-on-hand`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Couldn't save floor stock. Try again.");
        return;
      }
      setConfirmingClear(false);
      setNotice(okText);
      onChanged({
        hb_on_hand: data.job?.hb_on_hand ?? null,
        hb_chunk_breakdown: data.job?.hb_chunk_breakdown ?? null,
      });
    } catch {
      setError("Network error — couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  function handleSave() {
    // Only positive integers are sent; blank/0 omitted, chunks 0 if blank (legacy collectHbOnHandPayload).
    const outPcs: Record<string, number> = {};
    for (const line of lines) {
      const n = parseInt(pcs[line.part_id] ?? "", 10);
      if (line.part_id && Number.isFinite(n) && n > 0) outPcs[line.part_id] = n;
    }
    const c = parseInt(chunks, 10);
    void put({ pcs: outPcs, chunks: Number.isFinite(c) && c > 0 ? c : 0 }, "Floor stock saved.");
  }

  function handleClear() {
    void put({ pcs: {}, chunks: 0 }, "Floor stock cleared.");
  }

  const ghostBtn =
    "min-h-[44px] px-4 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-[var(--link)] cursor-pointer"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={16} className="shrink-0" aria-hidden="true" /> : <ChevronRight size={16} className="shrink-0" aria-hidden="true" />}
        Floor stock (chunk breakdown only)
      </button>

      {open && (
        <div className="rounded-lg border border-[var(--card-border)] p-3 space-y-3">
          <p className="text-xs text-muted">
            Pieces and uncut chunks already on the floor. Only changes the Chunk Breakdown page — cut list
            quantities stay at order qty. Uses the saved order; save line-item edits first.
          </p>

          <div className="divide-y divide-[var(--line)]">
            {lines.map((line) => {
              const orderQty = Number(line.qty) || 0;
              return (
                <label key={line.part_id} className="flex items-center gap-3 py-1.5">
                  <span className="flex-1 text-sm text-text">
                    {line.part_number || ""} (<span className="font-mono tabular-nums">{String(line.thickness ?? "")}</span>&quot;)
                  </span>
                  <span className="text-xs text-muted whitespace-nowrap">
                    order <span className="font-mono tabular-nums">{orderQty}</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={orderQty}
                    step={1}
                    inputMode="numeric"
                    value={pcs[line.part_id] ?? ""}
                    onChange={(e) => {
                      const v = clamp(e.target.value, orderQty);
                      setPcs((prev) => ({ ...prev, [line.part_id]: v }));
                    }}
                    disabled={!canEdit || busy}
                    aria-label={`Floor pieces for ${line.part_number || "part"}`}
                    className={inputClass}
                  />
                </label>
              );
            })}
          </div>

          <label className="flex items-center gap-3">
            <span className="flex-1 text-sm text-text">Uncut chunks on hand</span>
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={chunks}
              onChange={(e) => setChunks(clamp(e.target.value))}
              disabled={!canEdit || busy}
              className={inputClass}
            />
          </label>

          <p className="text-xs text-muted">
            {net
              ? `Order ${net.order_chunks_required} chunks → ${net.chunks_required} after floor pcs · ${net.chunks_on_hand} on hand · cut ${net.chunks_to_cut} new`
              : "No floor stock applied."}
          </p>

          {error && <p className="text-sm text-[var(--warn-text)]">{error}</p>}
          {notice && !error && <p className="text-sm text-[var(--success-text)]">{notice}</p>}

          {canEdit &&
            (confirmingClear ? (
              <div role="alert" className="rounded-md border border-[var(--card-border)] p-3 space-y-2">
                <p className="text-sm text-text">Clear all floor stock for this order?</p>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button type="button" onClick={() => setConfirmingClear(false)} disabled={busy} className={ghostBtn}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={busy}
                    className="min-h-[44px] px-4 rounded-md bg-[var(--danger-bg)] text-[var(--danger-text)] text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? "Clearing…" : "Clear"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={busy}
                  className="min-h-[44px] px-4 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save floor stock"}
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirmingClear(true); setNotice(null); }}
                  disabled={busy}
                  className={ghostBtn}
                >
                  Clear
                </button>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
