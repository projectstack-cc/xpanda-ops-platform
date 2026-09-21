"use client";
// src/components/logistics/TextStyleToolbar.tsx
// bol-style-03: the one reusable text-style toolbar — no duplicated button markup between any
// future caller. Reads/writes a single field's style at its CURRENT scope (box, or the caret's
// active source line): size stepper (6-36 clamp, matches bolShared's resolveFieldLineStyle clamp,
// "Auto" clears back to the field default), B/I/U toggles, Box|Line scope switch (only shown when
// `supportsLines`), and Reset field. Tailwind from tokens only, every control >=44px (floor-use
// touch target), positioned by the caller (absolute, `left`/`top` come from bolEditorEngine's
// ActiveFieldInfo).
import type { BolTextStyle } from "@/lib/bolShared";

export interface TextStyleToolbarProps {
  value: BolTextStyle;
  onChange: (patch: Partial<BolTextStyle>) => void;
  scope: "box" | "line";
  onScopeChange: (scope: "box" | "line") => void;
  onReset: () => void;
  supportsLines: boolean;
  baseSize: number;
  left: number;
  top: number;
}

const btnBase =
  "min-h-[44px] min-w-[44px] px-2 rounded-md border border-[var(--border)] bg-[var(--card-bg)] text-text text-sm font-semibold cursor-pointer flex items-center justify-center";
const btnActive = "bg-[var(--brand)] text-white border-[var(--brand)]";

export default function TextStyleToolbar({
  value,
  onChange,
  scope,
  onScopeChange,
  onReset,
  supportsLines,
  baseSize,
  left,
  top,
}: TextStyleToolbarProps) {
  const size = value.size;

  function stepSize(delta: number) {
    const base = size != null ? size : baseSize;
    const next = Math.max(6, Math.min(36, Math.round(base) + delta));
    onChange({ size: next });
  }

  return (
    <div
      className="absolute z-30 flex flex-wrap items-center gap-1.5 p-1.5 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] shadow-lg max-w-[320px]"
      style={{ left: Math.max(0, left), top: Math.max(0, top - 52) }}
      // Never let a toolbar click steal focus from the field before its own click handler runs.
      onMouseDown={(e) => e.preventDefault()}
    >
      {supportsLines && (
        <div className="flex gap-0.5">
          {(["box", "line"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`${btnBase} min-w-0 px-2.5 text-xs ${scope === s ? btnActive : ""}`}
              onClick={() => onScopeChange(s)}
            >
              {s === "box" ? "Box" : "Line"}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-0.5">
        <button type="button" className={btnBase} aria-label="Decrease size" onClick={() => stepSize(-1)}>
          −
        </button>
        <span className="min-w-[2rem] text-center text-xs font-semibold text-text">{size != null ? size : `Auto (${baseSize})`}</span>
        <button type="button" className={btnBase} aria-label="Increase size" onClick={() => stepSize(1)}>
          +
        </button>
        <button
          type="button"
          className={`${btnBase} min-w-0 px-2.5 text-xs`}
          title="Reset size to the box default"
          onClick={() => onChange({ size: undefined })}
        >
          Auto
        </button>
      </div>

      <div className="flex gap-0.5">
        <button
          type="button"
          className={`${btnBase} font-extrabold ${value.bold ? btnActive : ""}`}
          aria-label="Bold"
          aria-pressed={!!value.bold}
          onClick={() => onChange({ bold: !value.bold })}
        >
          B
        </button>
        <button
          type="button"
          className={`${btnBase} italic ${value.italic ? btnActive : ""}`}
          aria-label="Italic"
          aria-pressed={!!value.italic}
          onClick={() => onChange({ italic: !value.italic })}
        >
          I
        </button>
        <button
          type="button"
          className={`${btnBase} underline ${value.underline ? btnActive : ""}`}
          aria-label="Underline"
          aria-pressed={!!value.underline}
          onClick={() => onChange({ underline: !value.underline })}
        >
          U
        </button>
      </div>

      <button type="button" className={`${btnBase} min-w-0 px-2.5 text-xs`} onClick={onReset}>
        Reset field
      </button>
    </div>
  );
}
