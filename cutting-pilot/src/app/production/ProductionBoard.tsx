"use client";
// Segmented Molding | Expansion board mirroring the physical XPanda Foam paper log: a session
// header opened once per sheet, then an inline append-row grid for repeated block/batch entry.
// Fully decoupled from jobs — no job_id anywhere in this surface.
//
// P419: a sheet picker lets the floor browse ANY sheet (open + closed) instead of only ever
// showing the single open session. Only the selected sheet's OPEN status makes it mutable
// (append + per-row edit/delete); a closed sheet is read-only until Reopened.
import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import NewSheetModal, { type SheetVariant } from "./NewSheetModal";
import EditRowModal from "./EditRowModal";
import DeleteRowModal from "./DeleteRowModal";
import { MOLDING_FIELDS, EXPANSION_FIELDS, fieldsFor, emptyRow, rowToValues, type RowFieldDef } from "./fields";

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

interface EditingRow {
  id: string;
  label: string;
  values: Record<string, string>;
}

interface DeletingRow {
  id: string;
  label: string;
}

const CELL = "px-2 py-1.5 text-sm text-text whitespace-nowrap";
const HEAD = "px-2 py-1.5 text-xs font-semibold text-muted text-left whitespace-nowrap";
const INPUT =
  "w-full min-h-[40px] px-2 rounded border border-border bg-bg text-text text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

function errorMessage(err: string | undefined, fallback: string): string {
  if (err === "sheet_closed") return "This sheet is locked — reopen it to edit.";
  return err || fallback;
}

