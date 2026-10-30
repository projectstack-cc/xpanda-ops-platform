"use client";
// src/components/blockCalc/BlockCalculator.tsx — blk-01
// /v2/blocks/calculator: v2 port of manufacturing/block-calculator.html (inputs, library pick,
// engine, results + cut list). Building this as: block-cut calculator for a cutting lead on a tablet
// or laptop (phone secondary), dense + industrial, inputs left / results right.
// Calc = validate() + runFullCalc() only (lib/blockCalc/cutList.ts, lib/blockEngine.ts). Legacy
// parity wins over the mockup: combined utilization, waste in in³, Main Line always on, one cut-list
// row per axis with n > 0. State is in-memory only (legacy keeps nothing).
// Narrow fallback (< 768px): one column; Secondary parts + Options collapse to a one-line summary,
// Calculate is full width under the inputs, the cut list renders as stacked cards.
import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, Library, Plus, X } from "lucide-react";
import { useLang } from "@/components/lang";
import LangSelect from "@/components/LangSelect";
import MetricTile from "@/components/dashboard/MetricTile";
import SearchPickerModal, { type SearchPickerItem } from "@/components/SearchPickerModal";
import { loadPartsLibrary } from "@/lib/partsCache";
import type { Part } from "@/lib/partMatch";
import { runFullCalc, type BlockCalcResult, type OrientationMode } from "@/lib/blockEngine";
import {
  buildCutListRows,
  orientNote,
  stats,
  validate,
  type Axis,
  type CutListRow,
  type LibPartRef,
  type MachineName,
  type Routing,
  type ZoneName,
} from "@/lib/blockCalc/cutList";

// ─── helpers ────────────────────────────────────────────────────────────────

