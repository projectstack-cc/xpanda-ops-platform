"use client";
// "+1 bag" bar above the Expansion grid (prod-b-03): shows the append row's lot, bags opened on
// this sheet, and on-hand; +1 / Undo hit bead-lots/{id}/open | undo-open and update from the
// returned lot. Disabled while a call is in flight so a double-tap can't double-count.
import { useState } from "react";
import { useLang } from "@/components/lang";
import type { BeadLotRow } from "@/lib/productionSilos";
import type { DescribeError } from "./ui";

interface Props {
  lot: BeadLotRow;
  sessionId: string;
  onLotUpdated: (lot: BeadLotRow) => void;
  onError: (message: string) => void;
  describeError: DescribeError;
}

export default function BagCounter({ lot, sessionId, onLotUpdated, onError, describeError }: Props) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const opened = Number(lot.opened_in_session ?? 0);
  const onHand = Number(lot.on_hand ?? 0);

  async function call(action: "open" | "undo-open") {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/v2/api/production/bead-lots/${lot.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await res.json();
      if (data.ok && data.lot) onLotUpdated(data.lot);
      else onError(describeError(data.error, "production.bead.bagFailed"));
    } catch {
      onError(t("production.toast.networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-border rounded px-4 py-3 bg-[var(--surface-2)]">
      <p className="text-sm text-text">
        {t("production.field.lotNo")} <span className="font-mono tabular-nums font-semibold">{lot.lot_no}</span>
        {" — "}
        <span className="font-mono tabular-nums font-semibold">{opened}</span> {t("production.bead.openedThisSheet")}
        {" · "}
        <span
          className={[
            "font-mono tabular-nums font-semibold",
            onHand < 0 ? "text-[var(--danger-bg)]" : "",
          ].join(" ")}
        >
          {onHand}
        </span>{" "}
        {t("production.bead.onHandUnit")}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || opened <= 0}
          onClick={() => call("undo-open")}
          className="min-h-[44px] px-4 rounded border border-border bg-[var(--ghost-bg)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {t("production.bead.undo")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => call("open")}
          className="min-h-[56px] px-6 rounded bg-[var(--brand)] text-white text-lg font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {t("production.bead.plusOneBag")}
        </button>
      </div>
    </div>
  );
}
