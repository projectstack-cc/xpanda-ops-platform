"use client";
import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { runFullCalc } from "@/lib/blockEngine";
import type { CuttingJob, CuttingLineItem } from "./types";

const DEFAULT_KERF = 0.079;

function parseDims(s: string): { l: number; w: number; h: number } | null {
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  return { l: parseFloat(m[1]), w: parseFloat(m[2]), h: parseFloat(m[3]) };
}

const num = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

interface Props {
  job: CuttingJob;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface SetupRow {
  id: string;
  label: string;
  bL: string; bW: string; bH: string; kerf: string; mode: "auto" | "fixed";
  pL: string; pW: string; pH: string; qty: string;
}

function emptyRow(prev?: SetupRow): SetupRow {
  return {
    id: crypto.randomUUID(),
    label: "",
    bL: prev?.bL ?? "", bW: prev?.bW ?? "", bH: prev?.bH ?? "",
    kerf: prev?.kerf ?? String(DEFAULT_KERF), mode: prev?.mode ?? "auto",
    pL: "", pW: "", pH: "", qty: "",
  };
}

function calcRow(r: SetupRow) {
  const valid =
    num(r.bL) > 0 && num(r.bW) > 0 && num(r.bH) > 0 &&
    num(r.pL) > 0 && num(r.pW) > 0 && num(r.pH) > 0;
  if (!valid) return null;
  const res = runFullCalc({
    bL: num(r.bL), bW: num(r.bW), bH: num(r.bH),
    pL: num(r.pL), pW: num(r.pW), pH: num(r.pH),
    kerf: num(r.kerf) >= 0 ? num(r.kerf) : DEFAULT_KERF,
    primaryQty: num(r.qty) > 0 ? Math.floor(num(r.qty)) : null,
    mode: r.mode,
    secondaryParts: [],
  });
  return { perBlock: res.primary.total, blocks: res.blocksNeeded };
}

export default function BlockPlanner({ job, isOpen, onClose, onSaved }: Props) {
  const [rows, setRows] = useState<SetupRow[]>([emptyRow()]);
  const [crossChunks, setCrossChunks] = useState("");
  const [holeChunks, setHoleChunks] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setCrossChunks("");
    setHoleChunks("");
    fetch(`/v2/api/cutting/cut-plan/setups?job_id=${encodeURIComponent(job.id)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const saved = Array.isArray(data?.setups) ? data.setups : [];
        setRows(
          saved.length > 0
            ? saved.map((s: any) => ({
                id: crypto.randomUUID(),
                label: s.label ?? "",
                bL: String(s.block_l ?? ""), bW: String(s.block_w ?? ""), bH: String(s.block_h ?? ""),
                kerf: String(s.kerf ?? DEFAULT_KERF), mode: s.mode === "fixed" ? "fixed" : "auto",
                pL: String(s.part_l ?? ""), pW: String(s.part_w ?? ""), pH: String(s.part_h ?? ""),
                qty: s.qty != null ? String(s.qty) : "",
              }))
            : [emptyRow()]
        );
      })
      .catch(() => {
        if (!cancelled) setErr("Couldn't load saved plan.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, job.id]);

  function update(i: number, patch: Partial<SetupRow>) {
    setRows((arr) => arr.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function pickPart(i: number, item: CuttingLineItem) {
    const d = parseDims(item.dimensions);
    update(i, {
      label: item.part_number || item.description || "",
      ...(d ? { pL: String(d.l), pW: String(d.w), pH: String(d.h) } : {}),
      ...(item.quantity != null ? { qty: String(item.quantity) } : {}),
    });
  }

  const totalBlocks = useMemo(() => {
    let blocks = 0;
    let any = false;
    for (const r of rows) {
      const c = calcRow(r);
      if (c && c.blocks != null) {
        blocks += c.blocks;
        any = true;
      }
    }
    return any ? blocks : null;
  }, [rows]);

  async function save() {
    const setups = rows
      .filter((r) => calcRow(r) !== null)
      .map((r) => ({
        label: r.label,
        block: { l: num(r.bL), w: num(r.bW), h: num(r.bH), kerf: num(r.kerf) },
        part: { l: num(r.pL), w: num(r.pW), h: num(r.pH), qty: num(r.qty) > 0 ? Math.floor(num(r.qty)) : null },
        mode: r.mode,
      }));
    if (setups.length === 0) {
      setErr("Add at least one part with block + part dimensions.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/v2/api/cutting/cut-plan/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: job.id,
          setups,
          cross_cutter_chunks: num(crossChunks) > 0 ? Math.floor(num(crossChunks)) : null,
          hole_cutter_chunks: num(holeChunks) > 0 ? Math.floor(num(holeChunks)) : null,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setErr(data.error || "Save failed.");
        setSaving(false);
        return;
      }
      onSaved();
    } catch {
      setErr("Network error.");
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded border border-border bg-surface px-2 py-1.5 font-mono tabular-nums text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
  const labelCls = "text-xs font-medium text-muted";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cut Plan" size="lg">
      <div className="max-h-[72vh] overflow-y-auto space-y-4 pr-1">
        {loading ? (
          <p className="text-sm text-muted">Loading saved plan…</p>
        ) : (
          <>
            {rows.map((r, i) => {
              const c = calcRow(r);
              return (
                <div key={r.id} className="rounded border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-text">
                      Part {i + 1}
                      {r.label ? ` — ${r.label}` : ""}
                    </span>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setRows((a) => a.filter((_, j) => j !== i))}
                        className="text-xs text-muted hover:text-text cursor-pointer"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {job.line_items.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {job.line_items.map((it) => (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => pickPart(i, it)}
                          className="rounded border border-border px-2 py-0.5 text-xs text-text hover:opacity-80 cursor-pointer"
                        >
                          {it.part_number || it.description || "part"}
                          {it.dimensions ? ` (${it.dimensions})` : ""}
                        </button>
                      ))}
                    </div>
                  )}

                  <div>
                    <p className={labelCls}>Block — L × W × H · kerf</p>
                    <div className="mt-1 grid grid-cols-4 gap-2">
                      <input className={inputCls} inputMode="decimal" placeholder="L" value={r.bL} onChange={(e) => update(i, { bL: e.target.value })} />
                      <input className={inputCls} inputMode="decimal" placeholder="W" value={r.bW} onChange={(e) => update(i, { bW: e.target.value })} />
                      <input className={inputCls} inputMode="decimal" placeholder="H" value={r.bH} onChange={(e) => update(i, { bH: e.target.value })} />
                      <input className={inputCls} inputMode="decimal" placeholder="kerf" value={r.kerf} onChange={(e) => update(i, { kerf: e.target.value })} />
                    </div>
                  </div>

                  <div>
                    <p className={labelCls}>Part — L × W × H · qty</p>
                    <div className="mt-1 grid grid-cols-4 gap-2">
                      <input className={inputCls} inputMode="decimal" placeholder="L" value={r.pL} onChange={(e) => update(i, { pL: e.target.value })} />
                      <input className={inputCls} inputMode="decimal" placeholder="W" value={r.pW} onChange={(e) => update(i, { pW: e.target.value })} />
                      <input className={inputCls} inputMode="decimal" placeholder="H" value={r.pH} onChange={(e) => update(i, { pH: e.target.value })} />
                      <input className={inputCls} inputMode="numeric" placeholder="Qty" value={r.qty} onChange={(e) => update(i, { qty: e.target.value })} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex gap-1">
                      {(["auto", "fixed"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => update(i, { mode: m })}
                          className={`rounded border px-2 py-1 text-xs capitalize cursor-pointer ${
                            r.mode === m
                              ? "border-[var(--accent)] text-text font-semibold"
                              : "border-border text-muted hover:opacity-80"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    <span className="font-mono tabular-nums text-xs text-muted">
                      {c ? `${c.perBlock}/block · ` : ""}
                      <span className="text-text font-semibold">
                        {c && c.blocks != null ? `${c.blocks} blocks` : "—"}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => setRows((a) => [...a, emptyRow(a[a.length - 1])])}
              className="text-xs text-[var(--accent)] hover:opacity-80 cursor-pointer"
            >
              + Add part
            </button>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className={labelCls}>Cross Cutter chunks</p>
                <input className={`${inputCls} mt-1`} inputMode="numeric" placeholder="optional" value={crossChunks} onChange={(e) => setCrossChunks(e.target.value)} />
              </div>
              <div>
                <p className={labelCls}>Hole Cutter chunks</p>
                <input className={`${inputCls} mt-1`} inputMode="numeric" placeholder="optional" value={holeChunks} onChange={(e) => setHoleChunks(e.target.value)} />
              </div>
            </div>

            <div className="rounded border border-border p-3 flex items-center justify-between">
              <span className={labelCls}>Order total</span>
              <span className="font-mono tabular-nums text-sm text-text font-semibold">
                {totalBlocks != null ? `${totalBlocks} blocks` : "—"}
              </span>
            </div>

            {err && <p className="text-xs text-[var(--danger-text)]">{err}</p>}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 rounded border border-border px-3 py-2 text-sm text-text hover:opacity-80 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || totalBlocks == null}
                className="flex-1 rounded bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 cursor-pointer disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Plan"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