// translate() has no {var} filling — replace {name} tokens locally.
function fmt(str: string, vars: Record<string, string | number> = {}): string {
  return str.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

// The two autoOrient* strings carry legacy's <strong> / &nbsp; markup — render those, nothing else.
function rich(str: string): ReactNode[] {
  return str
    .replace(/&nbsp;/g, " ")
    .split(/<strong>(.*?)<\/strong>/)
    .map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

const AXIS_KEY: Record<Axis, string> = {
  Length: "blockCalc.axisLength",
  Width: "blockCalc.axisWidth",
  Height: "blockCalc.axisHeight",
};
const MACHINE_KEY: Record<MachineName, string> = {
  "Cross Cutter": "blockCalc.machineCrossCutter",
  "Main Line": "blockCalc.machineMainLine",
  "Blue Line": "blockCalc.machineBlueLine",
};
const ZONE_KEY: Record<ZoneName, string> = {
  "L-end": "blockCalc.zoneLRemnant",
  "W-end": "blockCalc.zoneWRemnant",
  "H-end": "blockCalc.zoneHRemnant",
};
const MACHINE_CHIP: Record<MachineName, string> = {
  "Cross Cutter": "bg-[var(--loading-bg)] text-[var(--loading-text)] border-[var(--loading-border)]",
  "Main Line": "bg-[var(--info-bg)] text-[var(--info-text)] border-[var(--info-border)]",
  "Blue Line": "bg-[var(--ghost-bg)] text-text border-[var(--border)]",
};
const REROUTED_CHIP = "bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]";
const UTIL_FILL: Record<"good" | "warn" | "danger", string> = {
  good: "bg-[var(--success-bg)]",
  warn: "bg-[var(--live-yellow)]",
  danger: "bg-[var(--danger-bg)]",
};

const PRESETS = [
  { id: "std50", key: "blockCalc.presetStandard50", L: "199", W: "50", H: "50" },
  { id: "std58", key: "blockCalc.presetStandard58", L: "199", W: "50", H: "58" },
] as const;
type PresetId = (typeof PRESETS)[number]["id"] | "custom";

const DEFAULT_KERF = "0.079";

const fmtSpacing = (n: number) => `${n.toFixed(3)}"`;
const fmtRemnant = (n: number) => (n < 0.005 ? '0"' : `${n.toFixed(2)}"`);

interface LibPick {
  id: string;
  part_number: string;
  name: string;
  customer: string;
}

interface SecState {
  id: string;
  label: string;
  L: string;
  W: string;
  H: string;
  qty: string;
  lib: LibPick | null;
}

interface CalcView {
  calc: BlockCalcResult;
  rows: CutListRow[];
}

// ─── small kit pieces ───────────────────────────────────────────────────────

const CARD = "rounded-xl border border-[var(--card-border)] bg-surface p-4 space-y-3";
const H2 = "text-xs font-bold uppercase tracking-wider text-muted";
const INPUT =
  "w-full min-h-[44px] px-3 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] text-text font-mono text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const GHOST_BTN =
  "inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg border border-[var(--border)] bg-surface text-sm font-semibold text-text hover:bg-[var(--ghost-bg)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const PRIMARY_BTN =
  "inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:bg-[var(--brand-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const ICON_BTN =
  "inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-muted hover:text-text hover:bg-[var(--ghost-bg)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

function Field({
  id,
  label,
  value,
  onChange,
  numeric = false,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1 min-w-0">
      <label htmlFor={id} className="block text-xs font-semibold text-muted truncate">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode={numeric ? "numeric" : "decimal"}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      />
    </div>
  );
}

function PartChip({ part, onClear, clearLabel }: { part: LibPick; onClear: () => void; clearLabel: string }) {
  const sub = [part.name, part.customer].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--ghost-bg)] pl-3 text-sm min-w-0">
      <span className="min-w-0 truncate">
        <strong className="font-mono">{part.part_number}</strong>
        {sub && <span className="text-muted"> · {sub}</span>}
      </span>
      <button type="button" onClick={onClear} className={ICON_BTN} aria-label={clearLabel} title={clearLabel}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

// Phone-only one-line summary that expands its section; md+ always shows the section.
function Collapsible({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="md:hidden w-full flex items-center justify-between gap-3 min-h-[44px] px-4 rounded-xl border border-[var(--card-border)] bg-surface text-left text-sm font-semibold text-text cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <span className="shrink-0">{title}</span>
        <span className="flex items-center gap-1 min-w-0 font-normal text-muted">
          <span className="truncate">{summary}</span>
          <ChevronDown size={16} aria-hidden="true" className={`shrink-0 ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      <div className={open ? "" : "hidden md:block"}>{children}</div>
    </div>
  );
}

// ─── main ───────────────────────────────────────────────────────────────────

export default function BlockCalculator() {
  const { t } = useLang();

  const [bL, setBL] = useState("");
  const [bW, setBW] = useState("");
  const [bH, setBH] = useState("");
  const [preset, setPreset] = useState<PresetId | null>(null);

  const [pL, setPL] = useState("");
  const [pW, setPW] = useState("");
  const [pH, setPH] = useState("");
  const [pQty, setPQty] = useState("");
  const [primaryLib, setPrimaryLib] = useState<LibPick | null>(null);

  const [secs, setSecs] = useState<SecState[]>([]);
  const secCounter = useRef(0);

  const [kerf, setKerf] = useState(DEFAULT_KERF);
  const [mode, setMode] = useState<OrientationMode>("auto");
  const [routing, setRouting] = useState<Routing>({ crossCutter: true, blueLine: true });

  const [secOpen, setSecOpen] = useState(false);
  const [optOpen, setOptOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<CalcView | null>(null);

  const [pickFor, setPickFor] = useState<"primary" | string | null>(null);
  const [parts, setParts] = useState<Part[] | null>(null);
  const [partsError, setPartsError] = useState<string | null>(null);

  const resultsRef = useRef<HTMLElement>(null);
  const blockLRef = useRef<HTMLDivElement>(null);

  // ── block size ──
  function pickPreset(p: (typeof PRESETS)[number]) {
    setBL(p.L);
    setBW(p.W);
    setBH(p.H);
    setPreset(p.id);
  }
  function typeBlock(set: (v: string) => void) {
    return (v: string) => {
      set(v);
      setPreset(null);
    };
  }

  // ── primary ── (typing a dim drops the library part, as legacy)
  function typePrimary(set: (v: string) => void) {
    return (v: string) => {
      set(v);
      setPrimaryLib(null);
    };
  }

  // ── secondaries ──
  const secLabel = (s: SecState, i: number) => s.label.trim() || fmt(t("blockCalc.secondaryDefaultLabel"), { n: i + 1 });

  function addSecondary() {
    const id = `sec-${++secCounter.current}`;
    setSecs((xs) => [...xs, { id, label: "", L: "", W: "", H: "", qty: "", lib: null }]);
    setSecOpen(true);
  }
  function patchSec(id: string, patch: Partial<SecState>) {
    setSecs((xs) => xs.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function removeSec(id: string) {
    setSecs((xs) => xs.filter((s) => s.id !== id));
  }

  // ── library ──
  async function openPicker(target: "primary" | string) {
    setPickFor(target);
    if (parts) return;
    setPartsError(null);
    try {
      setParts(await loadPartsLibrary());
    } catch {
      setPartsError(t("blockCalc.partsLoadError"));
    }
  }
  function onPick(partId: string) {
    const part = parts?.find((p) => p.id === partId);
    if (!part || !pickFor) return;
    const pick: LibPick = {
      id: part.id,
      part_number: part.part_number,
      name: part.name ?? "",
      customer: part.customer ?? "",
    };
    const L = String(part.length_in), W = String(part.width_in), H = String(part.height_in);
    if (pickFor === "primary") {
      setPL(L);
      setPW(W);
      setPH(H);
      setPrimaryLib(pick);
    } else {
      patchSec(pickFor, { L, W, H, lib: pick });
    }
    setPickFor(null);
  }
  const pickerItems: SearchPickerItem[] = (parts ?? []).map((p) => ({
    id: p.id,
    primary: p.part_number,
    secondary: [p.name, p.customer, `${p.length_in} × ${p.width_in} × ${p.height_in}`].filter(Boolean).join(" · "),
  }));

  // ── calculate / reset ──
  function calculate() {
    const res = validate({
      bL, bW, bH, pL, pW, pH, kerf, primaryQty: pQty, mode,
      secondaries: secs.map((s, i) => ({ id: s.id, label: secLabel(s, i), L: s.L, W: s.W, H: s.H, qty: s.qty })),
    });
    if (!res.ok) {
      setError(fmt(t(res.key), res.vars));
      setView(null);
      return;
    }
    const calc = runFullCalc(res.input);
    if (calc.primary.total === 0) {
      setError(t("blockCalc.noPartsFitError"));
      setView(null);
      return;
    }
    const primaryRef: LibPartRef | null = primaryLib;
    const secRefs: Record<string, LibPartRef | null> = {};
    for (const s of secs) secRefs[s.id] = s.lib;
    setError(null);
    setView({ calc, rows: buildCutListRows(calc, routing, primaryRef, secRefs) });
    if (window.innerWidth <= 640) {
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
  }

  function reset() {
    setBL(""); setBW(""); setBH(""); setPreset(null);
    setPL(""); setPW(""); setPH(""); setPQty(""); setPrimaryLib(null);
    setSecs([]);
    setKerf(DEFAULT_KERF);
    setMode("auto");
    setRouting({ crossCutter: true, blueLine: true });
    setError(null);
    setView(null);
    blockLRef.current?.querySelector("input")?.focus();
  }

  // ── summaries for the phone collapse ──
  const secSummary = secs.length
    ? secs.map((s, i) => secLabel(s, i)).join(", ")
    : t("blockCalc.secondaryNone");
  const machinesOn = 1 + (routing.crossCutter ? 1 : 0) + (routing.blueLine ? 1 : 0);
  const optSummary = [
    mode === "auto" ? t("blockCalc.modeAuto") : t("blockCalc.modeFixed"),
    `kerf ${kerf || "0"}`,
    fmt(t("blockCalc.machinesOn"), { n: machinesOn }),
  ].join(" · ");

  const machineToggles: { name: MachineName; cuts: string; on: boolean; locked: boolean; toggle?: () => void }[] = [
    {
      name: "Cross Cutter", cuts: t("blockCalc.lengthCuts"), on: routing.crossCutter, locked: false,
      toggle: () => setRouting((r) => ({ ...r, crossCutter: !r.crossCutter })),
    },
    { name: "Main Line", cuts: t("blockCalc.widthCuts"), on: true, locked: true },
    {
      name: "Blue Line", cuts: t("blockCalc.heightCuts"), on: routing.blueLine, locked: false,
      toggle: () => setRouting((r) => ({ ...r, blueLine: !r.blueLine })),
    },
  ];

  const calcButtons = (full: boolean) => (
    <div className={full ? "grid grid-cols-[1fr_2fr] gap-2" : "flex items-center gap-2"}>
      <button type="button" onClick={reset} className={GHOST_BTN}>
        {t("blockCalc.resetBtn")}
      </button>
      <button type="submit" form="blockcalc-form" className={PRIMARY_BTN}>
        {t("blockCalc.calculateBtn")}
      </button>
    </div>
  );

  return (
    <main className="flex-1 w-full max-w-screen-2xl mx-auto px-4 py-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-text">{t("blockCalc.bcBarTitle")}</h1>
          <p className="text-sm text-muted">{t("blockCalc.pageSubtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LangSelect />
          <div className="hidden md:block">{calcButtons(false)}</div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] items-start">
        {/* ── inputs ── */}
        <form
          id="blockcalc-form"
          aria-label="Inputs"
          className="space-y-4 min-w-0"
          onSubmit={(e) => {
            e.preventDefault();
            calculate();
          }}
        >
          <section className={CARD}>
            <h2 className={H2}>{t("blockCalc.blockSizeTitle")}</h2>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={preset === p.id}
                  onClick={() => pickPreset(p)}
                  className={`min-h-[52px] px-2 rounded-lg text-xs font-semibold text-text cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                    preset === p.id ? "border-2 border-[var(--brand)] bg-[var(--accent-soft)]" : "border border-[var(--border)] bg-surface hover:bg-[var(--ghost-bg)]"
                  }`}
                >
                  {t(p.key)}
                  <span className="block font-mono font-normal text-[11px] text-muted tabular-nums">
                    {p.W}×{p.H}×{p.L}
                  </span>
                </button>
              ))}
              <button
                type="button"
                aria-pressed={preset === "custom"}
                onClick={() => {
                  setPreset("custom");
                  blockLRef.current?.querySelector("input")?.focus();
                }}
                className={`min-h-[52px] px-2 rounded-lg text-xs font-semibold text-text cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  preset === "custom" ? "border-2 border-[var(--brand)] bg-[var(--accent-soft)]" : "border border-[var(--border)] bg-surface hover:bg-[var(--ghost-bg)]"
                }`}
              >
                {t("blockCalc.custom")}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div ref={blockLRef}>
                <Field id="blk-bL" label={t("blockCalc.lengthLabel")} value={bL} onChange={typeBlock(setBL)} placeholder="199" />
              </div>
              <Field id="blk-bW" label={t("blockCalc.widthLabel")} value={bW} onChange={typeBlock(setBW)} placeholder="50" />
              <Field id="blk-bH" label={t("blockCalc.heightLabel")} value={bH} onChange={typeBlock(setBH)} placeholder="50" />
            </div>
          </section>

          <section className={CARD}>
            <div className="flex items-center justify-between gap-2">
              <h2 className={H2}>{t("blockCalc.primaryPartTitle")}</h2>
              <button type="button" onClick={() => openPicker("primary")} className={GHOST_BTN}>
                <Library size={14} className="text-muted" aria-hidden="true" />
                {t("blockCalc.pickFromLibrary")}
              </button>
            </div>
            {primaryLib && (
              <PartChip part={primaryLib} onClear={() => setPrimaryLib(null)} clearLabel={t("blockCalc.clearLibSelection")} />
            )}
            <div className="grid grid-cols-4 gap-2">
              <Field id="blk-pL" label={t("blockCalc.lengthLabel")} value={pL} onChange={typePrimary(setPL)} />
              <Field id="blk-pW" label={t("blockCalc.widthLabel")} value={pW} onChange={typePrimary(setPW)} />
              <Field id="blk-pH" label={t("blockCalc.heightLabel")} value={pH} onChange={typePrimary(setPH)} />
              <Field id="blk-pQty" label={t("blockCalc.qty")} value={pQty} onChange={setPQty} numeric />
            </div>
            <p className="text-xs text-muted">{t("blockCalc.fractionHint")}</p>
            <a
              href="/v2/admin?tab=parts"
              className="inline-flex items-center min-h-[44px] text-sm font-semibold text-[var(--link)] hover:underline"
            >
              {t("blockCalc.manageParts")}
            </a>
          </section>

          <Collapsible
            title={`${t("blockCalc.secondaryPartsTitle")} · ${secs.length}`}
            summary={secSummary}
            open={secOpen}
            onToggle={() => setSecOpen((o) => !o)}
          >
            <div className="space-y-3">
              {secs.map((s, i) => (
                <section key={s.id} className={CARD} aria-label={fmt(t("blockCalc.secondaryPartN"), { n: i + 1 })}>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className={H2}>{fmt(t("blockCalc.secondaryPartN"), { n: i + 1 })}</h2>
                    <button type="button" onClick={() => removeSec(s.id)} className={GHOST_BTN}>
                      {t("blockCalc.removeBtn")}
                    </button>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor={`${s.id}-label`} className="block text-xs font-semibold text-muted">
                      {t("blockCalc.labelField")} <span className="font-normal">{t("blockCalc.optional")}</span>
                    </label>
                    <input
                      id={`${s.id}-label`}
                      type="text"
                      autoComplete="off"
                      value={s.label}
                      placeholder={t("blockCalc.secLabelPlaceholder")}
                      onChange={(e) => patchSec(s.id, { label: e.target.value })}
                      className={INPUT.replace("font-mono ", "")}
                    />
                  </div>
                  {s.lib ? (
                    <PartChip part={s.lib} onClear={() => patchSec(s.id, { lib: null })} clearLabel={t("blockCalc.clearLibSelection")} />
                  ) : (
                    <button type="button" onClick={() => openPicker(s.id)} className={GHOST_BTN}>
                      <Library size={14} className="text-muted" aria-hidden="true" />
                      {t("blockCalc.pickFromLibrary")}
                    </button>
                  )}
                  <div className="grid grid-cols-4 gap-2">
                    <Field id={`${s.id}-L`} label={t("blockCalc.lengthLabel")} value={s.L} onChange={(v) => patchSec(s.id, { L: v, lib: null })} />
                    <Field id={`${s.id}-W`} label={t("blockCalc.widthLabel")} value={s.W} onChange={(v) => patchSec(s.id, { W: v, lib: null })} />
                    <Field id={`${s.id}-H`} label={t("blockCalc.heightLabel")} value={s.H} onChange={(v) => patchSec(s.id, { H: v, lib: null })} />
                    <Field id={`${s.id}-qty`} label={t("blockCalc.qty")} value={s.qty} onChange={(v) => patchSec(s.id, { qty: v })} numeric placeholder={t("blockCalc.secQtyPlaceholder")} />
                  </div>
                </section>
              ))}
              <button type="button" onClick={addSecondary} className={`${GHOST_BTN} w-full`}>
                <Plus size={14} className="text-muted" aria-hidden="true" />
                {t("blockCalc.addSecondaryPartBtn").replace(/^\+\s*/, "")}
              </button>
            </div>
          </Collapsible>

          <Collapsible title={t("blockCalc.optionsTitle")} summary={optSummary} open={optOpen} onToggle={() => setOptOpen((o) => !o)}>
            <section className={CARD}>
              <h2 className={`${H2} hidden md:block`}>{t("blockCalc.optionsTitle")}</h2>
              <div className="space-y-1 max-w-[200px]">
                <label htmlFor="blk-kerf" className="block text-xs font-semibold text-muted">
                  {t("blockCalc.kerfLabel")}
                </label>
                <input
                  id="blk-kerf"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={kerf}
                  onChange={(e) => setKerf(e.target.value)}
                  className={INPUT}
                />
              </div>
              <p className="text-xs text-muted">{t("blockCalc.kerfHelp")}</p>

              <div className="space-y-1">
                <span className="block text-xs font-semibold text-muted">{t("blockCalc.partOrientationLabel")}</span>
                <div role="group" aria-label={t("blockCalc.partOrientationLabel")} className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--border)] bg-[var(--ghost-bg)] p-1">
                  {(["auto", "fixed"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={mode === m}
                      onClick={() => setMode(m)}
                      className={`min-h-[44px] px-2 rounded-md text-sm font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                        mode === m ? "bg-[var(--primary-bg)] text-[var(--primary-text)]" : "text-muted hover:text-text"
                      }`}
                    >
                      {m === "auto" ? t("blockCalc.modeAuto") : t("blockCalc.modeFixed")}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted">{t("blockCalc.orientHelp")}</p>
              </div>

              <div className="space-y-1">
                <span className="block text-xs font-semibold text-muted">{t("blockCalc.activeMachinesLabel")}</span>
                <p className="text-xs text-muted">{t("blockCalc.activeMachinesHelp")}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {machineToggles.map((m) => (
                    <button
                      key={m.name}
                      type="button"
                      aria-pressed={m.on}
                      disabled={m.locked}
                      onClick={m.toggle}
                      className={`min-h-[44px] px-3 rounded-lg border text-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                        m.locked ? "cursor-not-allowed" : "cursor-pointer"
                      } ${
                        m.on
                          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-text"
                          : "border-dashed border-[var(--border)] bg-surface text-muted line-through"
                      }`}
                    >
                      <span className="font-semibold">{t(MACHINE_KEY[m.name])}</span>{" "}
                      <span className="text-xs text-muted">· {m.locked ? t("blockCalc.alwaysOn") : m.cuts}</span>
                    </button>
                  ))}
                </div>
                {!routing.crossCutter && (
                  <p className="text-xs rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] px-3 py-2">
                    {t("blockCalc.rerouteCrossNote")}
                  </p>
                )}
                {!routing.blueLine && (
                  <p className="text-xs rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] px-3 py-2">
                    {t("blockCalc.rerouteBlueNote")}
                  </p>
                )}
              </div>
            </section>
          </Collapsible>

          <div className="md:hidden">{calcButtons(true)}</div>
        </form>

        {/* ── results ── */}
        <section ref={resultsRef} aria-label={t("blockCalc.resultsTitle")} className="space-y-4 min-w-0 scroll-mt-4">
          {error && (
            <div role="alert" className="rounded-xl border border-[var(--danger-ink)] bg-surface px-4 py-3 text-sm font-semibold text-[var(--danger-ink)]">
              {error}
            </div>
          )}
          {view ? (
            <Results view={view} t={t} />
          ) : (
            !error && (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-surface p-10 text-center text-sm text-muted">
                {t("blockCalc.emptyResults")}
              </div>
            )
          )}
        </section>
      </div>

      <SearchPickerModal
        isOpen={pickFor !== null}
        onClose={() => setPickFor(null)}
        title={t("blockCalc.selectAPart")}
        items={pickerItems}
        onPick={onPick}
        loading={pickFor !== null && parts === null && !partsError}
        error={partsError}
        emptyText={t("blockCalc.noPartsMatch")}
        searchPlaceholder={t("blockCalc.partsSearchPlaceholder")}
      />
    </main>
  );
}

// ─── results ────────────────────────────────────────────────────────────────

function Results({ view, t }: { view: CalcView; t: (key: string) => string }) {
  const { calc, rows } = view;
  const s = stats(calc);
  const note = orientNote(calc);
  const axis = (a: Axis) => t(AXIS_KEY[a]);
  const n = (x: number) => x.toLocaleString();

  const machineCell = (r: CutListRow) => (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`inline-flex px-2 py-0.5 rounded-full border text-xs font-semibold whitespace-nowrap ${r.machine_rerouted ? REROUTED_CHIP : MACHINE_CHIP[r.machine]}`}>
        {t(MACHINE_KEY[r.machine])}
      </span>
      {r.machine_rerouted && r.machine_rerouted_from && (
        <span className="text-[11px] text-[var(--warn-text)] whitespace-nowrap">
          {fmt(t("blockCalc.fromMachine"), { machine: t(MACHINE_KEY[r.machine_rerouted_from]) })}
        </span>
      )}
    </span>
  );
  const dirCell = (r: CutListRow) => (
    <>
      {axis(r.direction)}
      {r.remapFrom && <span className="ml-1 text-xs text-[var(--info-text)]">{fmt(t("blockCalc.fromPart"), { axis: axis(r.remapFrom) })}</span>}
    </>
  );
  const partCell = (r: CutListRow) =>
    r.zone ? (
      <>
        {r.sec_label} <span className="text-[11px] text-muted">({t(ZONE_KEY[r.zone])})</span>
      </>
    ) : (
      <>
        <strong>{t("blockCalc.primaryPartLabel")}</strong>
        {r.part_number && <span className="ml-1 font-mono text-xs text-muted">{r.part_number}</span>}
      </>
    );

  return (
    <>
      {note && (
        <div className="rounded-xl border border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info-text)] px-4 py-3 text-sm">
          {note === "identity"
            ? rich(t("blockCalc.autoOrientOptimal"))
            : rich(
                fmt(t("blockCalc.autoOrientSelected"), {
                  axisL: axis(note.L.name), dimL: note.L.dim,
                  axisW: axis(note.W.name), dimW: note.W.dim,
                  axisH: axis(note.H.name), dimH: note.H.dim,
                })
              )}
        </div>
      )}

      <div className={CARD}>
        <h2 className={H2}>{t("blockCalc.resultsTitle")}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
          <MetricTile label={t("blockCalc.statPartsPerBlock")} value={n(s.partsPerBlock)} caption={`${s.nL} × ${s.nW} × ${s.nH}`} />
          <MetricTile label={t("blockCalc.statUtilization")} value={s.utilPct.toFixed(1)} unit="%" tone={s.utilTone === "good" ? "default" : "warn"} />
          <MetricTile label={t("blockCalc.statWaste")} value={n(s.waste)} />
          {s.blocksNeeded !== null && <MetricTile label={t("blockCalc.statBlocksNeeded")} value={n(s.blocksNeeded)} />}
          {s.primaryProduced && (
            <MetricTile
              label={t("blockCalc.statPrimaryProduced")}
              value={n(s.primaryProduced.produced)}
              caption={fmt(t("blockCalc.surplusNeeded"), { surplus: s.primaryProduced.surplus, needed: n(s.primaryProduced.needed) })}
            />
          )}
          {s.secondaryOrdered.map((o, i) => (
            <MetricTile
              key={i}
              label={fmt(t("blockCalc.secOrdered"), { label: o.label })}
              value={n(o.qty)}
              tone={o.surplus < 0 ? "warn" : "default"}
              caption={
                o.surplus >= 0
                  ? fmt(t("blockCalc.secProducedSurplus"), { produced: n(o.produced), surplus: o.surplus })
                  : fmt(t("blockCalc.secProducedShort"), { produced: n(o.produced), short: Math.abs(o.surplus) })
              }
            />
          ))}
          {s.secondaryTotal && (
            <MetricTile
              label={t("blockCalc.statSecondaryParts")}
              value={n(s.secondaryTotal.total)}
              caption={s.secondaryTotal.breakdown.map((b) => `${b.pieces} ${b.label}`).join(" + ")}
            />
          )}
        </div>
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-muted font-mono tabular-nums">
            {fmt(t("blockCalc.utilLabel"), { pct: s.utilPct.toFixed(1) })}
          </div>
          <div className="h-3 w-full rounded-full bg-[var(--ghost-bg)] border border-[var(--line)] overflow-hidden" aria-hidden="true">
            <div className={`h-full ${UTIL_FILL[s.utilTone]}`} style={{ width: `${Math.min(s.utilPct, 100).toFixed(1)}%` }} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--card-border)] bg-surface overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--line)] space-y-1">
          <h2 className="text-sm font-bold text-text">{t("blockCalc.cutListTitle")}</h2>
          {note && note !== "identity" && (
            <p className="text-xs text-muted">
              {fmt(t("blockCalc.orientMapNote"), { axisL: axis(note.L.name), axisW: axis(note.W.name), axisH: axis(note.H.name) })}
            </p>
          )}
        </div>

        {/* md+: table in a horizontal-scroll box */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--ghost-bg)] text-left text-xs font-semibold text-muted">
                <th className="px-3 py-2.5 w-10">{t("blockCalc.colStep")}</th>
                <th className="px-3 py-2.5">{t("blockCalc.colMachine")}</th>
                <th className="px-3 py-2.5">{t("blockCalc.colCutDirection")}</th>
                <th className="px-3 py-2.5">{t("blockCalc.colPart")}</th>
                <th className="px-3 py-2.5 text-right">{t("blockCalc.colPieces")}</th>
                <th className="px-3 py-2.5 text-right">{t("blockCalc.colSpacing")}</th>
                <th className="px-3 py-2.5 text-right">{t("blockCalc.colRemnant")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.step} data-testid="cut-row" className={`border-b border-[var(--line)] last:border-b-0 ${r.zone ? "bg-[var(--surface-2)]" : ""}`}>
                  <td className="px-3 py-2 font-mono tabular-nums text-muted">{r.step}</td>
                  <td className="px-3 py-2">{machineCell(r)}</td>
                  <td className="px-3 py-2">{dirCell(r)}</td>
                  <td className="px-3 py-2">{partCell(r)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{r.pieces}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtSpacing(r.spacing)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtRemnant(r.remnant)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* < md: stacked cards */}
        <ol className="md:hidden">
          {rows.map((r) => (
            <li key={r.step} data-testid="cut-card" className="px-4 py-3 border-t border-[var(--line)] first:border-t-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                {machineCell(r)}
                <span className="font-mono text-sm font-semibold tabular-nums whitespace-nowrap">
                  {r.pieces} <span className="text-xs font-normal text-muted">{t("blockCalc.colPieces")}</span>
                </span>
              </div>
              <div className="text-sm">
                <span className="font-mono text-xs text-muted mr-1">{r.step}.</span>
                {partCell(r)} <span className="text-muted">· {dirCell(r)}</span>
              </div>
              <div className="font-mono text-xs text-muted tabular-nums">
                {t("blockCalc.colSpacing")} {fmtSpacing(r.spacing)} · {t("blockCalc.colRemnant")} {fmtRemnant(r.remnant)}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <p className="text-sm text-muted">{t("blockCalc.comingNext")}</p>
    </>
  );
}
