"use client";
// src/components/marina/FractionKeypad.tsx — marina-06
// Gloved-hand inch keypad for Marina inspection. Controlled (`state` is shown by the caller; `onKey`
// feeds keypad.ts applyKey). Every key ≥ 56px with ~10px gaps. Keys never take focus (pointerdown
// preventDefault + tabIndex -1), so a physical Enter can't also "click" the last-tapped key. With
// `keyboard`, a USB keyboard works too: digits, Backspace, Enter (= onNext), Escape (= clear), + / −
// (nudge). Keydowns from a textarea / input are left alone.
import { useEffect, useRef } from "react";
import { Delete } from "lucide-react";
import type { KeypadKey, KeypadState } from "@/lib/marina/keypad";

interface Props {
  state: KeypadState;
  onKey: (k: KeypadKey) => void;
  onNext?: () => void;
  nextLabel?: string;
  keyboard?: boolean;
  disabled?: boolean;
}

const FRACS: { f: string; glyph: string; name: string }[] = [
  { f: "1/8", glyph: "⅛", name: "one eighth" },
  { f: "1/4", glyph: "¼", name: "one quarter" },
  { f: "3/8", glyph: "⅜", name: "three eighths" },
  { f: "1/2", glyph: "½", name: "one half" },
  { f: "5/8", glyph: "⅝", name: "five eighths" },
  { f: "3/4", glyph: "¾", name: "three quarters" },
  { f: "7/8", glyph: "⅞", name: "seven eighths" },
];

const KEY =
  "flex items-center justify-center min-h-[56px] min-w-[56px] rounded-xl border text-xl font-bold select-none cursor-pointer touch-manipulation active:scale-[0.97] transition-transform disabled:opacity-50 disabled:cursor-not-allowed";
const DIGIT = `${KEY} bg-surface text-text border-[var(--input-border)] hover:bg-[var(--ghost-bg)]`;
const FRAC = `${KEY} bg-[var(--ghost-bg)] text-text border-[var(--input-border)] hover:bg-[var(--ghost-bg)]`;
const FRAC_ON = `${KEY} bg-[var(--brand)] text-white border-[var(--brand)]`;
const UTIL = `${KEY} bg-surface text-text border-[var(--input-border)] hover:bg-[var(--ghost-bg)] text-base`;

export default function FractionKeypad({ state, onKey, onNext, nextLabel = "Next", keyboard = true, disabled = false }: Props) {
  const handlers = useRef({ onKey, onNext });
  handlers.current = { onKey, onNext };

  useEffect(() => {
    if (!keyboard || disabled) return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      let k: KeypadKey | null = null;
      if (/^\d$/.test(e.key)) k = { kind: "digit", d: e.key };
      else if (e.key === "Backspace") k = { kind: "back" };
      else if (e.key === "Escape" || e.key === "Delete") k = { kind: "clear" };
      else if (e.key === "+") k = { kind: "nudge", sixteenths: 1 };
      else if (e.key === "-") k = { kind: "nudge", sixteenths: -1 };
      if (k) {
        e.preventDefault();
        handlers.current.onKey(k);
      } else if (e.key === "Enter") {
        e.preventDefault();
        handlers.current.onNext?.();
      }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [keyboard, disabled]);

  const press = (k: KeypadKey) => () => onKey(k);
  const noFocus = (e: React.PointerEvent) => e.preventDefault();
  const common = { type: "button" as const, tabIndex: -1, onPointerDown: noFocus, disabled };

  return (
    <div className="space-y-2.5" role="group" aria-label="Inch keypad">
      <div className="grid grid-cols-5 gap-2.5">
        {["7", "8", "9"].map((d) => <button key={d} {...common} className={DIGIT} onClick={press({ kind: "digit", d })}>{d}</button>)}
        {FRACS.slice(0, 2).map((x) => <FracKey key={x.f} x={x} on={state.frac === x.f} common={common} onKey={onKey} />)}
        {["4", "5", "6"].map((d) => <button key={d} {...common} className={DIGIT} onClick={press({ kind: "digit", d })}>{d}</button>)}
        {FRACS.slice(2, 4).map((x) => <FracKey key={x.f} x={x} on={state.frac === x.f} common={common} onKey={onKey} />)}
        {["1", "2", "3"].map((d) => <button key={d} {...common} className={DIGIT} onClick={press({ kind: "digit", d })}>{d}</button>)}
        {FRACS.slice(4, 6).map((x) => <FracKey key={x.f} x={x} on={state.frac === x.f} common={common} onKey={onKey} />)}
        <button {...common} className={`${DIGIT} col-span-2`} onClick={press({ kind: "digit", d: "0" })}>0</button>
        <button {...common} className={UTIL} onClick={press({ kind: "back" })} aria-label="Backspace">
          <Delete size={22} aria-hidden="true" />
        </button>
        <FracKey x={FRACS[6]} on={state.frac === FRACS[6].f} common={common} onKey={onKey} />
        <span aria-hidden="true" />
      </div>
      <div className="grid grid-cols-4 gap-2.5">
        <button {...common} className={UTIL} onClick={press({ kind: "nudge", sixteenths: -1 })} aria-label="Minus one sixteenth">−1/16</button>
        <button {...common} className={UTIL} onClick={press({ kind: "nudge", sixteenths: 1 })} aria-label="Plus one sixteenth">+1/16</button>
        <button {...common} className={UTIL} onClick={press({ kind: "clear" })}>Clear</button>
        {onNext ? (
          <button {...common} className={`${KEY} bg-[var(--brand)] text-white border-[var(--brand)] text-base`} onClick={() => onNext()}>
            {nextLabel}
          </button>
        ) : (
          <span aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

function FracKey({
  x, on, common, onKey,
}: {
  x: { f: string; glyph: string; name: string };
  on: boolean;
  common: { type: "button"; tabIndex: number; onPointerDown: (e: React.PointerEvent) => void; disabled: boolean };
  onKey: (k: KeypadKey) => void;
}) {
  return (
    <button {...common} className={on ? FRAC_ON : FRAC} aria-pressed={on} aria-label={x.name} onClick={() => onKey({ kind: "frac", f: x.f })}>
      {x.glyph}
    </button>
  );
}
