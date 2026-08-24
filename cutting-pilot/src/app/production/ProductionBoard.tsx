"use client";
// Segmented Molding | Expansion board mirroring the physical XPanda Foam paper log: a session
// header opened once per sheet, then an inline append-row grid for repeated block/batch entry.
// Fully decoupled from jobs — no job_id anywhere in this surface.
import { useCallback, useEffect, useRef, useState } from "react";
import NewSheetModal, { type SheetVariant } from "./NewSheetModal";

type BoardKind = "molding" | "expansion";

interface MoldingSession {
  id: string;
  silo: number | null;
  log_date: string;
  control_no: string | null;
  operator_1: string | null;
  operator_2: string | null;
  status: "open" | "closed";
  block_count: number;
  total_lbs: number;
}

interface MoldingBlock {
  id: string;
  block_no: string | null;
  block_type: string | null;
  block_size: string | null;
  rc_pct_open: number | null;
  rc_speed: number | null;
  virgin_pct_open: number | null;
  virgin_speed: number | null;
  mold_time: string | null;
  block_weight_lbs: number | null;
  init_oper: string | null;
}

interface ExpansionSession {
  id: string;
  silo: number | null;
  log_date: string;
  control_no: string | null;
  start_time: string | null;
  finish_time: string | null;
  density: number | null;
  target_weight_g: number | null;
  bead_type: string | null;
  lot: string | null;
  operator_1: string | null;
  operator_2: string | null;
  status: "open" | "closed";
  batch_count: number;
}

interface ExpansionBatch {
  id: string;
  batch_no: string | null;
  weight_kg: number | null;
  heating_time_s: number | null;
  bucket_weight_g: number | null;
}

interface TodaySummary {
  date: string;
  molding: {
    block_count: number;
    total_lbs: number;
    silos: { silo: number | null; block_count: number; total_lbs: number }[];
  };
  expansion: { batch_count: number };
}

const BLOCK_ROW_DEFAULT = {
  block_no: "", block_type: "", block_size: "", rc_pct_open: "", rc_speed: "",
  virgin_pct_open: "", virgin_speed: "", mold_time: "", block_weight_lbs: "", init_oper: "",
};
const BATCH_ROW_DEFAULT = { batch_no: "", weight_kg: "", heating_time_s: "", bucket_weight_g: "" };

const CELL = "px-2 py-1.5 text-sm text-text whitespace-nowrap";
const HEAD = "px-2 py-1.5 text-xs font-semibold text-muted text-left whitespace-nowrap";
const INPUT =
  "w-full min-h-[40px] px-2 rounded border border-border bg-bg text-text text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

