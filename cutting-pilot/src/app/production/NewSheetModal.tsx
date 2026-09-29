"use client";
// Create-session form for both boards. One component, variant prop — composes the shared
// Modal primitive rather than a hand-rolled overlay. Molding: single required Block type.
// Expansion: Supplier -> Bead type (filtered to that supplier), density, target weight, times.
// No silo, control #, or operators here — those moved onto the row (prod-a-02).
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useLang } from "@/components/lang";
import type { OptionsData } from "./fields";
import type { OptionKind } from "./AddOptionModal";
import { BUCKET_VOLUME_L, normDensity, targetGramsFromPcf, type RecipeRow } from "@/lib/productionRecipes";

export type SheetVariant = "molding" | "expansion";

// prod-d-03: a schedule line's key, used to prefill a new sheet (prefill only, never blocking).
export type SheetPrefill = { block_type?: string; bead_supplier?: string; bead_type?: string; density?: string };

const ADD_NEW = "__add_new__";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  variant: SheetVariant;
  onSubmit: (fields: Record<string, string>) => void;
  acting: boolean;
  options: OptionsData;
  canManage: boolean;
  onRequestAddOption: (kind: OptionKind, supplier?: string) => void;
  injectedValue: { field: "block_type" | "bead_type"; value: string } | null;
  recipes: RecipeRow[];
  onInjectedApplied: () => void;
  prefill?: SheetPrefill | null;
}

const FIELD_CLASS =
  "w-full min-h-[44px] px-3 rounded border border-border bg-bg text-text text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const LABEL_CLASS = "block text-xs font-semibold text-muted mb-1";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{label}</span>
      {children}
    </label>
  );
}

