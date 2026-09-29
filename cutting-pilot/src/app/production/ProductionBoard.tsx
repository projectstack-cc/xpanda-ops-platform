"use client";
// Segmented Molding | Expansion board mirroring the physical XPanda Foam paper log: a session
// header opened once per sheet, then an inline append-row grid for repeated block/batch entry.
// Fully decoupled from jobs — no job_id anywhere in this surface.
//
// prod-a-03 (Group A): lot # replaces control #, silo/lot/operator now live per row, molding
// sheets carry one block type, block #/time/operator auto-fill, managed dropdowns with manager
// "+ Add new…", sheet delete (soft/purge), and full en/es/ht via the new LangSelect.
//
// prod-b-03 (Group B): Silos + Bead views, silo picker + switch prompts on the append row, received
// lot select + "+1 bag" on Expansion, read-only server-stamped lot on Molding, manager-only
// silo/lot row edits. Codes against prod-b-02's API contract.
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
import SiloPickerModal from "./SiloPickerModal";
import SiloSwitchModal from "./SiloSwitchModal";
import SilosView from "./SilosView";
import BeadView from "./BeadView";
import RecipesView from "./RecipesView";
import HistoryView from "./HistoryView";
import RecipeDeviationBadge from "./RecipeDeviationBadge";
import { BUCKET_VOLUME_L, EXPANSION_RECIPE_FIELDS, MOLDING_RECIPE_FIELDS, isRecipeDeviation, pcfFromBucket, type RecipeRow } from "@/lib/productionRecipes";
import BagCounter from "./BagCounter";
import ReceiveLotModal from "./ReceiveLotModal";
import type { DescribeError } from "./ui";
import type { BeadLotRow, SiloRow } from "@/lib/productionSilos";
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

type BoardKind = "molding" | "expansion" | "silos" | "bead" | "history" | "recipes";
type SheetKind = "molding" | "expansion";

const BOARD_LABEL_KEY: Record<BoardKind, string> = {
  molding: "production.board.molding",
  expansion: "production.board.expansion",
  silos: "production.board.silos",
  bead: "production.board.bead",
  recipes: "production.board.recipes",
  history: "production.board.history",
};

interface MoldingSession {
  id: string;
  log_date: string;
  block_type: string | null;
  recipe_id?: string | null;
  recipe_version?: number | null;
  recipe_rc_pct_open?: number | null;
  recipe_rc_speed?: number | null;
  recipe_virgin_pct_open?: number | null;
  recipe_virgin_speed?: number | null;
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
  recipe_id?: string | null;
  recipe_version?: number | null;
  recipe_density?: number | null;
  recipe_heating_time_s?: number | null;
  bucket_volume_l?: number | null;
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
  silo_required: "production.error.siloRequired",
  lot_required: "production.error.lotRequired",
  lot_unknown: "production.error.lotUnknown",
  lot_sheet_mismatch: "production.error.lotSheetMismatch",
  silo_lot_mismatch: "production.error.siloLotMismatch",
  silo_not_fillable: "production.error.siloNotFillable",
  silo_not_moldable: "production.error.siloNotMoldable",
  silo_inactive: "production.error.siloInactive",
  silo_state_changed: "production.error.siloStateChanged",
  bad_transition: "production.error.badTransition",
  note_required: "production.error.noteRequired",
  nothing_to_undo: "production.error.nothingToUndo",
  manage_required: "production.error.manageRequired",
  silo_invalid: "production.error.siloInvalid",
  unknown_supplier: "production.error.unknownSupplier",
  bags_invalid: "production.error.bagsInvalid",
  label_invalid: "production.error.labelInvalid",
  lot_no_required: "production.error.lotNoRequired",
  lot_conflict: "production.error.lotConflict",
  lot_immutable_field: "production.error.lotImmutableField",
  // prod-c-02 recipe codes (unknown_bead_type / unknown_block_type are mapped above).
  recipe_exists: "production.error.recipeExists",
  recipe_changed: "production.error.recipeChanged",
  recipe_not_found: "production.error.recipeNotFound",
  key_immutable: "production.error.keyImmutable",
  invalid_kind: "production.error.invalidKind",
  density_required: "production.error.densityRequired",
  heating_time_required: "production.error.heatingTimeRequired",
  invalid_param: "production.error.invalidParam",
  range_too_large: "production.error.rangeTooLarge",
};

