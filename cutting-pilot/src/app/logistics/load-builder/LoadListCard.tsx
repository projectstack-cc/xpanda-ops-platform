"use client";
// src/app/logistics/load-builder/LoadListCard.tsx
// Design read: building this as the load list for a logistics planner on a desktop (usable on a
// phone), dense + industrial, a single list card under the picker — legacy's "Load list" card
// (renderLoadTab's cart summary) with editable quantities.
//
// lbr-08. Presentational only. One row per line (swatch, category, name, qty stepper, remove),
// Clear and Calculate load; for an order load whose list differs from the order, a warn-token
// "Changed from the order" note with Reset to order. Confirms (Clear, Reset, re-pack) live in
// LoadPlanView.
import { Calculator, Trash2, Undo2 } from "lucide-react";
import type { CartLine, PackSku } from "@/lib/packEngine";
import type { LoadListDiff } from "@/lib/loadList";
import { BTN_GHOST, BTN_PRIMARY, CARD, NO_SAVE_REASON, plural } from "./loadBuilderUi";
import { QtyStepper, Swatch, dimsLabel } from "./LoadPicker";

interface LoadListCardProps {
  cart: CartLine[];
  skus: PackSku[];
  /** Order loads only: lines that differ from the pulled order (empty = unchanged / not an order). */
  orderDiff: LoadListDiff[];
  canReset: boolean;
  canEdit: boolean;
  locked: boolean;
  onStep: (sku: PackSku, d: 1 | -1) => void;
  onSetQty: (sku: PackSku, qty: number) => void;
  onClear: () => void;
  onResetToOrder: () => void;
  onCalculate: () => void;
}

/** "+20 × 10″ block", "12″ block 120 → 100", "12″ block removed (was 120)". */
export function describeDiff(d: LoadListDiff, skuById: Map<string, PackSku>): string {
  const name = skuById.get(d.skuId)?.name ?? d.skuId;
  if (d.orderQty === 0) return `+${d.listQty} × ${name}`;
  if (d.listQty === 0) return `${name} removed (was ${d.orderQty})`;
  return `${name} ${d.orderQty} → ${d.listQty}`;
}

export default function LoadListCard(p: LoadListCardProps) {
  const skuById = new Map(p.skus.map((s) => [s.id, s]));
  const editable = p.canEdit && !p.locked;
  const pieces = p.cart.reduce((n, c) => n + c.qty, 0);

  return (
    <section className={`${CARD} space-y-3 min-w-0`} aria-labelledby="lb-list-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="lb-list-heading" className="text-sm font-semibold text-text">
          Load list <span className="font-mono tabular-nums text-muted font-normal">· {plural(p.cart.length, "line", "lines")} · {plural(pieces, "piece", "pieces")}</span>
        </h2>
        <button type="button" onClick={p.onClear} disabled={!editable} title={p.canEdit ? undefined : NO_SAVE_REASON} className={BTN_GHOST}>
          Clear
        </button>
      </div>

      {p.orderDiff.length > 0 && (
        <div className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-[var(--warn-text)] min-w-0">
            <span className="font-semibold">Changed from the order:</span> {p.orderDiff.map((d) => describeDiff(d, skuById)).join("; ")}
          </p>
          {p.canReset && (
            <button type="button" onClick={p.onResetToOrder} disabled={!editable} className={BTN_GHOST}>
              <Undo2 size={16} aria-hidden="true" /> Reset to order
            </button>
          )}
        </div>
      )}

      <ul className="divide-y divide-[var(--line)]">
        {p.cart.map((c) => {
          const s = skuById.get(c.skuId);
          const name = s?.name ?? c.skuId;
          return (
            <li key={c.skuId} className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2 py-2">
              {s && <Swatch height={s.height} size={10} />}
              <div className="flex-1 min-w-0">
                {s?.category && <div className="text-xs font-semibold text-muted truncate">{s.category}</div>}
                <div className="text-sm font-semibold text-text truncate" title={name}>
                  {name}
                </div>
                {s && <div className="text-xs text-muted font-mono tabular-nums">{dimsLabel(s)}</div>}
              </div>
              {s ? (
                <QtyStepper qty={c.qty} label={name} disabled={!editable} onStep={(d) => p.onStep(s, d)} onSet={(n) => p.onSetQty(s, n)} />
              ) : (
                <span className="font-mono tabular-nums text-sm text-text">{c.qty}</span>
              )}
              {s && (
                <button
                  type="button"
                  onClick={() => p.onSetQty(s, 0)}
                  disabled={!editable}
                  aria-label={`Remove ${name}`}
                  className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[var(--danger-ink)] cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <button type="button" onClick={p.onCalculate} className={`${BTN_PRIMARY} w-full`}>
        <Calculator size={16} aria-hidden="true" /> Calculate load
      </button>
    </section>
  );
}
