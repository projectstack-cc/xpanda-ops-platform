"use client";
// The "≠" recipe-deviation marker (prod-c-02, extracted in prod-c-03). One definition, used by the
// sheet grid (ProductionBoard.renderCell) and the History tables. Warn tokens; color + symbol +
// tooltip/aria text, never color alone.
import { useLang } from "@/components/lang";

export default function RecipeDeviationBadge({ recipeValue }: { recipeValue: number | string }) {
  const { t } = useLang();
  const label = `${t("production.recipe.deviationLabel")} ${recipeValue}`;
  return (
    <span
      title={label}
      aria-label={label}
      className="px-1 rounded border text-xs font-semibold bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]"
    >
      ≠
    </span>
  );
}
