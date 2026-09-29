"use client";
// Today's-schedule strip on the Production Log (prod-d-03). Read-only view of today's lines for the
// current board kind with DERIVED progress, plus a Start button per line that opens the New-sheet
// modal with that line's key prefilled — prefill only, never blocking (same rule as recipes).
// Self-contained: fetches the schedule itself, refetches when `refreshKey` changes, polls every
// 60 s while visible. Non-critical: a failed fetch just hides the strip (like the made-today strip).
import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useLang } from "@/components/lang";
import type { ScheduleKind, ScheduleLineWithProgress } from "@/lib/productionSchedule";
import type { SheetPrefill } from "./NewSheetModal";

interface Props {
  kind: ScheduleKind;
  refreshKey: unknown;
  onStart: (prefill: SheetPrefill) => void;
}

const POLL_MS = 60_000;

export default function TodaySchedule({ kind, refreshKey, onStart }: Props) {
  const { t } = useLang();
  const [lines, setLines] = useState<ScheduleLineWithProgress[]>([]);

  const fetchToday = useCallback(async () => {
    try {
      const res = await fetch("/v2/api/production/schedule");
      const data = await res.json();
      if (data.ok) setLines((data.lines as ScheduleLineWithProgress[]).filter((l) => l.plan_date === data.today));
      else setLines([]);
    } catch {
      setLines([]);
    }
  }, []);

  useEffect(() => {
    fetchToday();
  }, [fetchToday, refreshKey]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchToday();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [fetchToday]);

  const list = lines.filter((l) => l.kind === kind);
  if (!list.length) return null;

  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border bg-surface overflow-x-auto">
      <span className="shrink-0 text-xs font-semibold text-text">{t("production.schedule.todayHeading")}</span>
      {list.map((l) => {
        const met = l.done >= l.qty;
        const label =
          l.kind === "molding"
            ? l.block_type ?? "—"
            : `${l.bead_supplier ?? "—"} ${l.bead_type ?? ""} · ${l.density === null ? "—" : l.density.toFixed(2)} ${t("production.unit.pcf")}`;
        return (
          <div key={l.id} className="shrink-0 flex items-center gap-2 border border-border rounded pl-3 pr-1 py-1 bg-bg">
            {l.running && (
              <span
                className="w-2 h-2 rounded-full bg-[var(--success-bg)]"
                title={t("production.schedule.running")}
                aria-label={t("production.schedule.running")}
              />
            )}
            <span className="text-sm text-text font-semibold whitespace-nowrap">{label}</span>
            <span className={["text-sm font-mono tabular-nums whitespace-nowrap", met ? "text-[var(--success-bg)] font-semibold" : "text-muted"].join(" ")}>
              {l.done} / {l.qty}
            </span>
            {met && <Check size={16} className="text-[var(--success-bg)]" aria-hidden="true" />}
            {l.kind === "expansion" && l.in_progress > 0 && (
              <span className="text-xs text-muted whitespace-nowrap">
                +{t("production.schedule.filling").replace("{n}", String(l.in_progress))}
              </span>
            )}
            <button
              type="button"
              onClick={() =>
                onStart(
                  l.kind === "molding"
                    ? { block_type: l.block_type ?? undefined }
                    : {
                        bead_supplier: l.bead_supplier ?? undefined,
                        bead_type: l.bead_type ?? undefined,
                        density: l.density === null ? undefined : l.density.toFixed(2),
                      }
                )
              }
              className="min-h-[44px] px-3 rounded bg-[var(--ghost-bg)] border border-border text-text text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {t("production.schedule.start")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