// Errors that mean our silos list is stale — refetch it automatically.
const SILO_REFETCH_ERRORS = new Set(["silo_state_changed", "silo_lot_mismatch", "silo_not_moldable"]);

const RECEIVE_NEW = "__receive_new__";

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
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [addOptionRequest, setAddOptionRequest] = useState<{ kind: OptionKind; supplier?: string } | null>(null);
  const [injectedOption, setInjectedOption] = useState<{ field: "block_type" | "bead_type"; value: string } | null>(
    null
  );
  const inputRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({});
  const [silos, setSilos] = useState<SiloRow[] | null>(null);
  const [silosError, setSilosError] = useState<string | null>(null);
  const [lots, setLots] = useState<BeadLotRow[]>([]);
  const [editLots, setEditLots] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<{ prev: SiloRow; next: SiloRow } | null>(null);
  const [switchActing, setSwitchActing] = useState(false);
  const [receiveFromRowOpen, setReceiveFromRowOpen] = useState(false);

  const isSheetBoard = board === "molding" || board === "expansion";
  const sheetKind: SheetKind = board === "molding" ? "molding" : "expansion";
  const sessionsForBoard = board === "molding" ? moldingSessions : expansionSessions;
  const selectedId = board === "molding" ? selectedMoldingId : selectedExpansionId;
  const selectedMoldingSession = moldingSessions.find((s) => s.id === selectedMoldingId) ?? null;
  const selectedExpansionSession = expansionSessions.find((s) => s.id === selectedExpansionId) ?? null;
  const selectedSession = board === "molding" ? selectedMoldingSession : selectedExpansionSession;
  const isEditable = selectedSession?.status === "open";
  const fields = fieldsFor(sheetKind);
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
  const describeError: DescribeError = errorMessage;

  const fetchSilos = useCallback(async () => {
    try {
      const res = await fetch("/v2/api/production/silos");
      const data = await res.json();
      if (data.ok) {
        setSilos(data.silos);
        setSilosError(null);
      } else {
        setSilosError(errorMessage(data.error, "production.silo.loadFailed"));
      }
    } catch {
      setSilosError(t("production.error.networkError"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function replaceSilo(s: SiloRow | undefined | null) {
    if (!s) return;
    setSilos((cur) => (cur ? cur.map((x) => (x.silo_no === s.silo_no ? s : x)) : cur));
  }

  const fetchLots = useCallback(
    async (session: { id: string; bead_supplier: string | null; bead_type: string | null }) => {
      const q = new URLSearchParams({
        supplier: session.bead_supplier ?? "",
        bead_type: session.bead_type ?? "",
        session_id: session.id,
      });
      try {
        const res = await fetch(`/v2/api/production/bead-lots?${q.toString()}`);
        const data = await res.json();
        if (data.ok) setLots(data.lots);
        else showToast(errorMessage(data.error, "production.bead.loadFailed"), false);
      } catch {
        showToast(t("production.toast.networkError"), false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function replaceLot(l: BeadLotRow) {
    setLots((cur) => cur.map((x) => (x.id === l.id ? { ...x, ...l } : x)));
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

  const fetchRows = useCallback(async (kind: SheetKind, sessionId: string, seedCarry = false) => {
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

  // Recipes are optional (prefill + session-bar summary + Recipes tab); a failed fetch keeps the
  // prior list silently.
  const fetchRecipes = useCallback(async () => {
    try {
      const res = await fetch("/v2/api/production/recipes");
      const data = await res.json();
      if (data.ok) setRecipes(data.recipes ?? []);
    } catch {
      // keep the prior list
    }
  }, []);

  useEffect(() => {
    fetchRecipes();
  }, [fetchRecipes]);

  // Silos: on mount / board switch, then every 30 s while a sheet board or the Silos view is up.
  useEffect(() => {
    if (board === "bead" || board === "recipes" || board === "history") return;
    fetchSilos();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchSilos();
    }, 30_000);
    return () => clearInterval(id);
  }, [board, fetchSilos]);

  // Lots for the selected Expansion sheet (its supplier + bead type, with this sheet's bag count).
  const expSessionKey = selectedExpansionSession
    ? `${selectedExpansionSession.id}|${selectedExpansionSession.bead_supplier}|${selectedExpansionSession.bead_type}`
    : "";
  useEffect(() => {
    if (board !== "expansion" || !selectedExpansionSession) {
      setLots([]);
      return;
    }
    fetchLots(selectedExpansionSession);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, expSessionKey, fetchLots]);

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
    } else if (board === "expansion") {
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

  // prod-c-02: a molding sheet with a recipe and no rows yet starts its append row from the recipe
  // setpoints; after the first block, carry-down takes over. Never overwrites a non-blank value.
  useEffect(() => {
    const s = selectedMoldingSession;
    if (board !== "molding" || !s?.recipe_id || blocks.length !== 0) return;
    const keys = Object.keys(MOLDING_RECIPE_FIELDS) as (keyof typeof MOLDING_RECIPE_FIELDS)[];
    setBlockRow((r) => {
      if (keys.some((k) => (r[k] ?? "") !== "")) return r;
      const next = { ...r };
      for (const k of keys) {
        const v = s[MOLDING_RECIPE_FIELDS[k]];
        if (v !== null && v !== undefined) next[k] = String(v);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, blocks, selectedMoldingSession?.id, selectedMoldingSession?.recipe_id]);

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
      // lot_no is stamped server-side from the silo — never sent.
      const { lot_no: _ignoredLot, ...rowBody } = blockRow;
      const res = await fetch("/v2/api/production/molding/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: selectedMoldingId, ...rowBody }),
      });
      const data = await res.json();
      if (data.ok) {
        setBlockRow((r) => ({ ...carryRow(MOLDING_FIELDS, r), lot_no: data.lot_no ?? "" }));
        replaceSilo(data.silo);
        await Promise.all([fetchRows("molding", selectedMoldingId), fetchToday(), fetchSilos()]);
        inputRefs.current["block_weight_lbs"]?.focus();
      } else {
        showToast(errorMessage(data.error, "production.toast.saveBlockFailed"), false);
        if (SILO_REFETCH_ERRORS.has(data.error)) fetchSilos();
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
        replaceSilo(data.silo);
        await Promise.all([fetchRows("expansion", selectedExpansionId), fetchToday(), fetchSilos()]);
        inputRefs.current["weight_kg"]?.focus();
      } else {
        showToast(errorMessage(data.error, "production.toast.saveBatchFailed"), false);
        if (SILO_REFETCH_ERRORS.has(data.error)) fetchSilos();
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
    setEditLots([]);
    if (canManage || isAdmin) {
      // Managers may correct lot_no: Expansion = lots of the sheet's supplier; Molding = all lots.
      const q = new URLSearchParams({ include_inactive: "1" });
      if (board === "expansion" && selectedExpansionSession?.bead_supplier) {
        q.set("supplier", selectedExpansionSession.bead_supplier);
      }
      fetch(`/v2/api/production/bead-lots?${q.toString()}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.ok) setEditLots(Array.from(new Set((d.lots as BeadLotRow[]).map((l) => l.lot_no))));
        })
        .catch(() => setEditLots([]));
    }
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
        if (selectedId) await Promise.all([fetchRows(sheetKind, selectedId), fetchToday(), fetchSilos()]);
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
        if (selectedId) await Promise.all([fetchRows(sheetKind, selectedId), fetchToday(), fetchSilos()]);
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

  const appendRow = board === "molding" ? blockRow : batchRow;
  const setAppendRow = board === "molding" ? setBlockRow : setBatchRow;

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

  // Picking a different silo than the one carried in the append row first asks whether the
  // carried silo is full (Expansion, silo filling) / empty (Molding, silo in use). Cancel aborts.
  function handlePickSilo(next: SiloRow) {
    setPickerOpen(false);
    const prevNo = Number(appendRow.silo) || null;
    if (prevNo && prevNo !== next.silo_no) {
      const prev = silos?.find((x) => x.silo_no === prevNo);
      const ask = prev && (sheetKind === "expansion" ? prev.state === "filling" : prev.state === "in_use");
      if (prev && ask) {
        setPendingSwitch({ prev, next });
        return;
      }
    }
    setAppendRow((r) => ({ ...r, silo: String(next.silo_no) }));
  }

  async function answerSwitch(yes: boolean) {
    if (!pendingSwitch) return;
    const { prev, next } = pendingSwitch;
    if (yes) {
      setSwitchActing(true);
      try {
        const res = await fetch(`/v2/api/production/silos/${prev.silo_no}/state`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: sheetKind === "expansion" ? "full" : "empty" }),
        });
        const data = await res.json();
        if (data.ok) {
          replaceSilo(data.silo);
        } else {
          // Someone else may already have reported it — tell the operator, refresh, carry on.
          showToast(errorMessage(data.error, "production.silo.stateFailed"), false);
          fetchSilos();
        }
      } catch {
        showToast(t("production.toast.networkError"), false);
        fetchSilos();
      } finally {
        setSwitchActing(false);
      }
    }
    setPendingSwitch(null);
    setAppendRow((r) => ({ ...r, silo: String(next.silo_no) }));
  }

  function displayValue(f: RowFieldDef, row: Record<string, any>): string {
    const v = row[f.key];
    return v === null || v === undefined || v === "" ? "—" : String(v);
  }

  // prod-c-02: saved-row cell = displayValue + a "≠" badge when the value differs from the sheet's
  // recipe snapshot (exact, both non-null), and a muted pcf line under the expansion bucket weight.
  function renderCell(f: RowFieldDef, row: Record<string, any>): React.ReactNode {
    const text = displayValue(f, row);
    if (board === "expansion" && f.key === "bucket_weight_g") {
      const pcf = pcfFromBucket(row.bucket_weight_g, selectedExpansionSession?.bucket_volume_l ?? BUCKET_VOLUME_L);
      return (
        <span className="inline-flex flex-col leading-tight font-mono tabular-nums">
          <span>{text === "—" ? text : `${text} g`}</span>
          {pcf !== null && (
            <span className="text-xs text-muted">
              {pcf.toFixed(2)} {t("production.unit.pcf")}
            </span>
          )}
        </span>
      );
    }
    const map: Record<string, string> = board === "molding" ? MOLDING_RECIPE_FIELDS : EXPANSION_RECIPE_FIELDS;
    const recipeCol = map[f.key];
    const recipeValue = recipeCol ? (selectedSession as Record<string, any> | null)?.[recipeCol] : undefined;
    if (recipeCol && isRecipeDeviation(row[f.key], recipeValue)) {
      return (
        <span className="inline-flex items-center gap-1">
          {text}
          <RecipeDeviationBadge recipeValue={recipeValue} />
        </span>
      );
    }
    return text;
  }

  const rows: (MoldingBlock | ExpansionBatch)[] = board === "molding" ? blocks : batches;
  const submitAppendRow = board === "molding" ? submitBlockRow : submitBatchRow;
  const carriedSilo = silos?.find((x) => x.silo_no === Number(appendRow.silo)) ?? null;
  const selectedLot = board === "expansion" ? lots.find((l) => l.lot_no === batchRow.lot_no) ?? null : null;

  // Board tabs. prod-c-02: Recipes (managers only). prod-c-03 adds History.
  const boardKinds: BoardKind[] = [
    "molding",
    "expansion",
    "silos",
    "bead",
    "history",
    ...(canManage || isAdmin ? (["recipes"] as BoardKind[]) : []),
  ];

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
      <div className="shrink-0 flex items-center justify-between gap-2 p-2 border-b border-border bg-surface no-print">
        <div className="flex flex-wrap gap-1">
          {boardKinds.map((k) => (
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
              {t(BOARD_LABEL_KEY[k])}
            </button>
          ))}
        </div>
        <LangSelect />
      </div>

      {/* Made-today strip */}
      {today && isSheetBoard && (
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

      {board === "silos" ? (
        <div className="flex-1 overflow-y-auto">
          <SilosView
            silos={silos}
            error={silosError}
            canCorrect={canManage || isAdmin}
            onRetry={fetchSilos}
            onCorrected={(x) => {
              replaceSilo(x);
              showToast(t("production.silo.corrected"));
              fetchSilos();
            }}
            describeError={describeError}
          />
        </div>
      ) : board === "history" ? (
        <div className="flex-1 overflow-y-auto">
          <HistoryView options={options} describeError={describeError} />
        </div>
      ) : board === "recipes" ? (
        <div className="flex-1 overflow-y-auto">
          <RecipesView recipes={recipes} options={options} onChanged={fetchRecipes} onToast={showToast} describeError={describeError} />
        </div>
      ) : board === "bead" ? (
        <div className="flex-1 overflow-y-auto">
          <BeadView canManage={canManage || isAdmin} options={options} onToast={showToast} describeError={describeError} />
        </div>
      ) : loading ? (
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
                    {/* prod-c-02: recipe snapshot summary. Expansion heating time is shown, never prefilled. */}
                    {board === "molding" ? (
                      <p className="text-xs text-muted">
                        {selectedMoldingSession?.recipe_id ? (
                          <>
                            {t("production.recipe.recipeV")}
                            <span className="font-mono tabular-nums">{selectedMoldingSession.recipe_version}</span>: RC{" "}
                            <span className="font-mono tabular-nums">
                              {selectedMoldingSession.recipe_rc_pct_open ?? "—"}% / {selectedMoldingSession.recipe_rc_speed ?? "—"}
                            </span>{" "}
                            · Virgin{" "}
                            <span className="font-mono tabular-nums">
                              {selectedMoldingSession.recipe_virgin_pct_open ?? "—"}% /{" "}
                              {selectedMoldingSession.recipe_virgin_speed ?? "—"}
                            </span>
                          </>
                        ) : (
                          t("production.recipe.noRecipe")
                        )}
                      </p>
                    ) : (
                      <p className="text-xs text-muted">
                        {t("production.recipe.density")}{" "}
                        <span className="font-mono tabular-nums">
                          {selectedExpansionSession?.density ?? "—"} {t("production.unit.pcf")}
                        </span>{" "}
                        · {t("production.recipe.target")}{" "}
                        <span className="font-mono tabular-nums">{selectedExpansionSession?.target_weight_g ?? "—"} g</span> ·{" "}
                        {selectedExpansionSession?.recipe_id ? (
                          <>
                            {t("production.recipe.recipeV")}
                            <span className="font-mono tabular-nums">{selectedExpansionSession.recipe_version}</span>,{" "}
                            {t("production.recipe.heating")}{" "}
                            <span className="font-mono tabular-nums">{selectedExpansionSession.recipe_heating_time_s ?? "—"} s</span>
                          </>
                        ) : (
                          t("production.recipe.noRecipe")
                        )}
                      </p>
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

              {/* +1 bag (Expansion, open sheet, lot picked) */}
              {board === "expansion" && isEditable && selectedExpansionSession && selectedLot && (
                <BagCounter
                  lot={selectedLot}
                  sessionId={selectedExpansionSession.id}
                  onLotUpdated={replaceLot}
                  onError={(msg) => showToast(msg, false)}
                  describeError={describeError}
                />
              )}

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
                              {renderCell(f, row)}
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
                            } else if (f.auto === "lot") {
                              // Molding: the server stamps the lot from the silo — show it, never send it.
                              control = (
                                <span
                                  className="inline-flex min-h-[40px] items-center px-2 text-sm font-mono tabular-nums text-text"
                                  title={t("production.silo.lotFromSilo")}
                                >
                                  {carriedSilo?.lot_no ?? "—"}
                                </span>
                              );
                            } else if (f.input === "silo") {
                              control = (
                                <button
                                  type="button"
                                  onClick={() => setPickerOpen(true)}
                                  className={INPUT + " cursor-pointer text-left font-semibold whitespace-nowrap hover:bg-[var(--ghost-bg)]"}
                                >
                                  {appendRow.silo
                                    ? `${t("production.field.silo")} ${appendRow.silo}`
                                    : t("production.silo.pick")}
                                </button>
                              );
                            } else if (f.input === "lot") {
                              const known = lots.some((l) => l.lot_no === appendRow.lot_no);
                              control = (
                                <select
                                  ref={(el) => {
                                    inputRefs.current[f.key] = el;
                                  }}
                                  className={INPUT + " cursor-pointer min-w-[10rem]"}
                                  value={appendRow.lot_no}
                                  onChange={(e) => {
                                    if (e.target.value === RECEIVE_NEW) {
                                      setReceiveFromRowOpen(true);
                                      return;
                                    }
                                    setAppendRow((r) => ({ ...r, lot_no: e.target.value }));
                                  }}
                                >
                                  <option value="">{t("production.newSheet.selectPlaceholder")}</option>
                                  {lots.map((l) => (
                                    <option
                                      key={l.id}
                                      value={l.lot_no}
                                      className={l.on_hand < 0 ? "text-[var(--danger-bg)]" : undefined}
                                    >
                                      {l.lot_no} · {l.on_hand} {t("production.bead.bagsUnit")}
                                    </option>
                                  ))}
                                  {appendRow.lot_no && !known && (
                                    <option value={appendRow.lot_no}>
                                      {appendRow.lot_no} · {t("production.bead.notReceived")}
                                    </option>
                                  )}
                                  {(canManage || isAdmin) && (
                                    <option value={RECEIVE_NEW}>{t("production.bead.receiveNewOption")}</option>
                                  )}
                                </select>
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
        recipes={recipes}
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
        canManage={canManage || isAdmin}
        lots={editLots}
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

      <SiloPickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        mode={sheetKind}
        silos={silos}
        rowLotId={selectedLot?.id ?? null}
        selectedNo={Number(appendRow.silo) || null}
        onPick={handlePickSilo}
      />

      <SiloSwitchModal
        isOpen={pendingSwitch !== null}
        variant={sheetKind}
        siloLabel={pendingSwitch?.prev.label ?? ""}
        acting={switchActing}
        onYes={() => answerSwitch(true)}
        onNo={() => answerSwitch(false)}
        onCancel={() => setPendingSwitch(null)}
      />

      <ReceiveLotModal
        isOpen={receiveFromRowOpen}
        onClose={() => setReceiveFromRowOpen(false)}
        options={options}
        prefill={{
          supplier: selectedExpansionSession?.bead_supplier,
          beadType: selectedExpansionSession?.bead_type,
        }}
        onReceived={(lot, created) => {
          setReceiveFromRowOpen(false);
          showToast(t(created ? "production.bead.receivedCreated" : "production.bead.receivedExisting"));
          if (selectedExpansionSession) fetchLots(selectedExpansionSession);
          setBatchRow((r) => ({ ...r, lot_no: lot.lot_no }));
        }}
        describeError={describeError}
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
