"use client";
// src/app/logistics/load-builder/LoadTab.tsx
// lbr-05: legacy's Load tab, for now without the manual SKU picker (lbr-06 adds it). Three blocks:
// the Order card (pull / re-pull / load saved / save — the existing actions), Settings (trailer type,
// runners, auto-downsize, and the "Mix stacks to save trucks" toggle — the same state as the Results
// tab's pure-plan toggle), and the existing pull / unmatched-items / reopened banners. Presentational
// only: every value and handler comes from LoadPlanView.
import { Truck, Save, FolderOpen, Calculator } from "lucide-react";
import type { PulledLoadSource } from "@/components/logistics/JobPullModal";
import { BTN_GHOST, BTN_OUTLINE, BTN_PRIMARY, CARD, SELECT, formatEt } from "./loadBuilderUi";

interface LoadTabProps {
  hasSource: boolean;
  pulledSource: PulledLoadSource | null;
  /** Source heading, e.g. the order's customer or a fixture label. */
  sourceLabel: string;
  pieceCount: number;
  footprintCount: number;
  currentSavedLoadName: string | null;
  isUpdate: boolean;
  /** Settings and source actions are locked while the customize editor is open. */
  locked: boolean;
  canSave: boolean;

  trailerTypeKey: string;
  trailerTypeKeys: string[];
  runnerHeight: number;
  runnerHeightOptions: readonly number[];
  autoDownsize: boolean;
  consolidate: boolean;
  onTrailerTypeChange: (key: string) => void;
  onRunnerHeightChange: (rh: number) => void;
  onAutoDownsizeChange: (v: boolean) => void;
  onConsolidateChange: (v: boolean) => void;

  onPull: () => void;
  onRepull: () => void;
  onLoadSaved: () => void;
  onSave: () => void;
  onCalculate: () => void;

  reopenedAt: string | null;
  onDismissReopened: () => void;
  bannerDismissed: boolean;
  onDismissBanner: () => void;
}

