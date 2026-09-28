"use client";
// Silos board view (prod-b-03): the full SiloGrid in view mode. ProductionBoard owns the silos
// list and its 30 s refresh; managers / admins tap a tile to open SiloCorrectModal.
import { useState } from "react";
import { useLang } from "@/components/lang";
import type { SiloRow } from "@/lib/productionSilos";
import SiloGrid from "./SiloGrid";
import SiloCorrectModal from "./SiloCorrectModal";
import type { DescribeError } from "./ui";

interface Props {
  silos: SiloRow[] | null;
  error: string | null;
  canCorrect: boolean;
  onRetry: () => void;
  onCorrected: (silo: SiloRow) => void;
  describeError: DescribeError;
}

export default function SilosView({ silos, error, canCorrect, onRetry, onCorrected, describeError }: Props) {
  const { t } = useLang();
  const [correcting, setCorrecting] = useState<SiloRow | null>(null);

  return (
    <div className="p-4 space-y-3">
      <p className="text-sm text-muted">
        {t(canCorrect ? "production.silo.viewHintManager" : "production.silo.viewHint")}
      </p>
      {error && (
        <div className="border border-border rounded px-3 py-3 space-y-1.5">
          <p className="text-sm text-[var(--danger-bg)] font-medium">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="text-xs text-muted underline underline-offset-2 cursor-pointer hover:text-text"
          >
            {t("production.common.retry")}
          </button>
        </div>
      )}
      {silos ? (
        <SiloGrid silos={silos} mode="view" onPick={canCorrect ? setCorrecting : undefined} />
      ) : (
        !error && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2">
            {Array.from({ length: 12 }, (_, i) => (
              <div
                key={i}
                className="h-24 border border-border rounded animate-pulse motion-reduce:animate-none bg-[var(--ghost-bg)]"
              />
            ))}
          </div>
        )
      )}
      <SiloCorrectModal
        silo={correcting}
        onClose={() => setCorrecting(null)}
        onSaved={(s) => {
          setCorrecting(null);
          onCorrected(s);
        }}
        describeError={describeError}
      />
    </div>
  );
}
