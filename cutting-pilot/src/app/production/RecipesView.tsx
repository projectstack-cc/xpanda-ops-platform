"use client";
// Recipes tab (prod-c-02) — managers only (ProductionBoard hides the tab otherwise). Two sections:
// Expansion recipes (supplier · bead type · density → heating time) and Molding recipes (block
// type → RC / Virgin % open + speed). Edit = new immutable version; Retire = deactivate. "Show
// history" fetches every version and lists retired ones under their current card.
import { useCallback, useEffect, useState } from "react";
import { History, Pencil, Plus, Archive } from "lucide-react";
import { useLang } from "@/components/lang";
import { BUCKET_VOLUME_L, targetGramsFromPcf, type RecipeRow } from "@/lib/productionRecipes";
import type { OptionsData } from "./fields";
import RecipeModal, { type RecipeKind } from "./RecipeModal";
import RetireRecipeModal from "./RetireRecipeModal";
import { BTN_GHOST, type DescribeError } from "./ui";

interface Props {
  recipes: RecipeRow[];
  options: OptionsData;
  onChanged: () => void;
  onToast: (msg: string, ok?: boolean) => void;
  describeError: DescribeError;
}

const ICON_BTN =
  "min-h-[44px] px-3 inline-flex items-center gap-1.5 rounded border border-border text-sm font-semibold text-text cursor-pointer hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const NUM = "font-mono tabular-nums";

type ModalState = { mode: "create" | "version"; kind: RecipeKind; recipe?: RecipeRow } | null;

function recipeLabel(r: RecipeRow): string {
  return r.kind === "expansion" ? `${r.bead_supplier} · ${r.bead_type} · ${r.density?.toFixed(2)} pcf` : `${r.block_type}`;
}

