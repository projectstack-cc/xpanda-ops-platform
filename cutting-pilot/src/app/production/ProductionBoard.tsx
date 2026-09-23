"use client";
// Segmented Molding | Expansion board mirroring the physical XPanda Foam paper log: a session
// header opened once per sheet, then an inline append-row grid for repeated block/batch entry.
// Fully decoupled from jobs — no job_id anywhere in this surface.
//
// prod-a-03 (Group A): lot # replaces control #, silo/lot/operator now live per row, molding
// sheets carry one block type, block #/time/operator auto-fill, managed dropdowns with manager
// "+ Add new…", sheet delete (soft/purge), and full en/es/ht via the new LangSelect.
import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useLang } from "@/components/lang";
import LangSelect from "@/components/LangSelect";
import { nextBlockNo } from "@/lib/productionNumbering";
import NewSheetModal, { type SheetVariant } from "./NewSheetModal";
import EditRowModal from "./EditRowModal";
import DeleteRowModal from "./DeleteRowModal";
import DeleteSheetModal from "./DeleteSheetModal";
import AddOptionModal, { type OptionKind } from "./AddOptionModal";
import {
  MOLDING_FIELDS,
  EXPANSION_FIELDS,
  fieldsFor,
  emptyRow,
  rowToValues,
  carryRow,
  type RowFieldDef,
  type OptionsData,
} from "./fields";

type BoardKind = "molding" | "expansion";

interface MoldingSession {
  id: string;
  log_date: string;
  block_type: string | null;
  status: "open" | "closed";
  block_count: number;
  total_lbs: number;
}

interface MoldingBlock {
  id: string;
  block_no: string | null;
  block_size: string | null;
  silo: number | null;
  lot_no: string | null;
  rc_pct_open: number | null;
  rc_speed: number | null;
  virgin_pct_open: number | null;
  virgin_speed: number | null;
  mold_time: string | null;
  block_weight_lbs: number | null;
  operator_name: string | null;
}

interface ExpansionSession {
  id: string;
  log_date: string;
  start_time: string | null;
  finish_time: string | null;
  bead_supplier: string | null;
  bead_type: string | null;
  density: number | null;
  target_weight_g: number | null;
  status: "open" | "closed";
  batch_count: number;
  total_kg: number;
}

interface ExpansionBatch {
  id: string;
  lot_no: string | null;
  silo: number | null;
  weight_kg: number | null;
  heating_time_s: number | null;
  bucket_weight_g: number | null;
  operator_name: string | null;
}

interface TodaySummary {
  date: string;
  molding: {
    block_count: number;
    total_lbs: number;
    silos: { silo: number | null; block_count: number; total_lbs: number }[];
  };
  expansion: {
    batch_count: number;
    total_kg: number;
    silos: { silo: number | null; batch_count: number; total_kg: number }[];
  };
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

interface Props {
  canManage: boolean;
  isAdmin: boolean;
  userName: string;
}

const EMPTY_OPTIONS: OptionsData = { block_types: [], block_sizes: [], suppliers: [], bead_types: {} };

const CELL = "px-2 py-1.5 text-sm text-text whitespace-nowrap";
const HEAD = "px-2 py-1.5 text-xs font-semibold text-muted text-left whitespace-nowrap";
const INPUT =
  "w-full min-h-[40px] px-2 rounded border border-border bg-bg text-text text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

const ADD_NEW = "__add_new__";

const ERROR_KEY: Record<string, string> = {
  sheet_closed: "production.error.sheetClosed",
  sheet_not_found: "production.error.sheetNotFound",
  weight_required: "production.error.weightRequired",
  block_type_required: "production.error.blockTypeRequired",
  unknown_block_type: "production.error.unknownBlockType",
  unknown_block_size: "production.error.unknownBlockSize",
  unknown_bead_type: "production.error.unknownBeadType",
  option_exists: "production.error.optionExists",
  admin_only: "production.error.adminOnly",
  Unauthorized: "production.error.unauthorized",
  "Access denied.": "production.error.forbidden",
};

export default function ProductionBoard({ canManage, isAdmin, userName }: Props) {
  const { t } = useLang();
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
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);
  const [options, setOptions] = useState<OptionsData>(EMPTY_OPTIONS);
  const [addOptionRequest, setAddOptionRequest] = useState<{ kind: OptionKind; supplier?: string } | null>(null);
  const [injectedOption, setInjectedOption] = useState<{ field: "block_type" | "bead_type"; value: string } | null>(
    null
  );
  const inputRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({});

