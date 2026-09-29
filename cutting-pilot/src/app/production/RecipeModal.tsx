"use client";
// Recipe create / new-version form (prod-c-02). Composes the shared Modal + ui form parts.
// create  → POST /v2/api/production/manage/recipes (key + values)
// version → PUT  /v2/api/production/manage/recipes/{recipe_key} (values + notes only; the key is
//           shown read-only — it's immutable server-side). The server remains the authority;
//           the checks here only mirror its rules for fast feedback.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useLang } from "@/components/lang";
import { BUCKET_VOLUME_L, normDensity, targetGramsFromPcf, type RecipeRow } from "@/lib/productionRecipes";
import type { OptionsData } from "./fields";
import { FIELD_CLASS, LABEL_CLASS, FormActions, FormError, type DescribeError } from "./ui";

export type RecipeKind = "expansion" | "molding";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  mode: "create" | "version";
  kind: RecipeKind;
  recipe?: RecipeRow;
  options: OptionsData;
  // stale = recipe_changed: keep the modal open showing the message, just refetch the list.
  onSaved: (stale?: boolean) => void;
  describeError: DescribeError;
}

const MOLD_PARAMS = ["rc_pct_open", "rc_speed", "virgin_pct_open", "virgin_speed"] as const;
const MOLD_LABEL: Record<(typeof MOLD_PARAMS)[number], string> = {
  rc_pct_open: "production.field.rcPctOpen",
  rc_speed: "production.field.rcSpeed",
  virgin_pct_open: "production.field.virginPctOpen",
  virgin_speed: "production.field.virginSpeed",
};

