"use client";
// Add / edit a production schedule line (prod-d-03). Composes the shared Modal + ui form parts.
// create → POST /v2/api/production/manage/schedule (kind fixed by the "+ Molding" / "+ Expansion"
//          button). edit → PATCH …/schedule/{id} with qty + note only; the key is shown read-only
//          (changing it = delete + add, server returns key_immutable otherwise).
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useLang } from "@/components/lang";
import { BUCKET_VOLUME_L, normDensity, targetGramsFromPcf, type RecipeRow } from "@/lib/productionRecipes";
import type { ScheduleKind, ScheduleLine } from "@/lib/productionSchedule";
import type { OptionsData } from "../fields";
import { FIELD_CLASS, LABEL_CLASS, FormActions, FormError } from "../ui";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  kind: ScheduleKind;
  planDate: string;
  line?: ScheduleLine | null;
  options: OptionsData;
  recipes: RecipeRow[];
  onSaved: () => void;
  errorMessage: (code: string | undefined, fallbackKey: string) => string;
}

export function lineLabel(l: Pick<ScheduleLine, "kind" | "block_type" | "bead_supplier" | "bead_type" | "density">): string {
  return l.kind === "molding"
    ? l.block_type ?? "—"
    : `${l.bead_supplier ?? "—"} · ${l.bead_type ?? "—"} · ${l.density === null ? "—" : l.density.toFixed(2)} pcf`;
}

export default function ScheduleLineModal({
  isOpen,
  onClose,
  mode,
  kind,
  planDate,
  line,
  options,
  recipes,
  onSaved,
  errorMessage,
}: Props) {
  const { t } = useLang();
  const [f, setF] = useState<Record<string, string>>({});
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setF(line ? { qty: String(line.qty), note: line.note ?? "" } : { qty: "1" });
  }, [isOpen, line]);

  if (!isOpen) return null;

  const set = (k: string, v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const typesForSupplier = f.bead_supplier ? options.bead_types[f.bead_supplier] ?? [] : [];
  const chips =
    kind === "expansion" && f.bead_supplier && f.bead_type
      ? recipes
          .filter(
            (r) =>
              r.kind === "expansion" && r.active && r.bead_supplier === f.bead_supplier && r.bead_type === f.bead_type && r.density !== null
          )
          .sort((a, b) => (a.density ?? 0) - (b.density ?? 0))
      : [];
  const typedDensity = normDensity(f.density);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(f.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
      setError(errorMessage("qty_invalid", "production.schedule.saveFailed"));
      return;
    }
    const body =
      mode === "edit"
        ? { qty, note: f.note ?? "" }
        : kind === "molding"
          ? { plan_date: planDate, kind, block_type: f.block_type, qty, note: f.note ?? "" }
          : { plan_date: planDate, kind, bead_supplier: f.bead_supplier, bead_type: f.bead_type, density: f.density, qty, note: f.note ?? "" };
    const url =
      mode === "edit" && line
        ? `/v2/api/production/manage/schedule/${encodeURIComponent(line.id)}`
        : "/v2/api/production/manage/schedule";
    setActing(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) onSaved();
      else setError(errorMessage(data.error, "production.schedule.saveFailed"));
    } catch {
      setError(t("production.toast.networkError"));
    } finally {
      setActing(false);
    }
  }

  const title = t(
    mode === "edit"
      ? "production.schedule.editTitle"
      : kind === "molding"
        ? "production.schedule.newMoldingTitle"
        : "production.schedule.newExpansionTitle"
  );
  const canSubmit =
    mode === "edit" || (kind === "molding" ? !!f.block_type : !!f.bead_supplier && !!f.bead_type && typedDensity !== null);

  return (
    <Modal isOpen onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        <p className="text-sm text-muted">
          <span className="font-mono tabular-nums">{planDate}</span>
          {mode === "edit" && line && (
            <>
              {" · "}
              <span className="text-text font-semibold">{lineLabel(line)}</span>
              <span className="block text-xs">{t("production.schedule.keyReadOnly")}</span>
            </>
          )}
        </p>

        {mode === "create" && kind === "molding" && (
          <label className="block">
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

        {mode === "create" && kind === "expansion" && (
          <>
            <div className="grid grid-cols-2 gap-3">
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
            </div>
            {chips.length > 0 && (
              <div>
                <span className={LABEL_CLASS}>{t("production.recipe.chipsLabel")}</span>
                <div className="flex flex-wrap gap-2">
                  {chips.map((r) => {
                    const d = (r.density ?? 0).toFixed(2);
                    const g = targetGramsFromPcf(r.density, BUCKET_VOLUME_L);
                    const selected = typedDensity === r.density;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => set("density", d)}
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
            </label>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={LABEL_CLASS}>
              {t(kind === "molding" ? "production.schedule.blocks" : "production.schedule.silos")}
            </span>
            <input
              required
              type="number"
              min={1}
              max={999}
              step={1}
              inputMode="numeric"
              className={FIELD_CLASS + " font-mono tabular-nums"}
              value={f.qty ?? ""}
              onChange={(e) => set("qty", e.target.value)}
            />
          </label>
          <label className="block">
            <span className={LABEL_CLASS}>{t("production.schedule.note")}</span>
            <input className={FIELD_CLASS} value={f.note ?? ""} onChange={(e) => set("note", e.target.value)} />
          </label>
        </div>

        <FormError message={error} />
        <FormActions
          onCancel={onClose}
          acting={acting}
          submitKey="production.schedule.save"
          actingKey="production.schedule.saving"
          disabled={!canSubmit}
        />
      </form>
    </Modal>
  );
}
