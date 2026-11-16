"use client";
// src/components/blockCalc/BlockDiagrams.tsx — blk-02
// The Block Calculator's three cut diagrams (Front W × H, Top L × W, Side L × H) as SVG, from the
// pure geometry in lib/blockCalc/diagram.ts (legacy drawBlockView / buildDiagParams). Each card
// measures its own width (ResizeObserver, height budget 180 as legacy) and is a button that opens a
// zoomed copy in the shared Modal (closes only from its X — modal-01). Colors are tokens only.
import { useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal";
import type { BlockCalcResult } from "@/lib/blockEngine";
import { buildDiagParams, layoutView, type DiagAxis, type DiagParams, type ViewLayout } from "@/lib/blockCalc/diagram";

const AXIS_KEY: Record<DiagAxis, string> = {
  Length: "blockCalc.axisLength",
  Width: "blockCalc.axisWidth",
  Height: "blockCalc.axisHeight",
};
const VIEW_KEYS = ["blockCalc.frontView", "blockCalc.topView", "blockCalc.sideView"] as const;
const CARD_MAX_H = 180;

const FILL = {
  primary: { fill: "var(--info-bg)" },
  secondary: { fill: "var(--success-bg)", fillOpacity: 0.2 },
  remnant: { fill: "var(--danger-bg)", fillOpacity: 0.15 },
} as const;

function Swatch({ style }: { style: React.CSSProperties }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true" className="inline-block align-middle mr-1">
      <rect x="0.5" y="0.5" width="10" height="10" rx="2" style={{ ...style, stroke: "var(--border)" }} />
    </svg>
  );
}

function DiagramSvg({ v, title }: { v: ViewLayout; title: string }) {
  const lbl = (l: NonNullable<ViewLayout["labels"]["part"]>, color: string) => (
    <text
      x={l.x}
      y={l.y}
      textAnchor={l.anchor}
      dominantBaseline="middle"
      fontSize={l.size}
      fontFamily="Arial, sans-serif"
      transform={l.rotate ? `rotate(${l.rotate} ${l.x} ${l.y})` : undefined}
      style={{ fill: color }}
    >
      {l.text}
    </text>
  );
  return (
    <svg
      role="img"
      aria-label={title}
      viewBox={`0 0 ${v.width} ${v.height}`}
      width="100%"
      style={{ maxWidth: v.width, display: "block", margin: "0 auto" }}
    >
      <rect x={v.rem1Strip.x} y={v.rem1Strip.y} width={v.rem1Strip.w} height={v.rem1Strip.h} style={v.rem1Strip.secondary ? FILL.secondary : FILL.remnant} />
      <rect x={v.rem2Strip.x} y={v.rem2Strip.y} width={v.rem2Strip.w} height={v.rem2Strip.h} style={v.rem2Strip.secondary ? FILL.secondary : FILL.remnant} />
      {v.primary && <rect x={v.primary.x} y={v.primary.y} width={v.primary.w} height={v.primary.h} style={{ ...FILL.primary, stroke: "var(--info-border)", strokeWidth: 0.7 }} />}
      <g data-testid="grid-lines" style={{ stroke: "var(--info-border)", strokeWidth: 0.7 }}>
        {v.gridLines.map((l, i) => (
          <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
        ))}
      </g>
      <rect x={v.block.x} y={v.block.y} width={v.block.w} height={v.block.h} style={{ fill: "none", stroke: "var(--text-muted)", strokeWidth: 1.5 }} />
      <g style={{ stroke: "var(--danger-ink)", strokeWidth: 1, strokeDasharray: "4 3" }}>
        {v.separator1 && <line {...v.separator1} />}
        {v.separator2 && <line {...v.separator2} />}
      </g>
      {lbl(v.labels.dim1, "var(--text)")}
      {lbl(v.labels.dim2, "var(--text)")}
      {v.labels.part && lbl(v.labels.part, "var(--info-text)")}
      {v.labels.rem1 && <g data-testid="rem-label">{lbl(v.labels.rem1, "var(--danger-ink)")}</g>}
      {v.labels.rem2 && <g data-testid="rem-label">{lbl(v.labels.rem2, "var(--danger-ink)")}</g>}
    </svg>
  );
}

