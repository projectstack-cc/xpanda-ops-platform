"use client";
// Lot trace (prod-c-03): everything recorded against one supplier lot # — received lot(s) with bag
// totals, expansion batches, silo timeline, and the blocks molded from it. Read-only.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useLang } from "@/components/lang";
import type { DescribeError } from "./ui";

interface TraceLot {
  id: string;
  bead_supplier: string;
  bead_type: string;
  received_date: string;
  po_no: string | null;
  label_weight: number;
  label_unit: string;
  received: number;
  opened: number;
  bags_on_hand: number;
}
interface TraceBatch {
  id: string;
  log_date: string;
  silo: number | null;
  weight_kg: number | null;
  density: number | null;
}
interface TraceEvent {
  id: string;
  created_at: string;
  silo_no: number;
  from_state: string;
  to_state: string;
  source: string;
  operator_name: string | null;
}
interface TraceBlock {
  id: string;
  log_date: string;
  block_no: string | null;
  block_type: string | null;
  silo: number | null;
  block_weight_lbs: number | null;
}
interface TraceData {
  lots: TraceLot[];
  batches: TraceBatch[];
  silo_events: TraceEvent[];
  blocks: TraceBlock[];
  truncated: boolean;
}

interface Props {
  lotNo: string | null;
  onClose: () => void;
  describeError: DescribeError;
}

const NUM = "font-mono tabular-nums";
const H3 = "text-sm font-semibold text-text";
const ROW = "text-sm text-text border-b border-border py-1.5 flex flex-wrap gap-x-3";

export default function LotTraceModal({ lotNo, onClose, describeError }: Props) {
  const { t } = useLang();
  const [data, setData] = useState<TraceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lotNo) return;
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/v2/api/production/lot-trace?lot=${encodeURIComponent(lotNo)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok) setData(d);
        else setError(describeError(d.error, "production.history.traceFailed"));
      })
      .catch(() => {
        if (!cancelled) setError(t("production.error.networkError"));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotNo]);

  if (!lotNo) return null;

  const empty =
    data && !data.lots.length && !data.batches.length && !data.silo_events.length && !data.blocks.length;
  const totalLbs = data ? data.blocks.reduce((sum, b) => sum + (b.block_weight_lbs ?? 0), 0) : 0;

  return (
    <Modal isOpen onClose={onClose} title={`${t("production.history.traceTitle")} — ${lotNo}`} size="xl">
      {error ? (
        <p role="alert" className="text-sm text-[var(--danger-bg)]">
          {error}
        </p>
      ) : !data ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 rounded bg-[var(--ghost-bg)] animate-pulse motion-reduce:animate-none" />
          ))}
        </div>
      ) : empty ? (
        <p className="text-sm text-muted">{t("production.history.traceEmpty")}</p>
      ) : (
        <div className="space-y-5">
          <section className="space-y-1">
            <h3 className={H3}>{t("production.history.traceReceived")}</h3>
            {data.lots.length === 0 ? (
              <p className="text-sm text-muted">{t("production.bead.notReceived")}</p>
            ) : (
              data.lots.map((l) => (
                <div key={l.id} className={ROW}>
                  <span className="font-semibold">
                    {l.bead_supplier} · {l.bead_type}
                  </span>
                  <span className={NUM}>{l.received_date}</span>
                  <span>
                    {t("production.bead.poNo")} {l.po_no || "—"}
                  </span>
                  <span className={NUM}>
                    {l.label_weight} {l.label_unit}
                  </span>
                  <span>
                    {t("production.bead.received")} <span className={NUM}>{l.received}</span> ·{" "}
                    {t("production.bead.opened")} <span className={NUM}>{l.opened}</span> ·{" "}
                    {t("production.bead.onHand")}{" "}
                    <span className={[NUM, "font-semibold", l.bags_on_hand < 0 ? "text-[var(--danger-bg)]" : ""].join(" ")}>
                      {l.bags_on_hand}
                    </span>
                  </span>
                </div>
              ))
            )}
          </section>

          <section className="space-y-1">
            <h3 className={H3}>
              {t("production.history.traceExpansion")} <span className={NUM + " text-muted font-normal"}>({data.batches.length})</span>
            </h3>
            {data.batches.map((b) => (
              <div key={b.id} className={ROW}>
                <span className={NUM}>{b.log_date}</span>
                <span>
                  {t("production.field.silo")} <span className={NUM}>{b.silo ?? "—"}</span>
                </span>
                <span className={NUM}>{b.weight_kg ?? "—"} kg</span>
                <span className={NUM}>
                  {b.density ?? "—"} {t("production.unit.pcf")}
                </span>
              </div>
            ))}
          </section>

          <section className="space-y-1">
            <h3 className={H3}>{t("production.history.traceSilo")}</h3>
            {data.silo_events.map((e) => (
              <div key={e.id} className={ROW}>
                <span className={NUM}>{e.created_at}</span>
                <span>
                  {t("production.field.silo")} <span className={NUM}>{e.silo_no}</span>
                </span>
                <span>
                  {e.from_state} → <span className="font-semibold">{e.to_state}</span>
                </span>
                <span className="text-muted">{e.source}</span>
                <span className="text-muted">{e.operator_name || "—"}</span>
              </div>
            ))}
          </section>

          <section className="space-y-1">
            <h3 className={H3}>
              {t("production.history.traceBlocks")}{" "}
              <span className={NUM + " text-muted font-normal"}>
                ({data.blocks.length} · {totalLbs.toFixed(1)} lbs {t("production.history.demoldShort")})
              </span>
            </h3>
            {data.truncated && <p className="text-xs text-[var(--warn-text)]">{t("production.history.traceTruncated")}</p>}
            {data.blocks.map((b) => (
              <div key={b.id} className={ROW}>
                <span className={NUM}>{b.log_date}</span>
                <span className={NUM + " font-semibold"}>{b.block_no || "—"}</span>
                <span>{b.block_type || "—"}</span>
                <span>
                  {t("production.field.silo")} <span className={NUM}>{b.silo ?? "—"}</span>
                </span>
                <span className={NUM}>{b.block_weight_lbs ?? "—"} lbs</span>
              </div>
            ))}
          </section>
        </div>
      )}
    </Modal>
  );
}
