"use client";
// Production schedule editor (prod-d-03) — managers only (/v2/production/schedule is gated
// production.manage). 7-day view: days stack on phones, grid on wide screens. Past days are
// read-only; today … today+14 are editable (the server enforces this too). Each day has Molding and
// Expansion lists with DERIVED progress (done / qty, "+N filling" today) — there is no check-off.
// Line order (up / down) is the order the production TV shows.
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Pencil, Trash2 } from "lucide-react";
import Modal from "@/components/Modal";
import LangSelect from "@/components/LangSelect";
import { useLang } from "@/components/lang";
import type { RecipeRow } from "@/lib/productionRecipes";
import {
  EDIT_WINDOW_DAYS,
  addDays,
  type ScheduleKind,
  type ScheduleLine,
  type ScheduleLineWithProgress,
} from "@/lib/productionSchedule";
import type { OptionsData } from "../fields";
import { BTN_GHOST, BTN_PRIMARY, FormError } from "../ui";
import ScheduleLineModal, { lineLabel } from "./ScheduleLineModal";

const EMPTY_OPTIONS: OptionsData = { block_types: [], block_sizes: [], suppliers: [], bead_types: {} };
const REFRESH_MS = 60_000;

const ERROR_KEY: Record<string, string> = {
  schedule_exists: "production.error.scheduleExists",
  schedule_not_found: "production.error.scheduleNotFound",
  schedule_changed: "production.error.scheduleChanged",
  invalid_plan_date: "production.error.invalidPlanDate",
  date_out_of_range: "production.error.dateOutOfRange",
  qty_invalid: "production.error.qtyInvalid",
  density_required: "production.error.densityRequired",
  invalid_kind: "production.error.invalidKind",
  key_immutable: "production.error.keyImmutable",
  unknown_block_type: "production.error.unknownBlockType",
  unknown_bead_type: "production.error.unknownBeadType",
  manage_required: "production.error.manageRequired",
  range_too_large: "production.error.rangeTooLarge",
  invalid_param: "production.error.invalidParam",
  Unauthorized: "production.error.unauthorized",
  "Access denied.": "production.error.forbidden",
};

const ICON_BTN =
  "w-11 h-11 flex items-center justify-center rounded text-muted hover:text-text hover:bg-[var(--ghost-bg)] cursor-pointer disabled:opacity-30 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const SMALL_BTN =
  "min-h-[44px] px-3 rounded border border-border text-sm font-semibold text-text cursor-pointer hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] inline-flex items-center gap-1.5";

type ModalState = { mode: "create" | "edit"; kind: ScheduleKind; planDate: string; line?: ScheduleLine } | null;

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

