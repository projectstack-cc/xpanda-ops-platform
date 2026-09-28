"use client";
// Bead board view (prod-b-03): received lots with bag counts (received / opened / on hand),
// filtered by supplier + bead type, optional inactive lots. Everyone can view; managers get
// Receive bead, and per-row Adjust / Edit.
import { useCallback, useEffect, useState } from "react";
import { Pencil, SlidersHorizontal } from "lucide-react";
import { useLang } from "@/components/lang";
import type { BeadLotRow } from "@/lib/productionSilos";
import type { OptionsData } from "./fields";
import ReceiveLotModal from "./ReceiveLotModal";
import AdjustLotModal from "./AdjustLotModal";
import EditLotModal from "./EditLotModal";
import { BTN_PRIMARY, type DescribeError } from "./ui";

interface Props {
  canManage: boolean;
  options: OptionsData;
  onToast: (msg: string, ok?: boolean) => void;
  describeError: DescribeError;
}

const CELL = "px-2 py-1.5 text-sm text-text whitespace-nowrap";
const NUM = CELL + " font-mono tabular-nums text-right";
const HEAD = "px-2 py-1.5 text-xs font-semibold text-muted text-left whitespace-nowrap";
const FILTER =
  "min-h-[44px] px-3 rounded border border-border bg-bg text-text text-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const ICON_BTN =
  "w-11 h-11 flex items-center justify-center rounded text-muted hover:text-text hover:bg-[var(--ghost-bg)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

export default function BeadView({ canManage, options, onToast, describeError }: Props) {
  const { t } = useLang();
  const [supplier, setSupplier] = useState("");
  const [beadType, setBeadType] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [lots, setLots] = useState<BeadLotRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<BeadLotRow | null>(null);
  const [editing, setEditing] = useState<BeadLotRow | null>(null);

  const fetchLots = useCallback(async () => {
    setError(null);
    const q = new URLSearchParams();
    if (supplier) q.set("supplier", supplier);
    if (beadType) q.set("bead_type", beadType);
    if (showInactive) q.set("include_inactive", "1");
    try {
      const res = await fetch(`/v2/api/production/bead-lots?${q.toString()}`);
      const data = await res.json();
      if (data.ok) setLots(data.lots);
      else setError(describeError(data.error, "production.bead.loadFailed"));
    } catch {
      setError(t("production.error.networkError"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier, beadType, showInactive]);

  useEffect(() => {
    fetchLots();
  }, [fetchLots]);

  const typesForSupplier = supplier ? options.bead_types[supplier] ?? [] : [];

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t("production.newSheet.supplier")}
            className={FILTER}
            value={supplier}
            onChange={(e) => {
              setSupplier(e.target.value);
              setBeadType("");
            }}
          >
            <option value="">{t("production.bead.allSuppliers")}</option>
            {options.suppliers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            aria-label={t("production.newSheet.beadType")}
            className={FILTER + " disabled:opacity-50"}
            value={beadType}
            disabled={!supplier}
            onChange={(e) => setBeadType(e.target.value)}
          >
            <option value="">{t("production.bead.allTypes")}</option>
            {typesForSupplier.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 min-h-[44px] px-2 cursor-pointer text-sm text-text">
            <input
              type="checkbox"
              className="w-5 h-5 cursor-pointer"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            {t("production.bead.showInactive")}
          </label>
        </div>
        {canManage && (
          <button type="button" onClick={() => setReceiveOpen(true)} className={BTN_PRIMARY}>
            {t("production.bead.receiveBead")}
          </button>
        )}
      </div>

      {error && (
        <div className="border border-border rounded px-3 py-3 space-y-1.5">
          <p className="text-sm text-[var(--danger-bg)] font-medium">{error}</p>
          <button
            type="button"
            onClick={fetchLots}
            className="text-xs text-muted underline underline-offset-2 cursor-pointer hover:text-text"
          >
            {t("production.common.retry")}
          </button>
        </div>
      )}

      {lots === null && !error ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 border border-border rounded animate-pulse motion-reduce:animate-none bg-[var(--ghost-bg)]" />
          ))}
        </div>
      ) : lots && lots.length === 0 ? (
        <p className="border border-border rounded px-4 py-6 text-sm text-muted">
          {t(canManage ? "production.bead.emptyManager" : "production.bead.empty")}
        </p>
      ) : lots ? (
        <div className="overflow-x-auto border border-border rounded">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border bg-[var(--surface-2)]">
                <th className={HEAD}>{t("production.newSheet.supplier")}</th>
                <th className={HEAD}>{t("production.newSheet.beadType")}</th>
                <th className={HEAD}>{t("production.field.lotNo")}</th>
                <th className={HEAD}>{t("production.bead.receivedDate")}</th>
                <th className={HEAD}>{t("production.bead.labelWeight")}</th>
                <th className={HEAD}>{t("production.bead.poNo")}</th>
                <th className={HEAD + " text-right"}>{t("production.bead.received")}</th>
                <th className={HEAD + " text-right"}>{t("production.bead.opened")}</th>
                <th className={HEAD + " text-right"}>{t("production.bead.onHand")}</th>
                {canManage && <th className={HEAD}>{t("production.grid.actions")}</th>}
              </tr>
            </thead>
            <tbody>
              {lots.map((l) => (
                <tr key={l.id} className={["border-b border-border", l.active ? "" : "opacity-60"].join(" ")}>
                  <td className={CELL}>{l.bead_supplier}</td>
                  <td className={CELL}>{l.bead_type}</td>
                  <td className={CELL + " font-mono tabular-nums font-semibold"}>
                    {l.lot_no}
                    {!l.active && <span className="ml-2 font-sans font-normal text-xs text-muted">({t("production.bead.inactive")})</span>}
                  </td>
                  <td className={CELL + " font-mono tabular-nums"}>{l.received_date}</td>
                  <td className={CELL + " font-mono tabular-nums"}>
                    {l.label_weight} {l.label_unit}
                  </td>
                  <td className={CELL}>{l.po_no || "—"}</td>
                  <td className={NUM}>{l.bags_received}</td>
                  <td className={NUM}>{l.bags_opened}</td>
                  <td className={[NUM, "font-semibold", l.on_hand < 0 ? "text-[var(--danger-bg)]" : ""].join(" ")}>
                    {l.on_hand}
                  </td>
                  {canManage && (
                    <td className={CELL}>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setAdjusting(l)}
                          aria-label={t("production.bead.adjustAria")}
                          className={ICON_BTN}
                        >
                          <SlidersHorizontal size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(l)}
                          aria-label={t("production.bead.editAria")}
                          className={ICON_BTN}
                        >
                          <Pencil size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ReceiveLotModal
        isOpen={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        options={options}
        prefill={{ supplier: supplier || null, beadType: beadType || null }}
        onReceived={(_lot, created) => {
          setReceiveOpen(false);
          onToast(t(created ? "production.bead.receivedCreated" : "production.bead.receivedExisting"));
          fetchLots();
        }}
        describeError={describeError}
      />
      <AdjustLotModal
        lot={adjusting}
        onClose={() => setAdjusting(null)}
        onSaved={() => {
          setAdjusting(null);
          onToast(t("production.bead.adjusted"));
          fetchLots();
        }}
        describeError={describeError}
      />
      <EditLotModal
        lot={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onToast(t("production.toast.rowUpdated"));
          fetchLots();
        }}
        describeError={describeError}
      />
    </div>
  );
}