export default function NewSheetModal({
  isOpen,
  onClose,
  variant,
  onSubmit,
  acting,
  options,
  canManage,
  onRequestAddOption,
  injectedValue,
  onInjectedApplied,
  recipes,
  prefill,
}: Props) {
  const { t } = useLang();
  const [fields, setFields] = useState<Record<string, string>>({});
  // prod-c-02: typing a density auto-fills target g until the user edits target g by hand.
  const [targetTouched, setTargetTouched] = useState(false);

  useEffect(() => {
    if (!injectedValue) return;
    setFields((f) => ({ ...f, [injectedValue.field]: injectedValue.value }));
    onInjectedApplied();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedValue]);

  function set(key: string, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  // prod-d-03: opening with a schedule-line prefill seeds the key fields. A prefilled density also
  // derives target g exactly as typing it would; targetTouched stays false so the operator can
  // still type over it.
  useEffect(() => {
    if (!isOpen || !prefill) return;
    setFields((cur) => {
      const next = { ...cur };
      for (const [k, v] of Object.entries(prefill)) if (v) next[k] = v;
      if (prefill.density) next.target_weight_g = derivedTarget(prefill.density);
      return next;
    });
    setTargetTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, prefill]);

  function handleClose() {
    setFields({});
    setTargetTouched(false);
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(fields);
  }

  const beadTypeOptions = fields.bead_supplier ? options.bead_types[fields.bead_supplier] ?? [] : [];

  // prod-c-02: recipes prefill, never block.
  const derivedTarget = (d: string) => {
    const g = targetGramsFromPcf(normDensity(d), BUCKET_VOLUME_L);
    return g === null ? "" : g.toFixed(1);
  };
  const moldingRecipe =
    variant === "molding" && fields.block_type
      ? recipes.find((r) => r.kind === "molding" && r.active && r.block_type === fields.block_type) ?? null
      : null;
  const expansionRecipes =
    variant === "expansion" && fields.bead_supplier && fields.bead_type
      ? recipes
          .filter(
            (r) =>
              r.kind === "expansion" &&
              r.active &&
              r.bead_supplier === fields.bead_supplier &&
              r.bead_type === fields.bead_type &&
              r.density !== null
          )
          .sort((a, b) => (a.density ?? 0) - (b.density ?? 0))
      : [];
  const typedDensity = normDensity(fields.density);
  const noDensityMatch =
    !!fields.bead_supplier &&
    !!fields.bead_type &&
    typedDensity !== null &&
    !expansionRecipes.some((r) => r.density === typedDensity);
  const canSubmit =
    variant === "molding" ? !!fields.block_type : !!fields.bead_supplier && !!fields.bead_type;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={variant === "molding" ? t("production.newSheet.titleMolding") : t("production.newSheet.titleExpansion")}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        {variant === "molding" ? (
          <Field label={t("production.newSheet.blockType")}>
            <select
              required
              className={FIELD_CLASS + " cursor-pointer"}
              value={fields.block_type ?? ""}
              onChange={(e) => {
                if (e.target.value === ADD_NEW) {
                  onRequestAddOption("block_type");
                  return;
                }
                set("block_type", e.target.value);
              }}
            >
              <option value="">{t("production.newSheet.selectPlaceholder")}</option>
              {options.block_types.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
              {canManage && <option value={ADD_NEW}>{t("production.options.addNew")}</option>}
            </select>
            {options.block_types.length === 0 && !canManage && (
              <p className="mt-1 text-xs text-muted">{t("production.options.emptyHint")}</p>
            )}
            {fields.block_type && (
              <p className="mt-1 text-xs text-muted">
                {moldingRecipe ? (
                  <>
                    {t("production.recipe.recipeV")}
                    <span className="font-mono tabular-nums">{moldingRecipe.version}</span>: RC{" "}
                    <span className="font-mono tabular-nums">
                      {moldingRecipe.rc_pct_open}% / {moldingRecipe.rc_speed}
                    </span>{" "}
                    · Virgin{" "}
                    <span className="font-mono tabular-nums">
                      {moldingRecipe.virgin_pct_open}% / {moldingRecipe.virgin_speed}
                    </span>
                  </>
                ) : (
                  t("production.recipe.noRecipeBlockType")
                )}
              </p>
            )}
          </Field>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("production.newSheet.supplier")}>
                <select
                  required
                  className={FIELD_CLASS + " cursor-pointer"}
                  value={fields.bead_supplier ?? ""}
                  onChange={(e) => setFields((f) => ({ ...f, bead_supplier: e.target.value, bead_type: "" }))}
                >
                  <option value="">{t("production.newSheet.selectPlaceholder")}</option>
                  {options.suppliers.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("production.newSheet.beadType")}>
                <select
                  required
                  disabled={!fields.bead_supplier}
                  className={FIELD_CLASS + " cursor-pointer disabled:opacity-50"}
                  value={fields.bead_type ?? ""}
                  onChange={(e) => {
                    if (e.target.value === ADD_NEW) {
                      onRequestAddOption("bead_type", fields.bead_supplier);
                      return;
                    }
                    set("bead_type", e.target.value);
                  }}
                >
                  <option value="">{t("production.newSheet.selectPlaceholder")}</option>
                  {beadTypeOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                  {canManage && fields.bead_supplier && (
                    <option value={ADD_NEW}>{t("production.options.addNew")}</option>
                  )}
                </select>
                {beadTypeOptions.length === 0 && !canManage && fields.bead_supplier && (
                  <p className="mt-1 text-xs text-muted">{t("production.options.emptyHint")}</p>
                )}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("production.newSheet.startTime")}>
                <input
                  type="text"
                  placeholder="9:30 AM"
                  className={FIELD_CLASS}
                  value={fields.start_time ?? ""}
                  onChange={(e) => set("start_time", e.target.value)}
                />
              </Field>
              <Field label={t("production.newSheet.finishTime")}>
                <input
                  type="text"
                  placeholder="11:00 AM"
                  className={FIELD_CLASS}
                  value={fields.finish_time ?? ""}
                  onChange={(e) => set("finish_time", e.target.value)}
                />
              </Field>
            </div>
            {expansionRecipes.length > 0 && (
              <div>
                <span className={LABEL_CLASS}>{t("production.recipe.chipsLabel")}</span>
                <div className="flex flex-wrap gap-2">
                  {expansionRecipes.map((r) => {
                    const d = (r.density ?? 0).toFixed(2);
                    const g = targetGramsFromPcf(r.density, BUCKET_VOLUME_L);
                    const selected = typedDensity === r.density;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setFields((f) => ({ ...f, density: d, target_weight_g: g === null ? "" : g.toFixed(1) }));
                          setTargetTouched(false);
                        }}
                        className={[
                          "min-h-[44px] px-3 rounded border text-sm font-mono tabular-nums cursor-pointer",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                          selected
                            ? "border-[var(--brand)] bg-[var(--ghost-bg)] text-text font-semibold"
                            : "border-border bg-bg text-text hover:bg-[var(--ghost-bg)]",
                        ].join(" ")}
                      >
                        {d} {t("production.unit.pcf")} · {g === null ? "—" : g.toFixed(1)} g
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("production.newSheet.density")}>
                <input
                  type="number"
                  step="any"
                  className={FIELD_CLASS}
                  value={fields.density ?? ""}
                  onChange={(e) => {
                    const d = e.target.value;
                    setFields((f) => ({ ...f, density: d, ...(targetTouched ? {} : { target_weight_g: derivedTarget(d) }) }));
                  }}
                />
                {noDensityMatch && (
                  <p className="mt-1 text-xs text-muted">{t("production.recipe.noRecipeDensity")}</p>
                )}
              </Field>
              <Field label={t("production.newSheet.targetWeightG")}>
                <input
                  type="number"
                  step="any"
                  className={FIELD_CLASS}
                  value={fields.target_weight_g ?? ""}
                  onChange={(e) => {
                    set("target_weight_g", e.target.value);
                    setTargetTouched(true);
                  }}
                />
              </Field>
            </div>
          </>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={handleClose}
            className="min-h-[44px] px-4 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {t("production.common.cancel")}
          </button>
          <button
            type="submit"
            disabled={acting || !canSubmit}
            className="min-h-[44px] px-4 py-2 bg-[var(--brand)] text-white rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {acting ? t("production.newSheet.starting") : t("production.newSheet.start")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
