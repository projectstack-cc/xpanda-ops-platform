"use client";
import type { HcSlot, MyOpen } from "./ChunkBoard";

interface Props {
  slots: HcSlot[];
  myOpen: MyOpen | null;
  acting: boolean;
  onStart: (slotKey: string) => void;
  onStop: (slotKey: string, label: string, currentOnHand: number) => void;
  onComplete: (slotKey: string, label: string) => void;
}

export default function HoleCutterSlots({ slots, myOpen, acting, onStart, onStop, onComplete }: Props) {
  return (
    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
      {slots.map((s) => {
        const isMine = myOpen?.board === "hc" && myOpen.ref_id === s.slot_key;
        const isBusyByOther = !!s.busy_by && !isMine;

        return (
          <div key={s.slot_key} className="border border-border rounded-lg px-4 py-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="font-semibold text-sm text-text">{s.label}</h3>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <p className="text-xs text-muted uppercase tracking-wide mb-0.5">On hand</p>
                <p className="font-mono tabular-nums text-2xl font-semibold text-text">{s.on_hand}</p>
              </div>
              <div>
                <p className="text-xs text-muted uppercase tracking-wide mb-0.5">Total holed</p>
                <p className="font-mono tabular-nums text-2xl font-semibold text-text">{s.total_holed}</p>
              </div>
            </div>

            {isBusyByOther && (
              <p className="text-sm bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)] rounded px-3 py-2 mb-3">
                Running — {s.busy_by}
              </p>
            )}
            {isMine && (
              <p className="text-sm bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)] rounded px-3 py-2 mb-3">
                Running — you
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {!isMine && (
                <button
                  type="button"
                  disabled={acting || isBusyByOther}
                  title={isBusyByOther ? `In use by ${s.busy_by}` : undefined}
                  onClick={() => onStart(s.slot_key)}
                  className="min-h-[44px] px-4 py-2 bg-[var(--primary-bg)] text-[var(--primary-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  Start
                </button>
              )}
              {isMine && (
                <>
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => onStop(s.slot_key, s.label, s.on_hand)}
                    className="min-h-[44px] px-4 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    Stop
                  </button>
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => onComplete(s.slot_key, s.label)}
                    className="min-h-[44px] px-4 py-2 bg-[var(--success-bg)] text-[var(--success-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    Complete
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
