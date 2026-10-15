"use client";
// src/components/qc/DensityCalculatorModal.tsx — qc-01
// Toolbar popup on /v2/qc with parity to legacy qc/density-calculator.html: L/W/H (in), weight (lb),
// optional target density (lb/ft³). Live results via lib/qc/board (calcDensity + densityVsTarget,
// 3-decimal Math.round rounding like legacy). The form lives in a child that Modal unmounts on
// close, so every field resets when the popup closes.
import { useState } from "react";
import Modal from "@/components/Modal";
import { calcDensity, densityVsTarget, fmt3 } from "@/lib/qc/board";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

// Empty → null; anything else → a number (NaN when unparsable), so callers can tell "blank" from "bad".
function parse(v: string): number | null {
  const t = v.trim();
  return t === "" ? null : Number(t);
}

const VERDICT: Record<"above" | "below" | "on", { label: string; cls: string }> = {
  on: { label: "On target", cls: "bg-[var(--loaded-bg)] text-[var(--loaded-text)] border-[var(--loaded-border)]" },
  above: { label: "Above target", cls: "bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]" },
  below: { label: "Below target", cls: "bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]" },
};

function signed(n: number, text: string): string {
  return n >= 0 ? `+${text}` : text;
}

function Field({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-semibold text-muted">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-h-[44px] px-3 rounded-lg border border-[var(--border)] bg-surface text-text font-mono text-sm focus:outline-hidden focus:border-[var(--brand)]"
      />
    </div>
  );
}

function DensityForm() {
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [target, setTarget] = useState("");

  const l = parse(length);
  const w = parse(width);
  const h = parse(height);
  const lb = parse(weight);
  const result = l !== null && w !== null && h !== null && lb !== null ? calcDensity(lb, l, w, h) : null;

  const t = parse(target);
  const targetInvalid = t !== null && !(Number.isFinite(t) && t > 0);
  const cmp = result && t !== null && !targetInvalid ? densityVsTarget(result.density, t) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field id="qc-density-length" label="Length (in)" value={length} onChange={setLength} />
        <Field id="qc-density-width" label="Width (in)" value={width} onChange={setWidth} />
        <Field id="qc-density-height" label="Height (in)" value={height} onChange={setHeight} />
        <Field id="qc-density-weight" label="Weight (lb)" value={weight} onChange={setWeight} />
        <div className="col-span-2 space-y-1">
          <Field id="qc-density-target" label="Target density (lb/ft³, optional)" value={target} onChange={setTarget} />
          {targetInvalid && <p className="text-xs text-[var(--warn-text)]">Target must be greater than 0.</p>}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--ghost-bg)] p-4 space-y-2" aria-live="polite">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Density</div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold font-mono tabular-nums text-text">
            {result ? fmt3(result.density) : "—"}
          </span>
          <span className="text-sm text-muted">lb/ft³</span>
        </div>
        <div className="text-xs text-muted font-mono tabular-nums">
          {result
            ? `${result.cubicInches.toLocaleString("en-US", { maximumFractionDigits: 3 })} in³ · ${fmt3(result.cubicFeet)} ft³`
            : "— in³ · — ft³"}
        </div>

        {cmp && (
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[var(--line)]">
            <span className="text-xs text-muted">
              Variance{" "}
              <strong className="font-mono tabular-nums text-text">
                {signed(cmp.variance, cmp.variance.toFixed(3))} lb/ft³
              </strong>{" "}
              <span className="font-mono tabular-nums">({signed(cmp.variancePct, cmp.variancePct.toFixed(1))}%)</span>
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${VERDICT[cmp.verdict].cls}`}
            >
              {VERDICT[cmp.verdict].label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DensityCalculatorModal({ isOpen, onClose }: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Density calculator" size="md">
      <DensityForm />
    </Modal>
  );
}
