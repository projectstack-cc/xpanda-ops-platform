"use client";
// The ONE silo tile grid (prod-b-03), used by SiloPickerModal (mode expansion | molding) and
// SilosView (mode view). Tile = label, translated state, lot, bead type, kg added since the fill
// started, and time since full (full / in_use). In pick modes, tiles the row can't use are
// disabled with a one-line reason. Colors are status tokens only; state is always text + color.
import { useEffect, useState } from "react";
import { useLang } from "@/components/lang";
import { formatDuration } from "@/lib/time";
import type { SiloRow, SiloState } from "@/lib/productionSilos";
import { SILO_STATE_CLS, SILO_STATE_KEY } from "./siloStateStyle";

export type SiloGridMode = "expansion" | "molding" | "view";

interface Props {
  silos: SiloRow[];
  mode: SiloGridMode;
  // Expansion: the append row's selected lot id — a `filling` silo is pickable only for that lot.
  rowLotId?: string | null;
  // Pick modes: called for enabled tiles. View mode: called for every tile when provided
  // (manager correction); omitted = tiles are read-only.
  onPick?: (silo: SiloRow) => void;
  selectedNo?: number | null;
}

function parseUtcMs(ts: string | null): number | null {
  if (!ts) return null;
  const ms = Date.parse(ts.replace(" ", "T") + "Z");
  return Number.isNaN(ms) ? null : ms;
}

// null = pickable; otherwise the i18n key (+ lot) explaining why not.
function disabledReason(s: SiloRow, mode: SiloGridMode, rowLotId: string | null | undefined): string | null {
  if (mode === "view") return null;
  if (!s.active) return "production.silo.reason.inactive";
  if (mode === "expansion") {
    if (s.state === "empty") return null;
    if (s.state === "filling" && rowLotId && s.lot_id === rowLotId) return null;
    return "production.silo.reason.holdsLot";
  }
  if (s.state === "full" || s.state === "in_use") return null;
  return s.state === "empty" ? "production.silo.reason.empty" : "production.silo.reason.stillFilling";
}

export default function SiloGrid({ silos, mode, rowLotId, onPick, selectedNo }: Props) {
  const { t } = useLang();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2">
      {silos.map((s) => {
        const reasonKey = disabledReason(s, mode, rowLotId);
        const clickable = !!onPick && reasonKey === null;
        const fullMs = s.state === "full" || s.state === "in_use" ? parseUtcMs(s.full_at) : null;
        const selected = selectedNo === s.silo_no;
        return (
          <button
            key={s.silo_no}
            type="button"
            disabled={!clickable}
            onClick={clickable ? () => onPick!(s) : undefined}
            aria-label={`${s.label} — ${t(SILO_STATE_KEY[s.state])}${s.lot_no ? ` — ${t("production.field.lotNo")} ${s.lot_no}` : ""}`}
            className={[
              "min-h-[44px] text-left rounded border px-3 py-2 flex flex-col gap-1",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
              clickable ? "cursor-pointer hover:border-text" : "cursor-default",
              !s.active ? "opacity-60 bg-[var(--ghost-bg)] border-border" : "bg-surface border-border",
              reasonKey !== null ? "opacity-60" : "",
              selected ? "ring-2 ring-[var(--accent)]" : "",
            ].join(" ")}
          >
            <span className="flex items-center justify-between gap-2">
              <span className={["text-sm font-semibold text-text", !s.active ? "line-through" : ""].join(" ")}>
                {s.label}
              </span>
              <span className={`px-2 py-0.5 rounded border text-xs font-semibold whitespace-nowrap ${SILO_STATE_CLS[s.state]}`}>
                {t(SILO_STATE_KEY[s.state])}
              </span>
            </span>
            {s.state !== "empty" ? (
              <>
                <span className="text-xs text-muted">
                  {t("production.field.lotNo")}{" "}
                  <span className="font-mono tabular-nums text-text font-semibold">{s.lot_no ?? "—"}</span>
                  {s.bead_type ? <span> · {s.bead_type}</span> : null}
                </span>
                <span className="text-xs text-muted">
                  <span className="font-mono tabular-nums text-text">{Number(s.kg_added || 0).toFixed(1)}</span> kg
                  {fullMs !== null && (
                    <>
                      {" · "}
                      {t("production.silo.fullFor")}{" "}
                      <span className="font-mono tabular-nums text-text">
                        {formatDuration((nowMs - fullMs) / 1000)}
                      </span>
                    </>
                  )}
                </span>
              </>
            ) : (
              <span className="text-xs text-[var(--text-hint)]">{t("production.silo.noLot")}</span>
            )}
            {reasonKey && (
              <span className="text-xs text-muted">
                {t(reasonKey).replace("{lot}", s.lot_no ?? "—")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