  const sessionsForBoard = board === "molding" ? moldingSessions : expansionSessions;
  const selectedId = board === "molding" ? selectedMoldingId : selectedExpansionId;
  const selectedMoldingSession = moldingSessions.find((s) => s.id === selectedMoldingId) ?? null;
  const selectedExpansionSession = expansionSessions.find((s) => s.id === selectedExpansionId) ?? null;
  const selectedSession = board === "molding" ? selectedMoldingSession : selectedExpansionSession;
  const isEditable = selectedSession?.status === "open";
  const fields = fieldsFor(board);
  const appendFields = fields.filter((f) => f.auto !== "operator");
  const rowPath = board === "molding" ? "blocks" : "batches";
  const optionValues: Record<string, string[]> = { block_sizes: options.block_sizes };

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  function errorMessage(err: string | undefined, fallbackKey: string): string {
    if (err && ERROR_KEY[err]) return t(ERROR_KEY[err]);
    return t(fallbackKey);
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

  const fetchOptions = useCallback(async () => {
    try {
      const res = await fetch("/v2/api/production/options");
      const data = await res.json();
      if (data.ok) {
        setOptions({
          block_types: data.block_types ?? [],
          block_sizes: data.block_sizes ?? [],
          suppliers: data.suppliers ?? [],
          bead_types: data.bead_types ?? {},
        });
      }
    } catch {
      // options are refetched on demand elsewhere; a transient miss just leaves selects sparse
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
      else setError(errorMessage(mData.error, "production.error.loadMoldingFailed"));
      if (eData.ok) setExpansionSessions(eData.sessions);
      else if (mData.ok) setError(errorMessage(eData.error, "production.error.loadExpansionFailed"));
    } catch {
      setError(t("production.error.networkError"));
    } finally {
      if (!silent) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchRows = useCallback(async (kind: BoardKind, sessionId: string, seedCarry = false) => {
    try {
      const res = await fetch(`/v2/api/production/${kind}/sessions/${sessionId}`);
      const data = await res.json();
      if (!data.ok) return;
      const rows = kind === "molding" ? data.blocks ?? [] : data.batches ?? [];
      if (kind === "molding") setBlocks(rows);
      else setBatches(rows);
      if (seedCarry) {
        const seeded = carryRow(fieldsFor(kind), rows[rows.length - 1] ?? null);
        if (kind === "molding") setBlockRow((r) => ({ ...r, ...seeded }));
        else setBatchRow((r) => ({ ...r, ...seeded }));
      }
    } catch {
      // row-list refetch failure surfaces via the append/edit/delete action's own error path instead
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    fetchToday();
    fetchOptions();
  }, [fetchSessions, fetchToday, fetchOptions]);

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
      if (selectedMoldingId) fetchRows("molding", selectedMoldingId, true);
      else setBlocks([]);
    } else {
      if (selectedExpansionId) fetchRows("expansion", selectedExpansionId, true);
      else setBatches([]);
    }
  }, [board, selectedMoldingId, selectedExpansionId, fetchRows]);

  // Block # is always the reactive suggestion off the current sheet's rows — recomputed on
  // every append, delete, and sheet change (whenever `blocks` changes), never on a timer.
  useEffect(() => {
    if (board !== "molding") return;
    const next = nextBlockNo(blocks.map((b) => b.block_no));
    setBlockRow((r) => (r.block_no === next ? r : { ...r, block_no: next }));
  }, [blocks, board]);

  function selectSheet(id: string) {
    if (board === "molding") setSelectedMoldingId(id);
    else setSelectedExpansionId(id);
  }

  async function switchUser() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // best-effort — the login page's own session check will catch a still-authenticated state
    }
    window.location.href = "/login.html?next=" + encodeURIComponent("/v2/production");
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
        showToast(t("production.toast.sheetStarted"));
        setNewSheetOpen(false);
        if (board === "molding") setSelectedMoldingId(data.session_id);
        else setSelectedExpansionId(data.session_id);
        await fetchSessions(true);
      } else {
        showToast(errorMessage(data.error, "production.toast.startSheetFailed"), false);
      }
    } catch {
      showToast(t("production.toast.networkError"), false);
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
        showToast(t("production.toast.sheetClosed"));
        await fetchSessions(true);
        await fetchToday();
      } else {
        showToast(errorMessage(data.error, "production.toast.closeSheetFailed"), false);
      }
    } catch {
      showToast(t("production.toast.networkError"), false);
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
        showToast(t("production.toast.sheetReopened"));
        await fetchSessions(true);
      } else {
        showToast(errorMessage(data.error, "production.toast.reopenSheetFailed"), false);
      }
    } catch {
      showToast(t("production.toast.networkError"), false);
    } finally {
      setActing(false);
    }
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
        setBlockRow((r) => carryRow(MOLDING_FIELDS, r));
        await Promise.all([fetchRows("molding", selectedMoldingId), fetchToday()]);
        inputRefs.current["block_weight_lbs"]?.focus();
      } else {
        showToast(errorMessage(data.error, "production.toast.saveBlockFailed"), false);
      }
    } catch {
      showToast(t("production.toast.networkError"), false);
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
        setBatchRow((r) => carryRow(EXPANSION_FIELDS, r));
        await Promise.all([fetchRows("expansion", selectedExpansionId), fetchToday()]);
        inputRefs.current["weight_kg"]?.focus();
      } else {
        showToast(errorMessage(data.error, "production.toast.saveBatchFailed"), false);
      }
    } catch {
      showToast(t("production.toast.networkError"), false);
    } finally {
      setActing(false);
    }
  }

  function openEdit(row: MoldingBlock | ExpansionBatch) {
    const label =
      board === "molding"
        ? `${t("production.field.blockNo")} ${(row as MoldingBlock).block_no || row.id.slice(0, 8)}`
        : `${t("production.field.lotNo")} ${(row as ExpansionBatch).lot_no || row.id.slice(0, 8)}`;
    setEditingRow({ id: row.id, label, values: rowToValues(fields, row) });
  }

  function openDelete(row: MoldingBlock | ExpansionBatch) {
    const label =
      board === "molding"
        ? `${t("production.field.blockNo")} ${(row as MoldingBlock).block_no || row.id.slice(0, 8)}`
        : `${t("production.field.lotNo")} ${(row as ExpansionBatch).lot_no || row.id.slice(0, 8)}`;
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
        showToast(t("production.toast.rowUpdated"));
        setEditingRow(null);
        if (selectedId) await Promise.all([fetchRows(board, selectedId), fetchToday()]);
      } else {
        showToast(errorMessage(data.error, "production.toast.updateRowFailed"), false);
      }
    } catch {
      showToast(t("production.toast.networkError"), false);
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
        showToast(t("production.toast.rowDeleted"));
        setDeletingRow(null);
        if (selectedId) await Promise.all([fetchRows(board, selectedId), fetchToday()]);
      } else {
        showToast(errorMessage(data.error, "production.toast.deleteRowFailed"), false);
        setDeletingRow(null);
      }
    } catch {
      showToast(t("production.toast.networkError"), false);
      setDeletingRow(null);
    } finally {
      setActing(false);
    }
  }

  async function deleteSheet(hard: boolean) {
    if (!selectedSession) return;
    setActing(true);
    try {
      const url = `/v2/api/production/manage/sheets/${board}/${selectedSession.id}${hard ? "?hard=1" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        showToast(t(hard ? "production.toast.sheetPurged" : "production.toast.sheetHidden"));
        setDeleteSheetOpen(false);
        await Promise.all([fetchSessions(true), fetchToday()]);
      } else {
        showToast(errorMessage(data.error, "production.toast.deleteSheetFailed"), false);
      }
    } catch {
      showToast(t("production.toast.networkError"), false);
    } finally {
      setActing(false);
    }
  }

  function handleAddOptionRequest(kind: OptionKind, supplier?: string) {
    setAddOptionRequest({ kind, supplier });
  }

  function handleOptionAdded(value: string) {
    if (!addOptionRequest) return;
    if (addOptionRequest.kind === "block_size") {
      setBlockRow((r) => ({ ...r, block_size: value }));
    } else if (addOptionRequest.kind === "block_type") {
      setInjectedOption({ field: "block_type", value });
    } else if (addOptionRequest.kind === "bead_type") {
      setInjectedOption({ field: "bead_type", value });
    }
    showToast(t("production.toast.optionAdded"));
    fetchOptions();
    setAddOptionRequest(null);
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

      {/* Segmented switch + language */}
      <div className="shrink-0 flex items-center justify-between gap-2 p-2 border-b border-border bg-surface">
        <div className="flex gap-1">
          {(["molding", "expansion"] as BoardKind[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={board === k}
              onClick={() => setBoard(k)}
              className={[
                "flex-1 md:flex-none min-h-[44px] px-5 rounded text-sm font-semibold cursor-pointer",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                board === k
                  ? "bg-[var(--brand)] text-white"
                  : "bg-[var(--ghost-bg)] text-muted hover:text-text",
              ].join(" ")}
            >
              {t(k === "molding" ? "production.board.molding" : "production.board.expansion")}
            </button>
          ))}
        </div>
        <LangSelect />
      </div>

      {/* Made-today strip */}
      {today && (
        <div className="shrink-0 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 border-b border-border bg-[var(--surface-2)] text-xs">
          <span className="font-semibold text-text">
            {t("production.today.heading")} ({today.date})
          </span>
          <span className="text-muted">
            {t("production.today.moldingLabel")}{" "}
            <span className="font-semibold text-text">{today.molding.block_count}</span>{" "}
            {t("production.today.blocksUnit")} ·{" "}
            <span className="font-semibold text-text">{today.molding.total_lbs.toFixed(1)}</span>{" "}
            {t("production.today.lbsUnit")}
          </span>
          {today.molding.silos.map((s) => (
            <span
              key={`m-${String(s.silo)}`}
              className="px-2 py-0.5 rounded-full bg-[var(--ghost-bg)] text-muted"
            >
              {t("production.today.silo")} {s.silo ?? "—"}: {s.block_count} {t("production.today.blkUnit")}
            </span>
          ))}
          <span className="text-muted">
            {t("production.today.expansionLabel")}{" "}
            <span className="font-semibold text-text">{today.expansion.batch_count}</span>{" "}
            {t("production.today.batchesUnit")} ·{" "}
            <span className="font-semibold text-text">{today.expansion.total_kg.toFixed(1)}</span>{" "}
            {t("production.today.kgUnit")}
          </span>
          {today.expansion.silos.map((s) => (
            <span
              key={`e-${String(s.silo)}`}
              className="px-2 py-0.5 rounded-full bg-[var(--ghost-bg)] text-muted"
            >
              {t("production.today.silo")} {s.silo ?? "—"}: {s.batch_count} {t("production.today.batchUnit")}
            </span>
          ))}
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
                  {t("production.common.retry")}
                </button>
              </div>
            </div>
          )}

          {!error && (
            <div className="p-4 space-y-4">
              {/* Operator bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border border-border rounded px-4 py-3 bg-[var(--surface-2)]">
                <span className="text-sm text-text">
                  {t("production.session.loggingAs")} <span className="font-semibold">{userName}</span>
                </span>
                <button
                  type="button"
                  onClick={switchUser}
                  className="min-h-[44px] px-4 rounded border border-border bg-[var(--ghost-bg)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  {t("production.session.switchUser")}
                </button>
              </div>

              {/* Session bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border border-border rounded px-4 py-3">
                {selectedSession ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                      <span className="font-semibold text-text">
                        {t(board === "molding" ? "production.board.molding" : "production.board.expansion")} —{" "}
                        {selectedSession.log_date}
                      </span>
                      {board === "molding" ? (
                        <span className="px-2 py-0.5 rounded-full bg-[var(--ghost-bg)] text-text font-semibold text-xs">
                          {selectedMoldingSession?.block_type || "—"}
                        </span>
                      ) : (
                        <span className="text-muted">
                          {selectedExpansionSession?.bead_supplier || "—"} {selectedExpansionSession?.bead_type || ""}
                        </span>
                      )}
                      <span
                        className={[
                          "px-2 py-0.5 rounded-full text-xs font-semibold",
                          isEditable
                            ? "bg-[var(--success-bg)] text-[var(--success-text)]"
                            : "bg-[var(--ghost-bg)] text-muted",
                        ].join(" ")}
                      >
                        {t(isEditable ? "production.session.open" : "production.session.closed")}
                      </span>
                    </div>
                    {board === "molding" && (
                      <p className="text-xs text-muted">{t("production.session.blockTypeHint")}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted">{t("production.session.empty")}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {sessionsForBoard.length > 0 && (
                    <select
                      aria-label={t("production.session.selectSheetAria")}
                      value={selectedId ?? ""}
                      onChange={(e) => selectSheet(e.target.value)}
                      className="min-h-[44px] px-3 rounded border border-border bg-bg text-text text-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      {board === "molding"
                        ? moldingSessions.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.log_date} · {s.block_type || "—"} · {s.block_count} ·{" "}
                              {t(s.status === "open" ? "production.session.open" : "production.session.closed")}
                            </option>
                          ))
                        : expansionSessions.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.log_date} · {s.bead_supplier || "—"} {s.bead_type || ""} ·{" "}
                              {t(s.status === "open" ? "production.session.open" : "production.session.closed")}
                            </option>
                          ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() => setNewSheetOpen(true)}
                    className="min-h-[44px] px-4 rounded border border-border bg-[var(--ghost-bg)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    {t("production.session.newSheet")}
                  </button>
                  {selectedSession && isEditable && (
                    <button
                      type="button"
                      disabled={acting}
                      onClick={closeSheet}
                      className="min-h-[44px] px-4 rounded border border-border text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      {t("production.session.closeSheet")}
                    </button>
                  )}
                  {selectedSession && !isEditable && (
                    <button
                      type="button"
                      disabled={acting}
                      onClick={reopenSheet}
                      className="min-h-[44px] px-4 rounded border border-border text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      {t("production.session.reopen")}
                    </button>
                  )}
                  {selectedSession && (canManage || isAdmin) && (
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => setDeleteSheetOpen(true)}
                      className="min-h-[44px] px-4 rounded border border-[var(--danger-bg)] text-[var(--danger-bg)] text-sm font-semibold cursor-pointer hover:bg-[var(--danger-bg)]/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      {t("production.session.deleteSheet")}
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
                        {board === "expansion" && <th className={HEAD}>{t("production.grid.rowIndex")}</th>}
                        {fields.map((f) => (
                          <th key={f.key} className={HEAD}>
                            {t(f.labelKey)}
                          </th>
                        ))}
                        {isEditable && <th className={HEAD}>{t("production.grid.actions")}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, idx) => (
                        <tr key={row.id} className="border-b border-border">
                          {board === "expansion" && <td className={CELL}>{idx + 1}</td>}
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
                                  aria-label={t("production.grid.editAria")}
                                  className="w-11 h-11 flex items-center justify-center rounded text-muted hover:text-text hover:bg-[var(--ghost-bg)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                                >
                                  <Pencil size={16} aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openDelete(row)}
                                  aria-label={t("production.grid.deleteAria")}
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
                          {board === "expansion" && <td className="px-2 py-1.5" />}
                          {appendFields.map((f, i) => {
                            const isLast = i === appendFields.length - 1;
                            let control: React.ReactNode;

                            if (f.auto === "time") {
                              control = (
                                <span className="inline-flex min-h-[40px] items-center px-2 text-sm text-muted">
                                  {t("production.field.autoChip")}
                                </span>
                              );
                            } else if (f.input === "select") {
                              const opts = optionValues[f.optionsKey ?? ""] ?? [];
                              control = (
                                <select
                                  ref={(el) => {
                                    inputRefs.current[f.key] = el;
                                  }}
                                  className={INPUT + " cursor-pointer"}
                                  value={appendRow[f.key]}
                                  onChange={(e) => {
                                    if (e.target.value === ADD_NEW) {
                                      handleAddOptionRequest("block_size");
                                      return;
                                    }
                                    setAppendRow((r) => ({ ...r, [f.key]: e.target.value }));
                                  }}
                                >
                                  <option value="">{t("production.newSheet.selectPlaceholder")}</option>
                                  {opts.map((v) => (
                                    <option key={v} value={v}>
                                      {v}
                                    </option>
                                  ))}
                                  {canManage && <option value={ADD_NEW}>{t("production.options.addNew")}</option>}
                                </select>
                              );
                            } else {
                              control = (
                                <input
                                  ref={(el) => {
                                    inputRefs.current[f.key] = el;
                                  }}
                                  type={f.input}
                                  step={f.input === "number" ? "any" : undefined}
                                  placeholder={f.placeholder}
                                  className={INPUT}
                                  value={appendRow[f.key]}
                                  onChange={(e) => setAppendRow((r) => ({ ...r, [f.key]: e.target.value }))}
                                  onKeyDown={(e) => {
                                    if (isLast && e.key === "Enter" && !acting) submitAppendRow();
                                  }}
                                />
                              );
                            }

                            return (
                              <td key={f.key} className="px-2 py-1.5">
                                {isLast ? (
                                  <div className="flex gap-1">
                                    {control}
                                    <button
                                      type="button"
                                      disabled={acting}
                                      onClick={submitAppendRow}
                                      className="shrink-0 min-h-[40px] px-3 rounded bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                                    >
                                      {t("production.grid.add")}
                                    </button>
                                  </div>
                                ) : (
                                  control
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
                      {t("production.grid.closedHint")}
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
        options={options}
        canManage={canManage}
        onRequestAddOption={handleAddOptionRequest}
        injectedValue={injectedOption}
        onInjectedApplied={() => setInjectedOption(null)}
      />

      <EditRowModal
        isOpen={editingRow !== null}
        onClose={() => setEditingRow(null)}
        title={editingRow?.label ?? ""}
        size={board === "molding" ? "lg" : "md"}
        fields={fields}
        optionValues={optionValues}
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

      <DeleteSheetModal
        isOpen={deleteSheetOpen}
        sheetLabel={
          selectedSession
            ? board === "molding"
              ? `${selectedSession.log_date} · ${selectedMoldingSession?.block_type ?? "—"}`
              : `${selectedSession.log_date} · ${selectedExpansionSession?.bead_supplier ?? "—"} ${
                  selectedExpansionSession?.bead_type ?? ""
                }`
            : undefined
        }
        isAdmin={isAdmin}
        acting={acting}
        onHide={() => deleteSheet(false)}
        onPurge={() => deleteSheet(true)}
        onCancel={() => setDeleteSheetOpen(false)}
      />

      <AddOptionModal
        isOpen={addOptionRequest !== null}
        onClose={() => setAddOptionRequest(null)}
        kind={addOptionRequest?.kind ?? "block_type"}
        supplier={addOptionRequest?.supplier}
        onAdded={handleOptionAdded}
      />
    </div>
  );
}
