"use client";
// History tab (prod-c-03) — everyone with production.log. Filters (sheet log_date range, supplier,
// bead type, density, block type [blocks only], lot #) drive GET /v2/api/production/history; a
// segmented switch shows Blocks or Batches. Any lot # opens the lot trace. Block weight is always
// "Demold weight" (cut green, includes moisture — never a product density). Bead aging is display
// only (no target, no good/bad colouring).
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/components/lang";
import {
  BUCKET_VOLUME_L,
  EXPANSION_RECIPE_FIELDS,
  MOLDING_RECIPE_FIELDS,
  isRecipeDeviation,
  pcfFromBucket,
} from "@/lib/productionRecipes";
import { agingHours, filtersToQuery, type HistoryData, type HistoryFilters } from "@/lib/productionHistory";
import type { OptionsData } from "./fields";
import RecipeDeviationBadge from "./RecipeDeviationBadge";
import LotTraceModal from "./LotTraceModal";
import { BTN_GHOST, type DescribeError } from "./ui";

type HistoryMode = "blocks" | "batches";
const HISTORY_MODES: HistoryMode[] = ["blocks", "batches"];

interface Props {
  options: OptionsData;
  describeError: DescribeError;
}

const CELL = "px-2 py-1.5 text-sm text-text whitespace-nowrap";
const NUM = CELL + " font-mono tabular-nums";
const HEAD = "px-2 py-1.5 text-xs font-semibold text-muted text-left whitespace-nowrap";
const CONTROL =
  "w-full min-h-[44px] px-3 rounded border border-border bg-bg text-text text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const LABEL = "block text-xs font-semibold text-muted mb-1";
const LOT_BTN =
  "min-h-[44px] px-2 -mx-2 font-mono tabular-nums font-semibold text-text underline underline-offset-2 cursor-pointer hover:text-[var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded";

function etDate(daysAgo: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date(Date.now() - daysAgo * 86400000)
  );
}

const defaultFilters = (): HistoryFilters => ({
  from: etDate(29),
  to: etDate(0),
  supplier: "",
  bead_type: "",
  density: "",
  block_type: "",
  lot: "",
});

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

