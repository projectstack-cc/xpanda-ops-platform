"use client";
import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { runFullCalc, type BlockCalcInput, type SecondaryInput } from "@/lib/blockEngine";
import type { CuttingJob, CuttingLineItem } from "./types";

const DEFAULT_KERF = 0.079;

// Best-effort parse of an "L x W x H" dimensions string (tolerant of x / ×).
function parseDims(s: string): { l: number; w: number; h: number } | null {
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  return { l: parseFloat(m[1]), w: parseFloat(m[2]), h: parseFloat(m[3]) };
}

interface Props {
  job: CuttingJob;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface SecRow {
  id: string;
  label: string;
  l: string;
  w: string;
  h: string;
  qty: string;
}

const num = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

export default function BlockPlanner({ job, isOpen, onClose, onSaved }: Props) {
  const [bL, setBL] = useState("");
  const [bW, setBW] = useState("");
  const [bH, setBH] = useState("");
  const [kerf, setKerf] = useState(String(DEFAULT_KERF));
  const [mode, setMode] = useState<"auto" | "fixed">("auto");

  const [pL, setPL] = useState("");
  const [pW, setPW] = useState("");
  const [pH, setPH] = useState("");
  const [pQty, setPQty] = useState("");

  const [secs, setSecs] = useState<SecRow[]>([]);
  const [crossChunks, setCrossChunks] = useState("");
  const [holeChunks, setHoleChunks] = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function pickPrimary(item: CuttingLineItem) {
    const d = parseDims(item.dimensions);
    if (d) {
      setPL(String(d.l));
      setPW(String(d.w));
      setPH(String(d.h));
    }
    if (item.quantity != null) setPQty(String(item.quantity));
  }

  function updateSec(i: number, field: keyof SecRow, val: string) {
    setSecs((arr) => arr.map((s, j) => (j === i ? { ...s, [field]: val } : s)));
  }

  const result = useMemo(() => {
    const input: BlockCalcInput = {
      bL: num(bL), bW: num(bW), bH: num(bH),
      pL: num(pL), pW: num(pW), pH: num(pH),
      kerf: num(kerf) >= 0 ? num(kerf) : DEFAULT_KERF,
      primaryQty: num(pQty) > 0 ? Math.floor(num(pQty)) : null,
      mode,
      secondaryParts: secs
        .filter((s) => num(s.l) > 0 && num(s.w) > 0 && num(s.h) > 0)
        .map<SecondaryInput>((s) => ({
          id: s.id,
          label: s.label || "Secondary",
          L: num(s.l), W: num(s.w), H: num(s.h),
          qty: num(s.qty) > 0 ? Math.floor(num(s.qty)) : null,
        })),
    };
    const valid =
      input.bL > 0 && input.bW > 0 && input.bH > 0 &&
      input.pL > 0 && input.pW > 0 && input.pH > 0;
    return valid ? runFullCalc(input) : null;
  }, [bL, bW, bH, kerf, mode, pL, pW, pH, pQty, secs]);

  async function save() {
    if (!result) {
      setErr("Enter block and primary part dimensions.");
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
          block: { l: num(bL), w: num(bW), h: num(bH), kerf: num(kerf) },
          primary: {
            l: num(pL), w: num(pW), h: num(pH),
            qty: num(pQty) > 0 ? Math.floor(num(pQty)) : null,
          },
          mode,
          secondaries: secs
            .filter((s) => num(s.l) > 0 && num(s.w) > 0 && num(s.h) > 0)
            .map((s) => ({
              id: s.id, label: s.label,
              l: num(s.l), w: num(s.w), h: num(s.h),
              qty: num(s.qty) > 0 ? Math.floor(num(s.qty)) : null,
            })),
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
      <div className="max-h-[70vh] overflow-y-auto space-y-4 pr-1">
        {job.line_items.length > 0 && (
          <div>
            <p className={labelCls}>Prefill primary from job part</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {job.line_items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => pickPrimary(it)}
                  className="rounded border border-border px-2 py-1 text-xs text-text hover:opacity-80 cursor-pointer"
                >
                  {it.part_number || it.description || "part"}
                  {it.dimensions ? ` (${it.dimensions})` : ""}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className={labelCls}>Block — L × W × H (in)</p>
          <div className="mt-1 grid grid-cols-3 gap-2">
            <input className={inputCls} inputMode="decimal" placeholder="L" value={bL} onChange={(e) => setBL(e.target.value)} />
            <input className={inputCls} inputMode="decimal" placeholder="W" value={bW} onChange={(e) => setBW(e.target.value)} />
            <input className={inputCls} inputMode="decimal" placeholder="H" value={bH} onChange={(e) => setBH(e.target.value)} />
          </div>
        </div>

        <div>
          <p className={labelCls}>Primary part — L × W × H (in) + qty</p>
          <div className="mt-1 grid grid-cols-4 gap-2">
            <input className={inputCls} inputMode="decimal" placeholder="L" value={pL} onChange={(e) => setPL(e.target.value)} />
            <input className={inputCls} inputMode="decimal" placeholder="W" value={pW} onChange={(e) => setPW(e.target.value)} />
            <input className={inputCls} inputMode="decimal" placeholder="H" value={pH} onChange={(e) => setPH(e.target.value)} />
            <input className={inputCls} inputMode="numeric" placeholder="Qty" value={pQty} onChange={(e) => setPQty(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className={labelCls}>Kerf (in)</p>
            <input className={`${inputCls} mt-1`} inputMode="decimal" value={kerf} onChange={(e) => setKerf(e.target.value)} />
          </div>
          <div>
            <p className={labelCls}>Orientation</p>
            <div className="mt-1 flex gap-1">
              {(["auto", "fixed"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded border px-2 py-1.5 text-xs capitalize cursor-pointer ${
                    mode === m
                      ? "border-[var(--accent)] text-text font-semibold"
                      : "border-border text-muted hover:opacity-80"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <p className={labelCls}>Secondary parts (optional)</p>
            <button
              type="button"
              onClick={() => setSecs((s) => [...s, { id: crypto.randomUUID(), label: "", l: "", w: "", h: "", qty: "" }])}
              className="text-xs text-[var(--accent)] hover:opacity-80 cursor-pointer"
            >
              + Add
            </button>
          </div>
          {secs.map((s, i) => (
            <div key={s.id} className="mt-1.5 grid grid-cols-5 gap-1.5 items-center">
              <input className={inputCls} inputMode="decimal" placeholder="L" value={s.l} onChange={(e) => updateSec(i, "l", e.target.value)} />
              <input className={inputCls} inputMode="decimal" placeholder="W" value={s.w} onChange={(e) => updateSec(i, "w", e.target.value)} />
              <input className={inputCls} inputMode="decimal" placeholder="H" value={s.h} onChange={(e) => updateSec(i, "h", e.target.value)} />
              <input className={inputCls} inputMode="numeric" placeholder="Qty" value={s.qty} onChange={(e) => updateSec(i, "qty", e.target.value)} />
              <button
                type="button"
                onClick={() => setSecs((arr) => arr.filter((_, j) => j !== i))}
                className="text-xs text-muted hover:text-text cursor-pointer"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

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

        <div className="rounded border border-border p-3">
          <p className={labelCls}>Result</p>
          {result ? (
            <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 font-mono tabular-nums text-sm text-text">
              <span className="text-muted">Parts / block</span>
              <span>{result.primary.total}</span>
              <span className="text-muted">Blocks needed</span>
              <span>{result.blocksNeeded ?? "—"}</span>
              <span className="text-muted">Utilization</span>
              <span>{result.primary.utilPct.toFixed(1)}%</span>
              <span className="text-muted">Produced</span>
              <span>{result.totalProduced ?? "—"}</span>
              <span className="text-muted">Surplus</span>
              <span>{result.surplus ?? "—"}</span>
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted">Enter block + primary part dimensions to calculate.</p>
          )}
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
            disabled={saving || !result}
            className="flex-1 rounded bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 cursor-pointer disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Plan"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