function Toggle({ label, hint, value, disabled, onChange }: { label: string; hint: string; value: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 min-h-[44px]">
      <div className="min-w-0">
        <div className="text-sm font-medium text-text">{label}</div>
        <div className="text-xs text-muted">{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={[
          "shrink-0 min-h-[44px] min-w-[72px] px-3 rounded-lg text-sm font-semibold cursor-pointer border transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:opacity-40 disabled:cursor-not-allowed",
          value ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[var(--border)] text-muted hover:text-text",
        ].join(" ")}
      >
        {value ? "On" : "Off"}
      </button>
    </div>
  );
}

export default function LoadTab(p: LoadTabProps) {
  const { pulledSource } = p;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <div className="space-y-4 min-w-0">
        {/* Order card */}
        <section className={CARD} aria-labelledby="lb-order-heading">
          <h2 id="lb-order-heading" className="text-sm font-semibold text-text mb-1">
            Order
          </h2>
          {p.hasSource ? (
            <div className="text-sm text-text mb-3">
              <div className="font-semibold">{p.sourceLabel}</div>
              <div className="text-muted font-mono tabular-nums">
                {pulledSource?.invoiceNumber ? `INV# ${pulledSource.invoiceNumber} · ` : ""}
                {p.pieceCount} pieces · {p.footprintCount} footprints
              </div>
              {p.currentSavedLoadName && (
                <div className="text-muted">
                  Saved as <span className="font-semibold text-text">{p.currentSavedLoadName}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted mb-3">
              Pull an order to build a load — its line items are matched against the parts library automatically.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {pulledSource ? (
              <button type="button" onClick={p.onRepull} disabled={p.locked} className={BTN_OUTLINE}>
                <Truck size={16} aria-hidden="true" /> Re-pull from order
              </button>
            ) : (
              <button type="button" onClick={p.onPull} disabled={p.locked} className={p.hasSource ? BTN_OUTLINE : BTN_PRIMARY}>
                <Truck size={16} aria-hidden="true" /> Pull from order
              </button>
            )}
            {pulledSource && (
              <button type="button" onClick={p.onPull} disabled={p.locked} className={BTN_GHOST}>
                Pull a different order
              </button>
            )}
            <button type="button" onClick={p.onLoadSaved} disabled={p.locked} className={BTN_GHOST}>
              <FolderOpen size={16} aria-hidden="true" /> Load saved
            </button>
            <button type="button" onClick={p.onSave} disabled={!p.canSave || p.locked} className={BTN_GHOST}>
              <Save size={16} aria-hidden="true" /> {p.isUpdate ? "Update save" : "Save load"}
            </button>
          </div>
        </section>

        {/* lbr-04: reopened-from-order banner — informational and dismissible, like the pull banner. */}
        {p.reopenedAt && pulledSource && (
          <div className="rounded-xl border border-[var(--loaded-border)] bg-[var(--loaded-bg)] px-4 py-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-[var(--loaded-text)]">Opened this order&apos;s saved load (saved {formatEt(p.reopenedAt, true)}).</div>
            <button type="button" onClick={p.onDismissReopened} className="shrink-0 text-sm font-semibold text-[var(--loaded-text)] cursor-pointer min-h-[44px] px-2">
              Dismiss
            </button>
          </div>
        )}

        {/* Pull banner — informational, not blocking: unmatched items are named, never silently
            dropped or auto-created. */}
        {pulledSource && !p.bannerDismissed && (
          <div className="rounded-xl border border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_6%,transparent)] px-4 py-2 flex items-start justify-between gap-2">
            <div className="text-sm text-text py-2 min-w-0">
              <span className="font-semibold">Pulled from order:</span> {pulledSource.customer}
              {pulledSource.invoiceNumber && <span className="font-mono tabular-nums"> · INV# {pulledSource.invoiceNumber}</span>}
              <span className="font-mono tabular-nums"> · {pulledSource.cart.reduce((s, c) => s + c.qty, 0)} pieces matched</span>
              {pulledSource.unmatchedCount > 0 && (
                <div className="mt-1 text-[var(--warn-text)]">
                  {pulledSource.unmatchedCount} line item{pulledSource.unmatchedCount === 1 ? "" : "s"} have no matching SKU in the parts library:{" "}
                  {pulledSource.unmatchedDescriptions.join(", ")}
                </div>
              )}
            </div>
            <button type="button" onClick={p.onDismissBanner} className="shrink-0 text-sm font-semibold text-muted hover:text-text cursor-pointer min-h-[44px] px-2">
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Settings */}
      <section className={`${CARD} space-y-3 min-w-0`} aria-labelledby="lb-settings-heading">
        <h2 id="lb-settings-heading" className="text-sm font-semibold text-text">
          Settings
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            Trailer
            <select value={p.trailerTypeKey} onChange={(e) => p.onTrailerTypeChange(e.target.value)} disabled={p.locked} className={SELECT}>
              {p.trailerTypeKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            Runners
            <select value={p.runnerHeight} onChange={(e) => p.onRunnerHeightChange(Number(e.target.value))} disabled={p.locked} className={SELECT}>
              {p.runnerHeightOptions.map((rh) => (
                <option key={rh} value={rh}>
                  {rh === 0 ? "None" : `${rh}″`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Toggle
          label="Auto-downsize last trailer"
          hint="Use a 26ft box truck when the last load fits one."
          value={p.autoDownsize}
          disabled={p.locked}
          onChange={p.onAutoDownsizeChange}
        />
        <Toggle
          label="Mix stacks to save trucks"
          hint="Top off stacks only when it saves a whole truck. Off = pure stacks only."
          value={p.consolidate}
          disabled={p.locked}
          onChange={p.onConsolidateChange}
        />
        <button type="button" onClick={p.onCalculate} disabled={!p.hasSource} className={`${BTN_PRIMARY} w-full`}>
          <Calculator size={16} aria-hidden="true" /> Calculate load
        </button>
      </section>
    </div>
  );
}