export default function ProductionBoard() {
  const [board, setBoard] = useState<BoardKind>("molding");
  const [today, setToday] = useState<TodaySummary | null>(null);
  const [moldingSessions, setMoldingSessions] = useState<MoldingSession[]>([]);
  const [expansionSessions, setExpansionSessions] = useState<ExpansionSession[]>([]);
  const [selectedMoldingId, setSelectedMoldingId] = useState<string | null>(null);
  const [selectedExpansionId, setSelectedExpansionId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<MoldingBlock[]>([]);
  const [batches, setBatches] = useState<ExpansionBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [newSheetOpen, setNewSheetOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [blockRow, setBlockRow] = useState(emptyRow(MOLDING_FIELDS));
  const [batchRow, setBatchRow] = useState(emptyRow(EXPANSION_FIELDS));
  const [editingRow, setEditingRow] = useState<EditingRow | null>(null);
  const [deletingRow, setDeletingRow] = useState<DeletingRow | null>(null);
  const firstCellRef = useRef<HTMLInputElement>(null);

  const sessionsForBoard = board === "molding" ? moldingSessions : expansionSessions;
  const selectedId = board === "molding" ? selectedMoldingId : selectedExpansionId;
  const selectedSession = sessionsForBoard.find((s) => s.id === selectedId) ?? null;
  const isEditable = selectedSession?.status === "open";
  const fields = fieldsFor(board);
  const rowPath = board === "molding" ? "blocks" : "batches";

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
      // row-list refetch failure surfaces via the append/edit/delete action's own error path instead
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    fetchToday();
  }, [fetchSessions, fetchToday]);

  // Default the selected sheet to the open session (or the newest sheet if none open); keep the
  // current selection if it's still in the refreshed list.
  useEffect(() => {
    setSelectedMoldingId((cur) => {
      if (!moldingSessions.length) return null;
      if (cur && moldingSessions.some((s) => s.id === cur)) return cur;
      const open = moldingSessions.find((s) => s.status === "open");
      return (open ?? moldingSessions[0]).id;
    });
  }, [moldingSessions]);

  useEffect(() => {
    setSelectedExpansionId((cur) => {
      if (!expansionSessions.length) return null;
      if (cur && expansionSessions.some((s) => s.id === cur)) return cur;
      const open = expansionSessions.find((s) => s.status === "open");
      return (open ?? expansionSessions[0]).id;
    });
  }, [expansionSessions]);

  useEffect(() => {
    if (board === "molding") {
      if (selectedMoldingId) fetchRows("molding", selectedMoldingId);
      else setBlocks([]);
    } else {
      if (selectedExpansionId) fetchRows("expansion", selectedExpansionId);
      else setBatches([]);
    }
  }, [board, selectedMoldingId, selectedExpansionId, fetchRows]);

  function selectSheet(id: string) {
    if (board === "molding") setSelectedMoldingId(id);
    else setSelectedExpansionId(id);
  }

  async function createSheet(fieldsBody: Record<string, string>) {
    setActing(true);
    try {
      const res = await fetch(`/v2/api/production/${board}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fieldsBody),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("Sheet started.");
        setNewSheetOpen(false);
        if (board === "molding") setSelectedMoldingId(data.session_id);
        else setSelectedExpansionId(data.session_id);
        await fetchSessions(true);
      } else {
        showToast(errorMessage(data.error, "Failed to start sheet."), false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  async function closeSheet() {
    if (!selectedSession) return;
    setActing(true);
    try {
      const res = await fetch(`/v2/api/production/${board}/sessions/${selectedSession.id}`, {
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
        showToast(errorMessage(data.error, "Failed to close sheet."), false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  async function reopenSheet() {
    if (!selectedSession) return;
    setActing(true);
    try {
      const res = await fetch(`/v2/api/production/${board}/sessions/${selectedSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "open" }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("Sheet reopened.");
        await fetchSessions(true);
      } else {
        showToast(errorMessage(data.error, "Failed to reopen sheet."), false);
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
    if (!selectedMoldingId) return;
    setActing(true);
    try {
      const res = await fetch("/v2/api/production/molding/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: selectedMoldingId, ...blockRow }),
      });
      const data = await res.json();
      if (data.ok) {
        setBlockRow({ ...emptyRow(MOLDING_FIELDS), block_no: nextNo(blockRow.block_no) });
        await Promise.all([fetchRows("molding", selectedMoldingId), fetchToday()]);
        firstCellRef.current?.focus();
      } else {
        showToast(errorMessage(data.error, "Failed to save block."), false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  async function submitBatchRow() {
    if (!selectedExpansionId) return;
    setActing(true);
    try {
      const res = await fetch("/v2/api/production/expansion/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: selectedExpansionId, ...batchRow }),
      });
      const data = await res.json();
      if (data.ok) {
        setBatchRow({ ...emptyRow(EXPANSION_FIELDS), batch_no: nextNo(batchRow.batch_no) });
        await Promise.all([fetchRows("expansion", selectedExpansionId), fetchToday()]);
        firstCellRef.current?.focus();
      } else {
        showToast(errorMessage(data.error, "Failed to save batch."), false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  function openEdit(row: MoldingBlock | ExpansionBatch) {
    const label =
      board === "molding"
        ? `Block #${(row as MoldingBlock).block_no || row.id.slice(0, 8)}`
        : `Batch #${(row as ExpansionBatch).batch_no || row.id.slice(0, 8)}`;
    setEditingRow({ id: row.id, label, values: rowToValues(fields, row) });
  }

  function openDelete(row: MoldingBlock | ExpansionBatch) {
    const label =
      board === "molding"
        ? `Block #${(row as MoldingBlock).block_no || row.id.slice(0, 8)}`
        : `Batch #${(row as ExpansionBatch).batch_no || row.id.slice(0, 8)}`;
    setDeletingRow({ id: row.id, label });
  }

  async function submitEditRow(values: Record<string, string>) {
    if (!editingRow) return;
    const changed = Object.fromEntries(
      Object.entries(values).filter(([k, v]) => v !== (editingRow.values[k] ?? ""))
    );
    if (!Object.keys(changed).length) {
      setEditingRow(null);
      return;
    }
    setActing(true);
    try {
      const res = await fetch(`/v2/api/production/${board}/${rowPath}/${editingRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changed),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("Row updated.");
        setEditingRow(null);
        if (selectedId) await Promise.all([fetchRows(board, selectedId), fetchToday()]);
      } else {
        showToast(errorMessage(data.error, "Failed to update row."), false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  async function confirmDeleteRow() {
    if (!deletingRow) return;
    setActing(true);
    try {
      const res = await fetch(`/v2/api/production/${board}/${rowPath}/${deletingRow.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.ok) {
        showToast("Row deleted.");
        setDeletingRow(null);
        if (selectedId) await Promise.all([fetchRows(board, selectedId), fetchToday()]);
      } else {
        showToast(errorMessage(data.error, "Failed to delete row."), false);
        setDeletingRow(null);
      }
    } catch {
      showToast("Network error.", false);
      setDeletingRow(null);
    } finally {
      setActing(false);
    }
  }

  function displayValue(f: RowFieldDef, row: Record<string, any>): string {
    const v = row[f.key];
    return v === null || v === undefined || v === "" ? "—" : String(v);
  }

  const rows: (MoldingBlock | ExpansionBatch)[] = board === "molding" ? blocks : batches;
  const appendRow = board === "molding" ? blockRow : batchRow;
  const setAppendRow = board === "molding" ? setBlockRow : setBatchRow;
  const submitAppendRow = board === "molding" ? submitBlockRow : submitBatchRow;

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
                {selectedSession ? (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                    <span className="font-semibold text-text">
                      {board === "molding" ? "Molding" : "Expansion"} — {selectedSession.log_date}
                    </span>
                    <span className="text-muted">Silo {selectedSession.silo ?? "—"}</span>
                    <span className="text-muted">Control # {selectedSession.control_no || "—"}</span>
                    <span className="text-muted">
                      {selectedSession.operator_1 || "—"}
                      {selectedSession.operator_2 ? ` / ${selectedSession.operator_2}` : ""}
                    </span>
                    <span
                      className={[
                        "px-2 py-0.5 rounded-full text-xs font-semibold",
                        isEditable
                          ? "bg-[var(--success-bg)] text-[var(--success-text)]"
                          : "bg-[var(--ghost-bg)] text-muted",
                      ].join(" ")}
                    >
                      {isEditable ? "OPEN" : "CLOSED"}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-muted">No sheets yet. Start a sheet to begin logging.</p>
                )}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {sessionsForBoard.length > 0 && (
                    <select
                      aria-label="Select sheet"
                      value={selectedId ?? ""}
                      onChange={(e) => selectSheet(e.target.value)}
                      className="min-h-[44px] px-3 rounded border border-border bg-bg text-text text-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      {sessionsForBoard.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.log_date} · Silo {s.silo ?? "—"} · #{s.control_no || "—"} ·{" "}
                          {s.status.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() => setNewSheetOpen(true)}
                    className="min-h-[44px] px-4 rounded border border-border bg-[var(--ghost-bg)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    New sheet
                  </button>
                  {selectedSession && isEditable && (
                    <button
                      type="button"
                      disabled={acting}
                      onClick={closeSheet}
                      className="min-h-[44px] px-4 rounded border border-border text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      Close sheet
                    </button>
                  )}
                  {selectedSession && !isEditable && (
                    <button
                      type="button"
                      disabled={acting}
                      onClick={reopenSheet}
                      className="min-h-[44px] px-4 rounded border border-border text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              </div>

              {/* Row grid */}
              {selectedSession && (
                <div className="overflow-x-auto border border-border rounded">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-[var(--surface-2)]">
                        {fields.map((f) => (
                          <th key={f.key} className={HEAD}>
                            {f.label}
                          </th>
                        ))}
                        {isEditable && <th className={HEAD}>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id} className="border-b border-border">
                          {fields.map((f) => (
                            <td key={f.key} className={CELL}>
                              {displayValue(f, row)}
                            </td>
                          ))}
                          {isEditable && (
                            <td className={CELL}>
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => openEdit(row)}
                                  aria-label="Edit row"
                                  className="w-11 h-11 flex items-center justify-center rounded text-muted hover:text-text hover:bg-[var(--ghost-bg)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                                >
                                  <Pencil size={16} aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openDelete(row)}
                                  aria-label="Delete row"
                                  className="w-11 h-11 flex items-center justify-center rounded text-muted hover:text-[var(--danger-bg)] hover:bg-[var(--ghost-bg)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                                >
                                  <Trash2 size={16} aria-hidden="true" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}

                      {isEditable && (
                        <tr className="sticky bottom-0 bg-surface border-t-2 border-border">
                          {fields.map((f, i) => {
                            const isLast = i === fields.length - 1;
                            return (
                              <td key={f.key} className="px-2 py-1.5">
                                {isLast ? (
                                  <div className="flex gap-1">
                                    <input
                                      type={f.type}
                                      step={f.type === "number" ? "any" : undefined}
                                      placeholder={f.placeholder}
                                      className={INPUT}
                                      value={appendRow[f.key]}
                                      onChange={(e) =>
                                        setAppendRow((r) => ({ ...r, [f.key]: e.target.value }))
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" && !acting) submitAppendRow();
                                      }}
                                    />
                                    <button
                                      type="button"
                                      disabled={acting}
                                      onClick={submitAppendRow}
                                      className="shrink-0 min-h-[40px] px-3 rounded bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                                    >
                                      Add
                                    </button>
                                  </div>
                                ) : (
                                  <input
                                    ref={i === 0 ? firstCellRef : undefined}
                                    type={f.type}
                                    step={f.type === "number" ? "any" : undefined}
                                    placeholder={f.placeholder}
                                    className={INPUT}
                                    value={appendRow[f.key]}
                                    onChange={(e) =>
                                      setAppendRow((r) => ({ ...r, [f.key]: e.target.value }))
                                    }
                                  />
                                )}
                              </td>
                            );
                          })}
                          <td />
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {!isEditable && (
                    <p className="px-3 py-2 text-xs text-muted border-t border-border">
                      Closed — reopen to edit.
                    </p>
                  )}
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

      <EditRowModal
        isOpen={editingRow !== null}
        onClose={() => setEditingRow(null)}
        title={editingRow?.label ?? "Edit row"}
        size={board === "molding" ? "lg" : "md"}
        fields={fields}
        initialValues={editingRow?.values ?? {}}
        onSubmit={submitEditRow}
        acting={acting}
      />

      <DeleteRowModal
        isOpen={deletingRow !== null}
        rowLabel={deletingRow?.label}
        acting={acting}
        onConfirm={confirmDeleteRow}
        onCancel={() => setDeletingRow(null)}
      />
    </div>
  );
}