const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export default function RecipeModal({ isOpen, onClose, mode, kind, recipe, options, onSaved, describeError }: Props) {
  const { t } = useLang();
  const [f, setF] = useState<Record<string, string>>({});
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setF(
      recipe
        ? {
            heating_time_s: str(recipe.heating_time_s),
            rc_pct_open: str(recipe.rc_pct_open),
            rc_speed: str(recipe.rc_speed),
            virgin_pct_open: str(recipe.virgin_pct_open),
            virgin_speed: str(recipe.virgin_speed),
            notes: recipe.notes ?? "",
          }
        : {}
    );
  }, [isOpen, recipe]);

  if (!isOpen) return null;

  const set = (k: string, v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const typesForSupplier = f.bead_supplier ? options.bead_types[f.bead_supplier] ?? [] : [];
  const derivedG = targetGramsFromPcf(normDensity(f.density), BUCKET_VOLUME_L);

  // Client mirror of the server rules; returns the invalid field's label key or null.
  function invalidField(): string | null {
    const num = (v: string | undefined) => (v === undefined || v.trim() === "" ? NaN : Number(v));
    if (kind === "expansion") {
      if (mode === "create") {
        if (!f.bead_supplier) return "production.newSheet.supplier";
        if (!f.bead_type) return "production.newSheet.beadType";
        if (normDensity(f.density) === null) return "production.recipe.density";
      }
      const h = num(f.heating_time_s);
      if (!(Number.isFinite(h) && h > 0)) return "production.recipe.heatingTime";
      return null;
    }
    if (mode === "create" && !f.block_type) return "production.newSheet.blockType";
    for (const p of MOLD_PARAMS) {
      const n = num(f[p]);
      if (!(Number.isFinite(n) && n >= 0) || (p.endsWith("_pct_open") && n > 100)) return MOLD_LABEL[p];
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const bad = invalidField();
    if (bad) {
      setError(`${t("production.recipe.invalidField")} ${t(bad)}`);
      return;
    }
    const values: Record<string, unknown> =
      kind === "expansion"
        ? { heating_time_s: Number(f.heating_time_s) }
        : Object.fromEntries(MOLD_PARAMS.map((p) => [p, Number(f[p])]));
    values.notes = f.notes ?? "";
    const body =
      mode === "version"
        ? values
        : kind === "expansion"
          ? { kind, bead_supplier: f.bead_supplier, bead_type: f.bead_type, density: normDensity(f.density), ...values }
          : { kind, block_type: f.block_type, ...values };
    const url =
      mode === "version" && recipe
        ? `/v2/api/production/manage/recipes/${encodeURIComponent(recipe.recipe_key)}`
        : "/v2/api/production/manage/recipes";
    setActing(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: mode === "version" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        onSaved();
      } else {
        setError(describeError(data.error, "production.recipe.saveFailed"));
        // Someone else changed it first — refetch the list behind the modal.
        if (data.error === "recipe_changed") onSaved(true);
      }
    } catch {
      setError(t("production.toast.networkError"));
    } finally {
      setActing(false);
    }
  }

  const numInput = (key: string, label: string, max?: number) => (
    <label key={key} className="block">
      <span className={LABEL_CLASS}>{label}</span>
      <input
        required
        type="number"
        min={0}
        max={max}
        step="any"
        inputMode="decimal"
        className={FIELD_CLASS + " font-mono tabular-nums"}
        value={f[key] ?? ""}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );

  const title = t(
    mode === "create"
      ? kind === "expansion"
        ? "production.recipe.newExpansionTitle"
        : "production.recipe.newMoldingTitle"
      : "production.recipe.newVersionTitle"
  );

  return (
    <Modal isOpen onClose={onClose} title={title} size="lg">
      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        {mode === "version" && recipe && (
          <p className="text-sm text-muted">
            {kind === "expansion" ? (
              <>
                {recipe.bead_supplier} · {recipe.bead_type} ·{" "}
                <span className="font-mono tabular-nums text-text font-semibold">
                  {recipe.density?.toFixed(2)} {t("production.unit.pcf")}
                </span>
              </>
            ) : (
              <span className="text-text font-semibold">{recipe.block_type}</span>
            )}{" "}
            · {t("production.recipe.version")}{" "}
            <span className="font-mono tabular-nums">
              {recipe.version} → {recipe.version + 1}
            </span>
            <span className="block text-xs">{t("production.recipe.keyImmutableHint")}</span>
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {mode === "create" && kind === "expansion" && (
            <>
              <label className="block">
                <span className={LABEL_CLASS}>{t("production.newSheet.supplier")}</span>
                <select
                  required
                  className={FIELD_CLASS + " cursor-pointer"}
                  value={f.bead_supplier ?? ""}
                  onChange={(e) => setF((cur) => ({ ...cur, bead_supplier: e.target.value, bead_type: "" }))}
                >
                  <option value="">{t("production.newSheet.selectPlaceholder")}</option>
                  {options.suppliers.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={LABEL_CLASS}>{t("production.newSheet.beadType")}</span>
                <select
                  required
                  disabled={!f.bead_supplier}
                  className={FIELD_CLASS + " cursor-pointer disabled:opacity-50"}
                  value={f.bead_type ?? ""}
                  onChange={(e) => set("bead_type", e.target.value)}
                >
                  <option value="">{t("production.newSheet.selectPlaceholder")}</option>
                  {typesForSupplier.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={LABEL_CLASS}>
                  {t("production.recipe.density")} ({t("production.unit.pcf")})
                </span>
                <input
                  required
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  className={FIELD_CLASS + " font-mono tabular-nums"}
                  value={f.density ?? ""}
                  onChange={(e) => set("density", e.target.value)}
                />
                <span className="mt-1 block text-xs text-muted">
                  {t("production.recipe.targetG")}:{" "}
                  <span className="font-mono tabular-nums">{derivedG === null ? "—" : `${derivedG.toFixed(1)} g`}</span>
                </span>
              </label>
            </>
          )}
          {mode === "create" && kind === "molding" && (
            <label className="block sm:col-span-2">
              <span className={LABEL_CLASS}>{t("production.newSheet.blockType")}</span>
              <select
                required
                className={FIELD_CLASS + " cursor-pointer"}
                value={f.block_type ?? ""}
                onChange={(e) => set("block_type", e.target.value)}
              >
                <option value="">{t("production.newSheet.selectPlaceholder")}</option>
                {options.block_types.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          )}

          {kind === "expansion"
            ? numInput("heating_time_s", `${t("production.recipe.heatingTime")} (s)`)
            : MOLD_PARAMS.map((p) => numInput(p, t(MOLD_LABEL[p]), p.endsWith("_pct_open") ? 100 : undefined))}

          <label className="block sm:col-span-2">
            <span className={LABEL_CLASS}>{t("production.recipe.notes")}</span>
            <input className={FIELD_CLASS} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </label>
        </div>

        <FormError message={error} />
        <FormActions
          onCancel={onClose}
          acting={acting}
          submitKey="production.recipe.save"
          actingKey="production.recipe.saving"
        />
      </form>
    </Modal>
  );
}