export default function ScheduleEditor() {
  const { t } = useLang();
  const [today, setToday] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [lines, setLines] = useState<ScheduleLineWithProgress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<OptionsData>(EMPTY_OPTIONS);
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [modal, setModal] = useState<ModalState>(null);
  const [deleting, setDeleting] = useState<ScheduleLine | null>(null);
  const [deleteActing, setDeleteActing] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  function errorMessage(code: string | undefined, fallbackKey: string): string {
    if (code && ERROR_KEY[code]) return t(ERROR_KEY[code]);
    return t(fallbackKey);
  }

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  const fetchSchedule = useCallback(async () => {
    try {
      const q = weekStart ? `?from=${weekStart}&to=${addDays(weekStart, 6)}` : "";
      const res = await fetch(`/v2/api/production/schedule${q}`);
      const data = await res.json();
      if (data.ok) {
        setToday(data.today);
        if (!weekStart) setWeekStart(data.from);
        setLines(data.lines);
        setError(null);
      } else {
        setError(errorMessage(data.error, "production.schedule.loadFailed"));
      }
    } catch {
      setError(t("production.error.networkError"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  useEffect(() => {
    fetchSchedule();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchSchedule();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchSchedule]);

  useEffect(() => {
    fetch("/v2/api/production/options")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setOptions({
            block_types: d.block_types ?? [],
            block_sizes: d.block_sizes ?? [],
            suppliers: d.suppliers ?? [],
            bead_types: d.bead_types ?? {},
          });
        }
      })
      .catch(() => {});
    fetch("/v2/api/production/recipes")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setRecipes(d.recipes ?? []);
      })
      .catch(() => {});
  }, []);

  const editable = (date: string) => !!today && date >= today && date <= addDays(today, EDIT_WINDOW_DAYS);

  async function move(date: string, kind: ScheduleKind, list: ScheduleLine[], idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    const ids = list.map((l) => l.id);
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    setBusy(true);
    try {
      const res = await fetch("/v2/api/production/manage/schedule/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_date: date, kind, ids }),
      });
      const data = await res.json();
      if (!data.ok) showToast(errorMessage(data.error, "production.schedule.saveFailed"), false);
    } catch {
      showToast(t("production.toast.networkError"), false);
    } finally {
      setBusy(false);
      fetchSchedule();
    }
  }

  async function copyPrev(date: string) {
    setBusy(true);
    try {
      const res = await fetch("/v2/api/production/manage/schedule/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_date: addDays(date, -1), to_date: date }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(t("production.schedule.copied").replace("{n}", String(data.copied)).replace("{m}", String(data.skipped)));
      } else {
        showToast(errorMessage(data.error, "production.schedule.saveFailed"), false);
      }
    } catch {
      showToast(t("production.toast.networkError"), false);
    } finally {
      setBusy(false);
      fetchSchedule();
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteActing(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/v2/api/production/manage/schedule/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setDeleting(null);
        showToast(t("production.schedule.deleted"));
        fetchSchedule();
      } else {
        setDeleteError(errorMessage(data.error, "production.schedule.saveFailed"));
      }
    } catch {
      setDeleteError(t("production.toast.networkError"));
    } finally {
      setDeleteActing(false);
    }
  }

  function progress(l: ScheduleLineWithProgress) {
    if (!today || l.plan_date > today) return null;
    const met = l.done >= l.qty;
    return (
      <span className="text-xs text-muted">
        <span className={["font-mono tabular-nums", met ? "text-[var(--success-bg)] font-semibold" : "text-text"].join(" ")}>
          {l.done} / {l.qty}
        </span>
        {l.kind === "expansion" && l.plan_date === today && l.in_progress > 0 && (
          <span className="ml-1">
            · {t("production.schedule.filling").replace("{n}", String(l.in_progress))}
          </span>
        )}
      </span>
    );
  }

  function kindList(date: string, kind: ScheduleKind, dayLines: ScheduleLineWithProgress[]) {
    const list = dayLines.filter((l) => l.kind === kind);
    const canEdit = editable(date);
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t(kind === "molding" ? "production.schedule.molding" : "production.schedule.expansion")}
          </h3>
          {canEdit && (
            <button type="button" className={SMALL_BTN} onClick={() => setModal({ mode: "create", kind, planDate: date })}>
              {t(kind === "molding" ? "production.schedule.addMolding" : "production.schedule.addExpansion")}
            </button>
          )}
        </div>
        {list.length === 0 ? (
          <p className="text-xs text-[var(--text-hint)] py-1">{t("production.schedule.nothing")}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] border border-border rounded">
            {list.map((l, i) => (
              <li key={l.id} className="flex items-center gap-1 px-2 py-1">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text font-semibold truncate">
                    {lineLabel(l)} <span className="font-mono tabular-nums text-muted font-normal">× {l.qty}</span>
                  </p>
                  {progress(l)}
                  {l.note && <p className="text-xs text-muted truncate">{l.note}</p>}
                </div>
                {canEdit && (
                  <div className="flex shrink-0">
                    <button type="button" className={ICON_BTN} disabled={busy || i === 0} aria-label={t("production.schedule.moveUp")} onClick={() => move(date, kind, list, i, -1)}>
                      <ChevronUp size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className={ICON_BTN} disabled={busy || i === list.length - 1} aria-label={t("production.schedule.moveDown")} onClick={() => move(date, kind, list, i, 1)}>
                      <ChevronDown size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className={ICON_BTN} aria-label={t("production.schedule.edit")} onClick={() => setModal({ mode: "edit", kind, planDate: date, line: l })}>
                      <Pencil size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={ICON_BTN + " hover:text-[var(--danger-bg)]"}
                      aria-label={t("production.schedule.delete")}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(l);
                      }}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const days = weekStart ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : [];

  return (
    <div className="flex-1 overflow-y-auto">
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={[
            "fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded text-sm font-medium pointer-events-none",
            toast.ok ? "bg-[var(--success-bg)] text-[var(--success-text)]" : "bg-[var(--danger-bg)] text-[var(--danger-text)]",
          ].join(" ")}
        >
          {toast.msg}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 p-2 border-b border-border bg-surface">
        <div className="flex flex-wrap items-center gap-2">
          <a href="/v2/production" className={BTN_GHOST + " inline-flex items-center"}>
            {t("production.schedule.backToLog")}
          </a>
          <h1 className="text-base font-semibold text-text px-2">{t("production.schedule.pageTitle")}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN_GHOST} disabled={!weekStart} onClick={() => weekStart && setWeekStart(addDays(weekStart, -7))}>
            {t("production.schedule.prevWeek")}
          </button>
          <button type="button" className={BTN_GHOST} disabled={!today} onClick={() => today && setWeekStart(today)}>
            {t("production.schedule.thisWeek")}
          </button>
          <button type="button" className={BTN_GHOST} disabled={!weekStart} onClick={() => weekStart && setWeekStart(addDays(weekStart, 7))}>
            {t("production.schedule.nextWeek")}
          </button>
          <LangSelect />
        </div>
      </div>

      {error && (
        <div className="m-4 border border-border rounded px-3 py-3 space-y-1.5">
          <p role="alert" className="text-sm text-[var(--danger-bg)] font-medium">
            {error}
          </p>
          <button type="button" onClick={fetchSchedule} className="text-xs text-muted underline underline-offset-2 cursor-pointer hover:text-text">
            {t("production.common.retry")}
          </button>
        </div>
      )}

      {lines === null && !error ? (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-48 border border-border rounded animate-pulse motion-reduce:animate-none bg-[var(--ghost-bg)]" />
          ))}
        </div>
      ) : lines ? (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7 gap-3">
          {days.map((date) => {
            const dayLines = lines.filter((l) => l.plan_date === date);
            const isToday = date === today;
            const past = !!today && date < today;
            return (
              <section
                key={date}
                className={[
                  "border rounded p-3 space-y-3 bg-surface",
                  isToday ? "border-[var(--brand)]" : "border-border",
                  past ? "opacity-80" : "",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-text">
                      {t(`production.schedule.day.${weekday(date)}`)}
                      {isToday && (
                        <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-[var(--brand)] text-white">
                          {t("production.schedule.today")}
                        </span>
                      )}
                    </h2>
                    <p className="text-xs text-muted font-mono tabular-nums">{date}</p>
                    {past && <p className="text-xs text-muted">{t("production.schedule.readOnlyPast")}</p>}
                  </div>
                  {editable(date) && (
                    <button type="button" className={SMALL_BTN} disabled={busy} onClick={() => copyPrev(date)}>
                      <Copy size={14} aria-hidden="true" />
                      {t("production.schedule.copyPrev")}
                    </button>
                  )}
                </div>
                {kindList(date, "molding", dayLines)}
                {kindList(date, "expansion", dayLines)}
              </section>
            );
          })}
        </div>
      ) : null}

      <ScheduleLineModal
        isOpen={modal !== null}
        onClose={() => setModal(null)}
        mode={modal?.mode ?? "create"}
        kind={modal?.kind ?? "molding"}
        planDate={modal?.planDate ?? ""}
        line={modal?.line ?? null}
        options={options}
        recipes={recipes}
        onSaved={() => {
          setModal(null);
          showToast(t("production.schedule.saved"));
          fetchSchedule();
        }}
        errorMessage={errorMessage}
      />

      <Modal isOpen={deleting !== null} onClose={() => setDeleting(null)} title={t("production.schedule.deleteTitle")}>
        {deleting && (
          <>
            <p className="text-sm text-text font-semibold">
              {lineLabel(deleting)} × <span className="font-mono tabular-nums">{deleting.qty}</span>{" "}
              <span className="text-muted font-normal font-mono tabular-nums">({deleting.plan_date})</span>
            </p>
            <p className="text-sm text-muted">{t("production.schedule.deleteConfirm")}</p>
            <FormError message={deleteError} />
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={() => setDeleting(null)} className={BTN_GHOST}>
                {t("production.schedule.cancel")}
              </button>
              <button type="button" disabled={deleteActing} onClick={confirmDelete} className={BTN_PRIMARY}>
                {t(deleteActing ? "production.schedule.deleting" : "production.schedule.delete")}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