export default function HistoryView({ options, describeError }: Props) {
  const { t } = useLang();
  const [filters, setFilters] = useState<HistoryFilters>(defaultFilters);
  const [lotInput, setLotInput] = useState("");
  const [mode, setMode] = useState<HistoryMode>("blocks");
  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [traceLot, setTraceLot] = useState<string | null>(null);
  const reqId = useRef(0);

  const set = (k: keyof HistoryFilters, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  // Lot text input is debounced 400 ms; everything else refetches immediately.
  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => (f.lot === lotInput.trim() ? f : { ...f, lot: lotInput.trim() })), 400);
    return () => clearTimeout(id);
  }, [lotInput]);

  const fetchHistory = useCallback(async () => {
    const my = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/production/history?${filtersToQuery(filters)}`);
      const d = await res.json();
      if (my !== reqId.current) return;
      if (d.ok) setData(d);
      else setError(describeError(d.error, "production.history.loadFailed"));
    } catch {
      if (my === reqId.current) setError(t("production.error.networkError"));
    } finally {
      if (my === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  function clearFilters() {
    setFilters(defaultFilters());
    setLotInput("");
  }

  const typesForSupplier = filters.supplier ? options.bead_types[filters.supplier] ?? [] : [];

  function withBadge(value: unknown, recipeValue: unknown, suffix = "") {
    return (
      <span className="inline-flex items-center gap-1">
        {show(value)}
        {value !== null && value !== undefined && suffix}
        {isRecipeDeviation(value, recipeValue) && <RecipeDeviationBadge recipeValue={recipeValue as number} />}
      </span>
    );
  }

  const lotButton = (lot: string | null) =>
    lot ? (
      <button type="button" className={LOT_BTN} onClick={() => setTraceLot(lot)} aria-label={`${t("production.history.traceAria")} ${lot}`}>
        {lot}
      </button>
    ) : (
      "—"
    );

  const blockTotalLbs = data ? data.blocks.reduce((s, b) => s + (b.block_weight_lbs ?? 0), 0) : 0;
  const batchTotalKg = data ? data.batches.reduce((s, b) => s + (b.weight_kg ?? 0), 0) : 0;

  return (
    <div className="p-4 space-y-3">
      {/* Filter bar: stacked on a phone, one row on md+ */}
      <div className="grid grid-cols-2 md:grid-cols-[repeat(7,minmax(0,1fr))_auto] gap-2 items-end border border-border rounded p-3 bg-[var(--surface-2)]">
        <label className="block">
          <span className={LABEL}>{t("production.history.from")}</span>
          <input type="date" className={CONTROL + " font-mono tabular-nums"} value={filters.from} onChange={(e) => set("from", e.target.value)} />
        </label>
        <label className="block">
          <span className={LABEL}>{t("production.history.to")}</span>
          <input type="date" className={CONTROL + " font-mono tabular-nums"} value={filters.to} onChange={(e) => set("to", e.target.value)} />
        </label>
        <label className="block">
          <span className={LABEL}>{t("production.newSheet.supplier")}</span>
          <select
            className={CONTROL + " cursor-pointer"}
            value={filters.supplier}
            onChange={(e) => setFilters((f) => ({ ...f, supplier: e.target.value, bead_type: "" }))}
          >
            <option value="">{t("production.bead.allSuppliers")}</option>
            {options.suppliers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>{t("production.newSheet.beadType")}</span>
          <select
            className={CONTROL + " cursor-pointer disabled:opacity-50"}
            disabled={!filters.supplier}
            value={filters.bead_type}
            onChange={(e) => set("bead_type", e.target.value)}
          >
            <option value="">{t("production.bead.allTypes")}</option>
            {typesForSupplier.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>{t("production.recipe.density")}</span>
          <select className={CONTROL + " cursor-pointer"} value={filters.density} onChange={(e) => set("density", e.target.value)}>
            <option value="">{t("production.history.allDensities")}</option>
            {(data?.facets.densities ?? []).map((d) => (
              <option key={d} value={String(d)}>
                {d} {t("production.unit.pcf")}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>
            {t("production.newSheet.blockType")} <span className="font-normal">({t("production.history.blocksOnly")})</span>
          </span>
          <select className={CONTROL + " cursor-pointer"} value={filters.block_type} onChange={(e) => set("block_type", e.target.value)}>
            <option value="">{t("production.history.allBlockTypes")}</option>
            {(data?.facets.block_types ?? []).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>{t("production.field.lotNo")}</span>
          <input className={CONTROL + " font-mono tabular-nums"} value={lotInput} onChange={(e) => setLotInput(e.target.value)} />
        </label>
        <button type="button" onClick={clearFilters} className={BTN_GHOST}>
          {t("production.history.clear")}
        </button>
      </div>

      {/* Mode switch */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label={t("production.history.modeAria")}>
          {HISTORY_MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={[
                "min-h-[44px] px-5 rounded text-sm font-semibold cursor-pointer",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                mode === m ? "bg-[var(--brand)] text-white" : "bg-[var(--ghost-bg)] text-muted hover:text-text",
              ].join(" ")}
            >
              {t(`production.history.mode.${m}`)}
            </button>
          ))}
        </div>
        {loading && data && (
          <span role="status" className="text-xs text-muted">
            {t("production.history.loading")}
          </span>
        )}
      </div>

      {error && (
        <div className="border border-border rounded px-3 py-3 space-y-1.5">
          <p role="alert" className="text-sm text-[var(--danger-bg)] font-medium">
            {error}
          </p>
          <button
            type="button"
            onClick={fetchHistory}
            className="text-xs text-muted underline underline-offset-2 cursor-pointer hover:text-text"
          >
            {t("production.common.retry")}
          </button>
        </div>
      )}

      {!data ? (
        !error && (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 border border-border rounded animate-pulse motion-reduce:animate-none bg-[var(--ghost-bg)]" />
            ))}
          </div>
        )
      ) : (
        <div className={loading ? "opacity-70 transition-opacity motion-reduce:transition-none" : undefined}>
          {/* prod-c-04: report mount */}
          {mode === "blocks" && (
            <>
              {data.truncated.blocks && (
                <p className="mb-2 text-xs text-[var(--warn-text)]">{t("production.history.truncated")}</p>
              )}
              {data.blocks.length === 0 ? (
                <p className="border border-border rounded px-4 py-6 text-sm text-muted">{t("production.history.emptyBlocks")}</p>
              ) : (
                <div className="overflow-x-auto border border-border rounded">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-[var(--surface-2)]">
                        <th className={HEAD}>{t("production.history.col.date")}</th>
                        <th className={HEAD}>{t("production.field.blockNo")}</th>
                        <th className={HEAD}>{t("production.newSheet.blockType")}</th>
                        <th className={HEAD}>{t("production.field.blockSize")}</th>
                        <th className={HEAD}>{t("production.field.silo")}</th>
                        <th className={HEAD}>{t("production.field.lotNo")}</th>
                        <th className={HEAD}>{t("production.history.col.supplierType")}</th>
                        <th className={HEAD}>{t("production.history.col.densityPcf")}</th>
                        <th className={HEAD}>{t("production.history.col.rc")}</th>
                        <th className={HEAD}>{t("production.history.col.virgin")}</th>
                        <th className={HEAD + " text-right"}>{t("production.history.col.demoldLbs")}</th>
                        <th className={HEAD + " text-right"}>{t("production.history.col.agingH")}</th>
                        <th className={HEAD}>{t("production.field.operator")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.blocks.map((b) => {
                        const aging = agingHours(b.created_at, b.silo_full_at);
                        return (
                          <tr key={b.id} className="border-b border-border">
                            <td className={NUM}>{b.log_date}</td>
                            <td className={NUM + " font-semibold"}>{show(b.block_no)}</td>
                            <td className={CELL}>{show(b.block_type)}</td>
                            <td className={CELL}>{show(b.block_size)}</td>
                            <td className={NUM}>{show(b.silo)}</td>
                            <td className={CELL}>{lotButton(b.lot_no)}</td>
                            <td className={CELL}>
                              {b.bead_supplier || b.bead_type ? `${show(b.bead_supplier)} · ${show(b.bead_type)}` : "—"}
                            </td>
                            <td className={NUM}>{show(b.density)}</td>
                            <td className={NUM}>
                              {withBadge(b.rc_pct_open, b[MOLDING_RECIPE_FIELDS.rc_pct_open], "%")} /{" "}
                              {withBadge(b.rc_speed, b[MOLDING_RECIPE_FIELDS.rc_speed])}
                            </td>
                            <td className={NUM}>
                              {withBadge(b.virgin_pct_open, b[MOLDING_RECIPE_FIELDS.virgin_pct_open], "%")} /{" "}
                              {withBadge(b.virgin_speed, b[MOLDING_RECIPE_FIELDS.virgin_speed])}
                            </td>
                            <td className={NUM + " text-right"}>{show(b.block_weight_lbs)}</td>
                            <td className={NUM + " text-right"}>{aging === null ? "—" : aging.toFixed(1)}</td>
                            <td className={CELL}>{show(b.operator_name)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-[var(--surface-2)]">
                        <td className={CELL + " font-semibold"} colSpan={10}>
                          {t("production.history.total")}: <span className="font-mono tabular-nums">{data.blocks.length}</span>{" "}
                          {t("production.today.blocksUnit")}
                        </td>
                        <td className={NUM + " text-right font-semibold"}>{blockTotalLbs.toFixed(1)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </>
          )}
          {mode === "batches" && (
            <>
              {data.truncated.batches && (
                <p className="mb-2 text-xs text-[var(--warn-text)]">{t("production.history.truncated")}</p>
              )}
              {data.batches.length === 0 ? (
                <p className="border border-border rounded px-4 py-6 text-sm text-muted">{t("production.history.emptyBatches")}</p>
              ) : (
                <div className="overflow-x-auto border border-border rounded">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-[var(--surface-2)]">
                        <th className={HEAD}>{t("production.history.col.date")}</th>
                        <th className={HEAD}>{t("production.history.col.supplierType")}</th>
                        <th className={HEAD}>{t("production.history.col.densityPcf")}</th>
                        <th className={HEAD}>{t("production.history.col.recipe")}</th>
                        <th className={HEAD}>{t("production.field.lotNo")}</th>
                        <th className={HEAD}>{t("production.field.silo")}</th>
                        <th className={HEAD + " text-right"}>{t("production.field.weightKg")}</th>
                        <th className={HEAD}>{t("production.field.heatingTimeS")}</th>
                        <th className={HEAD + " text-right"}>{t("production.field.bucketWeightG")}</th>
                        <th className={HEAD + " text-right"}>{t("production.unit.pcf")}</th>
                        <th className={HEAD}>{t("production.field.operator")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.batches.map((b) => {
                        const pcf = pcfFromBucket(b.bucket_weight_g, b.bucket_volume_l ?? BUCKET_VOLUME_L);
                        return (
                          <tr key={b.id} className="border-b border-border">
                            <td className={NUM}>{b.log_date}</td>
                            <td className={CELL}>
                              {show(b.bead_supplier)} · {show(b.bead_type)}
                            </td>
                            <td className={NUM}>{show(b.density)}</td>
                            <td className={NUM}>{b.recipe_version ? `v${b.recipe_version}` : "—"}</td>
                            <td className={CELL}>{lotButton(b.lot_no)}</td>
                            <td className={NUM}>{show(b.silo)}</td>
                            <td className={NUM + " text-right"}>{show(b.weight_kg)}</td>
                            <td className={NUM}>
                              {withBadge(b.heating_time_s, b[EXPANSION_RECIPE_FIELDS.heating_time_s])}
                            </td>
                            <td className={NUM + " text-right"}>{show(b.bucket_weight_g)}</td>
                            <td className={NUM + " text-right"}>{pcf === null ? "—" : pcf.toFixed(2)}</td>
                            <td className={CELL}>{show(b.operator_name)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-[var(--surface-2)]">
                        <td className={CELL + " font-semibold"} colSpan={6}>
                          {t("production.history.total")}: <span className="font-mono tabular-nums">{data.batches.length}</span>{" "}
                          {t("production.today.batchesUnit")}
                        </td>
                        <td className={NUM + " text-right font-semibold"}>{batchTotalKg.toFixed(1)}</td>
                        <td colSpan={4} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <LotTraceModal lotNo={traceLot} onClose={() => setTraceLot(null)} describeError={describeError} />
    </div>
  );
}
