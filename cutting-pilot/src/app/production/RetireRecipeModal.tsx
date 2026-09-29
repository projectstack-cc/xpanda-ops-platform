"use client";
// Retire confirm (prod-c-02) → DELETE /v2/api/production/manage/recipes/{recipe_key}. Retire only
// deactivates — past sheets keep their recipe snapshot.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useLang } from "@/components/lang";
import type { RecipeRow } from "@/lib/productionRecipes";
import { BTN_GHOST, BTN_PRIMARY, FormError, type DescribeError } from "./ui";

interface Props {
  recipe: RecipeRow | null;
  label: string;
  onClose: () => void;
  onSaved: () => void;
  describeError: DescribeError;
}

export default function RetireRecipeModal({ recipe, label, onClose, onSaved, describeError }: Props) {
  const { t } = useLang();
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [recipe]);

  if (!recipe) return null;

  async function retire() {
    if (!recipe) return;
    setActing(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/production/manage/recipes/${encodeURIComponent(recipe.recipe_key)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.ok) onSaved();
      else setError(describeError(data.error, "production.recipe.retireFailed"));
    } catch {
      setError(t("production.toast.networkError"));
    } finally {
      setActing(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={t("production.recipe.retireTitle")}>
      <p className="text-sm text-text font-semibold">{label}</p>
      <p className="text-sm text-muted">{t("production.recipe.retireConfirm")}</p>
      <FormError message={error} />
      <div className="flex gap-2 justify-end pt-1">
        <button type="button" onClick={onClose} className={BTN_GHOST}>
          {t("production.common.cancel")}
        </button>
        <button type="button" disabled={acting} onClick={retire} className={BTN_PRIMARY}>
          {t(acting ? "production.recipe.retiring" : "production.recipe.retire")}
        </button>
      </div>
    </Modal>
  );
}