export default function ProductionBoard() {
  const [board, setBoard] = useState<BoardKind>("molding");
  const [today, setToday] = useState<TodaySummary | null>(null);
  const [moldingSessions, setMoldingSessions] = useState<MoldingSession[]>([]);
  const [expansionSessions, setExpansionSessions] = useState<ExpansionSession[]>([]);
  const [blocks, setBlocks] = useState<MoldingBlock[]>([]);
  const [batches, setBatches] = useState<ExpansionBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [newSheetOpen, setNewSheetOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [blockRow, setBlockRow] = useState({ ...BLOCK_ROW_DEFAULT });
  const [batchRow, setBatchRow] = useState({ ...BATCH_ROW_DEFAULT });
  const firstCellRef = useRef<HTMLInputElement>(null);

  const openMolding = moldingSessions.find((s) => s.status === "open") ?? null;
  const openExpansion = expansionSessions.find((s) => s.status === "open") ?? null;
  const openSession = board === "molding" ? openMolding : openExpansion;

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  const fetchToday = useCallback(async () => {
    try {
      const res = await fetch("/v2/api/production/today");
      const data = await res.json();
      if (data.ok) setToday(data);
    } catch {
      // today strip is non-critical; a stale/missing strip isn't worth surfacing an error banner
    }
  }, []);

  const fetchSessions = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [mRes, eRes] = await Promise.all([
        fetch("/v2/api/production/molding/sessions?days=30"),
        fetch("/v2/api/production/expansion/sessions?days=30"),
      ]);
      const [mData, eData] = await Promise.all([mRes.json(), eRes.json()]);
      if (mData.ok) setMoldingSessions(mData.sessions);
      else setError(mData.error || "Failed to load Molding sessions.");
      if (eData.ok) setExpansionSessions(eData.sessions);
      else if (mData.ok) setError(eData.error || "Failed to load Expansion sessions.");
    } catch {
      setError("Network error — check connection.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const fetchRows = useCallback(async (kind: BoardKind, sessionId: string) => {
    try {
      const res = await fetch(`/v2/api/production/${kind}/sessions/${sessionId}`);
      const data = await res.json();
      if (!data.ok) return;
      if (kind === "molding") setBlocks(data.blocks ?? []);
      else setBatches(data.batches ?? []);
    } catch {
      // row-list refetch failure surfaces via the append action's own error path instead
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    fetchToday();
  }, [fetchSessions, fetchToday]);

  useEffect(() => {
    if (board === "molding" && openMolding) fetchRows("molding", openMolding.id);
    else if (board === "expansion" && openExpansion) fetchRows("expansion", openExpansion.id);
    else {
      setBlocks([]);
      setBatches([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, openMolding?.id, openExpansion?.id, fetchRows]);

  async function createSheet(fields: Record<string, string>) {
    setActing(true);
    try {
      const res = await fetch(`/v2/api/production/${board}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("Sheet started.");
        setNewSheetOpen(false);
        await fetchSessions(true);
      } else {
        showToast(data.error || "Failed to start sheet.", false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  async function closeSheet() {
    if (!openSession) return;
    setActing(true);
    try {
      const res = await fetch(`/v2/api/production/${board}/sessions/${openSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("Sheet closed.");
        await fetchSessions(true);
        await fetchToday();
      } else {
        showToast(data.error || "Failed to close sheet.", false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  function nextNo(current: string): string {
    const n = Number(current);
    return current !== "" && Number.isFinite(n) ? String(n + 1) : "";
  }

  async function submitBlockRow() {
    if (!openMolding) return;
    setActing(true);
    try {
      const res = await fetch("/v2/api/production/molding/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: openMolding.id, ...blockRow }),
      });
      const data = await res.json();
      if (data.ok) {
        setBlockRow({ ...BLOCK_ROW_DEFAULT, block_no: nextNo(blockRow.block_no) });
        await Promise.all([fetchRows("molding", openMolding.id), fetchToday()]);
        firstCellRef.current?.focus();
      } else {
        showToast(data.error || "Failed to save block.", false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  async function submitBatchRow() {
    if (!openExpansion) return;
    setActing(true);
    try {
      const res = await fetch("/v2/api/production/expansion/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: openExpansion.id, ...batchRow }),
      });
      const data = await res.json();
      if (data.ok) {
        setBatchRow({ ...BATCH_ROW_DEFAULT, batch_no: nextNo(batchRow.batch_no) });
        await Promise.all([fetchRows("expansion", openExpansion.id), fetchToday()]);
        firstCellRef.current?.focus();
      } else {
        showToast(data.error || "Failed to save batch.", false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={[
            "fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded text-sm font-medium pointer-events-none",
            toast.ok
              ? "bg-[var(--success-bg)] text-[var(--success-text)]"
              : "bg-[var(--danger-bg)] text-[var(--danger-text)]",
          ].join(" ")}
        >
          {toast.msg}
        </div>
      )}

      {/* Segmented switch */}
      <div className="shrink-0 flex gap-1 p-2 border-b border-border bg-surface">
        {(["molding", "expansion"] as BoardKind[]).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={board === k}
            onClick={() => setBoard(k)}
            className={[
              "flex-1 md:flex-none min-h-[44px] px-5 rounded text-sm font-semibold cursor-pointer capitalize",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
              board === k
                ? "bg-[var(--brand)] text-white"
                : "bg-[var(--ghost-bg)] text-muted hover:text-text",
            ].join(" ")}
          >
            {k}
          </button>
        ))}
      </div>

      {/* Made-today strip */}
      {today && (
        <div className="shrink-0 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 border-b border-border bg-[var(--surface-2)] text-xs">
          <span className="font-semibold text-text">Made today ({today.date})</span>
          <span className="text-muted">
            Molding: <span className="font-semibold text-text">{today.molding.block_count}</span> blocks ·{" "}
            <span className="font-semibold text-text">{today.molding.total_lbs.toFixed(1)}</span> lbs
          </span>
          {today.molding.silos.map((s) => (
            <span
              key={String(s.silo)}
              className="px-2 py-0.5 rounded-full bg-[var(--ghost-bg)] text-muted"
            >
              Silo {s.silo ?? "—"}: {s.block_count} blk
            </span>
          ))}
          <span className="text-muted">
            Expansion: <span className="font-semibold text-text">{today.expansion.batch_count}</span> batches
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="border border-border rounded px-4 py-3 animate-pulse motion-reduce:animate-none">
              <div className="h-4 bg-[var(--ghost-bg)] rounded w-40 mb-2" />
              <div className="h-3 bg-[var(--ghost-bg)] rounded w-24" />
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
                  onClick={() => fetchSessions()}
                  className="text-xs text-muted underline underline-offset-2 cursor-pointer hover:text-text"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {!error && (
            <div className="p-4 space-y-4">
              {/* Session bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border border-border rounded px-4 py-3">
                {openSession ? (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                    <span className="font-semibold text-text">
                      {board === "molding" ? "Molding" : "Expansion"} — {openSession.log_date}
                    </span>
                    <span className="text-muted">Silo {openSession.silo ?? "—"}</span>
                    <span className="text-muted">Control # {openSession.control_no || "—"}</span>
                    <span className="text-muted">
                      {openSession.operator_1 || "—"}
                      {openSession.operator_2 ? ` / ${openSession.operator_2}` : ""}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-muted">No open sheet. Start a sheet to begin logging.</p>
                )}
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setNewSheetOpen(true)}
                    className="min-h-[40px] px-4 rounded border border-border bg-[var(--ghost-bg)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    New sheet
                  </button>
                  {openSession && (
                    <button
                      type="button"
                      disabled={acting}
                      onClick={closeSheet}
                      className="min-h-[40px] px-4 rounded border border-border text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      Close sheet
                    </button>
                  )}
                </div>
              </div>

              {/* Row grid */}
              {openSession && board === "molding" && (
                <div className="overflow-x-auto border border-border rounded">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-[var(--surface-2)]">
                        <th className={HEAD}># Block</th>
                        <th className={HEAD}>Block Type</th>
                        <th className={HEAD}>Block Size</th>
                        <th className={HEAD}>RC % Open</th>
                        <th className={HEAD}>RC Speed</th>
                        <th className={HEAD}>Virgin % Open</th>
                        <th className={HEAD}>Virgin Speed</th>
                        <th className={HEAD}>Time</th>
                        <th className={HEAD}>Block Weight (lbs)</th>
                        <th className={HEAD}>Init. Oper</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blocks.map((b) => (
                        <tr key={b.id} className="border-b border-border">
                          <td className={CELL}>{b.block_no || "—"}</td>
                          <td className={CELL}>{b.block_type || "—"}</td>
                          <td className={CELL}>{b.block_size || "—"}</td>
                          <td className={CELL}>{b.rc_pct_open ?? "—"}</td>
                          <td className={CELL}>{b.rc_speed ?? "—"}</td>
                          <td className={CELL}>{b.virgin_pct_open ?? "—"}</td>
                          <td className={CELL}>{b.virgin_speed ?? "—"}</td>
                          <td className={CELL}>{b.mold_time || "—"}</td>
                          <td className={CELL}>{b.block_weight_lbs ?? "—"}</td>
                          <td className={CELL}>{b.init_oper || "—"}</td>
                        </tr>
                      ))}
                      <tr className="sticky bottom-0 bg-surface border-t-2 border-border">
                        <td className="px-2 py-1.5">
                          <input
                            ref={firstCellRef}
                            type="text"
                            className={INPUT}
                            value={blockRow.block_no}
                            onChange={(e) => setBlockRow((r) => ({ ...r, block_no: e.target.value }))}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="text"
                            className={INPUT}
                            value={blockRow.block_type}
                            onChange={(e) => setBlockRow((r) => ({ ...r, block_type: e.target.value }))}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="text"
                            className={INPUT}
                            value={blockRow.block_size}
                            onChange={(e) => setBlockRow((r) => ({ ...r, block_size: e.target.value }))}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            step="any"
                            className={INPUT}
                            value={blockRow.rc_pct_open}
                            onChange={(e) => setBlockRow((r) => ({ ...r, rc_pct_open: e.target.value }))}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            step="any"
                            className={INPUT}
                            value={blockRow.rc_speed}
                            onChange={(e) => setBlockRow((r) => ({ ...r, rc_speed: e.target.value }))}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            step="any"
                            className={INPUT}
                            value={blockRow.virgin_pct_open}
                            onChange={(e) => setBlockRow((r) => ({ ...r, virgin_pct_open: e.target.value }))}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            step="any"
                            className={INPUT}
                            value={blockRow.virgin_speed}
                            onChange={(e) => setBlockRow((r) => ({ ...r, virgin_speed: e.target.value }))}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="text"
                            placeholder="9:30 AM"
                            className={INPUT}
                            value={blockRow.mold_time}
                            onChange={(e) => setBlockRow((r) => ({ ...r, mold_time: e.target.value }))}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            step="any"
                            className={INPUT}
                            value={blockRow.block_weight_lbs}
                            onChange={(e) => setBlockRow((r) => ({ ...r, block_weight_lbs: e.target.value }))}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex gap-1">
                            <input
                              type="text"
                              className={INPUT}
                              value={blockRow.init_oper}
                              onChange={(e) => setBlockRow((r) => ({ ...r, init_oper: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter" && !acting) submitBlockRow(); }}
                            />
                            <button
                              type="button"
                              disabled={acting}
                              onClick={submitBlockRow}
                              className="shrink-0 min-h-[40px] px-3 rounded bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                            >
                              Add
                            </button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {openSession && board === "expansion" && (
                <div className="overflow-x-auto border border-border rounded">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-[var(--surface-2)]">
                        <th className={HEAD}>Batch</th>
                        <th className={HEAD}>Weight (KG)</th>
                        <th className={HEAD}>Heating Time (s)</th>
                        <th className={HEAD}>Bucket Weight (g)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batches.map((b) => (
                        <tr key={b.id} className="border-b border-border">
                          <td className={CELL}>{b.batch_no || "—"}</td>
                          <td className={CELL}>{b.weight_kg ?? "—"}</td>
                          <td className={CELL}>{b.heating_time_s ?? "—"}</td>
                          <td className={CELL}>{b.bucket_weight_g ?? "—"}</td>
                        </tr>
                      ))}
                      <tr className="sticky bottom-0 bg-surface border-t-2 border-border">
                        <td className="px-2 py-1.5">
                          <input
                            ref={firstCellRef}
                            type="text"
                            className={INPUT}
                            value={batchRow.batch_no}
                            onChange={(e) => setBatchRow((r) => ({ ...r, batch_no: e.target.value }))}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            step="any"
                            className={INPUT}
                            value={batchRow.weight_kg}
                            onChange={(e) => setBatchRow((r) => ({ ...r, weight_kg: e.target.value }))}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            step="any"
                            className={INPUT}
                            value={batchRow.heating_time_s}
                            onChange={(e) => setBatchRow((r) => ({ ...r, heating_time_s: e.target.value }))}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex gap-1">
                            <input
                              type="number"
                              step="any"
                              className={INPUT}
                              value={batchRow.bucket_weight_g}
                              onChange={(e) => setBatchRow((r) => ({ ...r, bucket_weight_g: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter" && !acting) submitBatchRow(); }}
                            />
                            <button
                              type="button"
                              disabled={acting}
                              onClick={submitBatchRow}
                              className="shrink-0 min-h-[40px] px-3 rounded bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                            >
                              Add
                            </button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <NewSheetModal
        isOpen={newSheetOpen}
        onClose={() => setNewSheetOpen(false)}
        variant={board as SheetVariant}
        onSubmit={createSheet}
        acting={acting}
      />
    </div>
  );
}