function DiagramCard({
  params,
  index,
  t,
  onOpen,
}: {
  params: DiagParams;
  index: number;
  t: (key: string) => string;
  onOpen: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const title = t(VIEW_KEYS[index]);
  const v = width > 0 ? layoutView(params, Math.max(width - 4, 140), CARD_MAX_H, t(AXIS_KEY[params.axis1]), t(AXIS_KEY[params.axis2])) : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="diagram-card"
      className="blockcalc-avoid flex flex-col gap-1 min-h-[44px] w-full min-w-0 p-2.5 rounded-lg border border-[var(--card-border)] bg-surface text-left cursor-zoom-in hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <div ref={wrapRef} className="w-full min-h-[120px] flex items-center">
        {v && <DiagramSvg v={v} title={title} />}
      </div>
      <span className="text-sm font-semibold text-text text-center w-full">{title}</span>
      <span className="text-xs text-muted text-center w-full no-print">{t("blockCalc.tapToZoom")}</span>
    </button>
  );
}

export default function BlockDiagrams({
  calc,
  t,
  printHidden,
}: {
  calc: BlockCalcResult;
  t: (key: string) => string;
  /** "Include diagrams in print" unchecked → the whole card is left out of print. */
  printHidden: boolean;
}) {
  const params = buildDiagParams(calc);
  const [zoom, setZoom] = useState<number | null>(null);
  const [zoomBox, setZoomBox] = useState({ w: 600, h: 400 });

  function open(i: number) {
    // Legacy sizes the zoom to 82% × 76% of the viewport; the shared Modal's xl panel caps the
    // content width (min(52.5rem, 92vw) less its 24px padding), so take the smaller of the two.
    // On a phone (< 640px the Modal is a full-width bottom sheet) legacy's 82% − 60 would draw the
    // zoom smaller than the card, so it uses the sheet's full content width instead.
    const vw = window.innerWidth;
    const panel = vw >= 640 ? Math.min(840, vw * 0.92) : vw;
    const w = Math.max(160, vw >= 640 ? Math.min(Math.floor(vw * 0.82) - 60, panel - 48) : panel - 48);
    const h = Math.max(160, Math.floor(window.innerHeight * 0.76) - 50);
    setZoomBox({ w, h });
    setZoom(i);
  }

  const zp = zoom !== null ? params[zoom] : null;
  const zv = zp ? layoutView(zp, zoomBox.w, zoomBox.h, t(AXIS_KEY[zp.axis1]), t(AXIS_KEY[zp.axis2])) : null;

  return (
    <section
      aria-label={t("blockCalc.cutDiagramsTitle")}
      data-testid="diagrams"
      className={`blockcalc-avoid rounded-xl border border-[var(--card-border)] bg-surface p-4 space-y-3 ${printHidden ? "no-print" : ""}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-text">{t("blockCalc.cutDiagramsTitle")}</h2>
        <p className="text-xs text-muted flex flex-wrap gap-x-3 gap-y-1">
          <span><Swatch style={FILL.primary} />{t("blockCalc.legendPrimary")}</span>
          <span><Swatch style={FILL.secondary} />{t("blockCalc.legendSecondary")}</span>
          <span><Swatch style={FILL.remnant} />{t("blockCalc.legendRemnant")}</span>
        </p>
      </div>
      <div className="blockcalc-diagram-grid grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {params.map((p, i) => (
          <DiagramCard key={i} params={p} index={i} t={t} onOpen={() => open(i)} />
        ))}
      </div>

      <div className="no-print">
        <Modal isOpen={zoom !== null} onClose={() => setZoom(null)} title={zoom !== null ? t(VIEW_KEYS[zoom]) : ""} size="xl">
          {zv && (
            <div data-testid="zoom-diagram">
              <DiagramSvg v={zv} title={t(VIEW_KEYS[zoom!])} />
            </div>
          )}
        </Modal>
      </div>
    </section>
  );
}