export default function RecipesView({ recipes, options, onChanged, onToast, describeError }: Props) {
  const { t } = useLang();
  const [modal, setModal] = useState<ModalState>(null);
  const [retiring, setRetiring] = useState<RecipeRow | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<RecipeRow[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      const res = await fetch("/v2/api/production/recipes?include_retired=1");
      const data = await res.json();
      if (data.ok) setHistory(data.recipes);
      else setHistoryError(describeError(data.error, "production.recipe.loadFailed"));
    } catch {
      setHistoryError(t("production.error.networkError"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (showHistory) fetchHistory();
  }, [showHistory, recipes, fetchHistory]);

  // Retired versions grouped by recipe_key, newest first. Includes fully retired recipes (no
  // active version) so their history is still reachable.
  const retiredByKey = new Map<string, RecipeRow[]>();
  for (const r of history ?? []) {
    if (r.active) continue;
    const list = retiredByKey.get(r.recipe_key) ?? [];
    list.push(r);
    retiredByKey.set(r.recipe_key, list);
  }
  retiredByKey.forEach((list) => list.sort((a, b) => b.version - a.version));
  const activeKeys = new Set(recipes.map((r) => r.recipe_key));

  function saved(msgKey: string) {
    setModal(null);
    setRetiring(null);
    onToast(t(msgKey));
    onChanged();
  }

  function retiredList(key: string) {
    const list = retiredByKey.get(key);
    if (!showHistory || !list?.length) return null;
    return (
      <ul className="mt-2 border-t border-border pt-2 space-y-1">
        {list.map((r) => (
          <li key={r.id} className="text-xs text-muted">
            <span className={NUM}>v{r.version}</span> · {valuesText(r)} · {t("production.recipe.created")}{" "}
            <span className={NUM}>{r.created_at}</span> · {t("production.recipe.retired")}{" "}
            <span className={NUM}>{r.retired_at ?? "—"}</span>
            {r.notes ? <> · {r.notes}</> : null}
          </li>
        ))}
      </ul>
    );
  }

  function valuesText(r: RecipeRow): string {
    return r.kind === "expansion"
      ? `${r.heating_time_s ?? "—"} s`
      : `RC ${r.rc_pct_open ?? "—"}% / ${r.rc_speed ?? "—"} · Virgin ${r.virgin_pct_open ?? "—"}% / ${r.virgin_speed ?? "—"}`;
  }

  function card(r: RecipeRow) {
    const targetG = targetGramsFromPcf(r.density, BUCKET_VOLUME_L);
    return (
      <li key={r.id} className="border border-border rounded px-4 py-3 bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-semibold text-text">
              {r.kind === "expansion" ? (
                <>
                  {r.bead_supplier} · {r.bead_type} ·{" "}
                  <span className={NUM}>
                    {r.density?.toFixed(2)} {t("production.unit.pcf")}
                  </span>
                </>
              ) : (
                r.block_type
              )}
              <span className="ml-2 px-2 py-0.5 rounded-full bg-[var(--ghost-bg)] text-muted text-xs font-normal">
                {t("production.recipe.version")} <span className={NUM}>{r.version}</span>
              </span>
            </p>
            {r.kind === "expansion" ? (
              <p className="text-sm text-muted">
                {t("production.recipe.targetG")}:{" "}
                <span className={NUM + " text-text"}>{targetG === null ? "—" : `${targetG.toFixed(1)} g`}</span> ·{" "}
                {t("production.recipe.heatingTime")}: <span className={NUM + " text-text"}>{r.heating_time_s} s</span>
              </p>
            ) : (
              <p className="text-sm text-muted">
                RC <span className={NUM + " text-text"}>{r.rc_pct_open}%</span> /{" "}
                <span className={NUM + " text-text"}>{r.rc_speed}</span> · Virgin{" "}
                <span className={NUM + " text-text"}>{r.virgin_pct_open}%</span> /{" "}
                <span className={NUM + " text-text"}>{r.virgin_speed}</span>
              </p>
            )}
            {r.notes && <p className="text-xs text-muted">{r.notes}</p>}
          </div>
          <div className="flex gap-2 shrink-0">
            <button type="button" className={ICON_BTN} onClick={() => setModal({ mode: "version", kind: r.kind, recipe: r })}>
              <Pencil size={14} aria-hidden="true" />
              {t("production.recipe.edit")}
            </button>
            <button type="button" className={ICON_BTN} onClick={() => setRetiring(r)}>
              <Archive size={14} aria-hidden="true" />
              {t("production.recipe.retire")}
            </button>
          </div>
        </div>
        {retiredList(r.recipe_key)}
      </li>
    );
  }

  function section(kind: RecipeKind) {
    const list = recipes.filter((r) => r.kind === kind);
    // Fully retired recipes (history only): newest retired version stands in for the card.
    const retiredOnly = showHistory
      ? Array.from(retiredByKey.entries())
          .filter(([key, rows]) => !activeKeys.has(key) && rows[0].kind === kind)
          .map(([, rows]) => rows[0])
      : [];
    return (
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-text">
            {t(kind === "expansion" ? "production.recipe.expansionHeading" : "production.recipe.moldingHeading")}
          </h2>
          <button type="button" className={ICON_BTN} onClick={() => setModal({ mode: "create", kind })}>
            <Plus size={14} aria-hidden="true" />
            {t("production.recipe.newRecipe")}
          </button>
        </div>
        {list.length === 0 ? (
          <div className="border border-border rounded px-4 py-6 space-y-1">
            <p className="text-sm text-text">
              {t(kind === "expansion" ? "production.recipe.emptyExpansion" : "production.recipe.emptyMolding")}
            </p>
            <p className="text-xs text-muted">{t("production.recipe.emptyHint")}</p>
          </div>
        ) : (
          <ul className="space-y-2">{list.map(card)}</ul>
        )}
        {retiredOnly.length > 0 && (
          <ul className="space-y-2 opacity-70">
            {retiredOnly.map((r) => (
              <li key={r.id} className="border border-dashed border-border rounded px-4 py-3">
                <p className="text-sm text-muted">
                  {recipeLabel(r)} · {t("production.recipe.retired")}
                </p>
                {retiredList(r.recipe_key)}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="p-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{t("production.recipe.intro")}</p>
        <button
          type="button"
          aria-pressed={showHistory}
          className={BTN_GHOST + " inline-flex items-center gap-1.5"}
          onClick={() => setShowHistory((v) => !v)}
        >
          <History size={14} aria-hidden="true" />
          {t(showHistory ? "production.recipe.hideHistory" : "production.recipe.showHistory")}
        </button>
      </div>
      {historyError && showHistory && (
        <p role="alert" className="text-sm text-[var(--danger-bg)]">
          {historyError}
        </p>
      )}

      {section("expansion")}
      {section("molding")}

      <RecipeModal
        isOpen={modal !== null}
        onClose={() => setModal(null)}
        mode={modal?.mode ?? "create"}
        kind={modal?.kind ?? "expansion"}
        recipe={modal?.recipe}
        options={options}
        onSaved={(stale) => (stale ? onChanged() : saved("production.recipe.saved"))}
        describeError={describeError}
      />
      <RetireRecipeModal
        recipe={retiring}
        label={retiring ? recipeLabel(retiring) : ""}
        onClose={() => setRetiring(null)}
        onSaved={() => saved("production.recipe.retiredToast")}
        describeError={describeError}
      />
    </div>
  );
}
