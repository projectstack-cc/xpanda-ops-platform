"use client";
// Production report (prod-c-04), computed client-side from the History view's HistoryData, so
// every History filter drives it. Four sections: output, block demold-weight control chart,
// expansion pcf consistency, bead aging vs demold weight. Control limits are I-MR statistical
// limits (lib/productionStats) — NOT spec limits; recipes carry no target weight or tolerance.
// Honest labelling: block weight is always "Demold weight (lbs, wet)" — this plant cuts green, so
// no density is ever derived from block weight. Print (landscape) + RFC 4180 CSV exports.
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLang } from "@/components/lang";
import { useTokenColors } from "@/components/charts/useTokenColors";
import { agingHours, type HistoryBatch, type HistoryBlock, type HistoryData } from "@/lib/productionHistory";
import { BUCKET_VOLUME_L, pcfFromBucket } from "@/lib/productionRecipes";
import { groupBy, imrLimits, mean, minMax, outOfLimits, pearson, MIN_MEANINGFUL_N, type ImrLimits } from "@/lib/productionStats";
import { downloadCsv, toCsv } from "@/lib/productionCsv";
import { BTN_GHOST, FIELD_CLASS, LABEL_CLASS } from "./ui";

interface Props {
  data: HistoryData;
  filterSummary: string;
}

// Hook fallbacks only (light-theme values) — the live colors come from the design tokens.
// danger → --danger-bg: --danger-text is the white text-on-danger color, invisible as a dot.
const TOKENS = {
  brand: { var: "--brand", fallback: "#e31837" },
  accent: { var: "--accent", fallback: "#0f172a" },
  muted: { var: "--muted", fallback: "#4b5563" },
  borderLight: { var: "--border-light", fallback: "#f3f4f6" },
  danger: { var: "--danger-bg", fallback: "#dc2626" },
  warn: { var: "--warn-text", fallback: "#92400e" },
  surface: { var: "--surface", fallback: "#ffffff" },
  text: { var: "--text", fallback: "#111827" },
  border: { var: "--border", fallback: "#e5e7eb" },
};

type GroupDim = "bead_type" | "density" | "block_type";

const CARD = "border border-border rounded p-4 space-y-3 bg-surface production-report-card";
const H2 = "text-base font-semibold text-text";
const CAPTION = "text-xs text-muted";
const TH = "px-2 py-1 text-xs font-semibold text-muted text-left whitespace-nowrap";
const TD = "px-2 py-1 text-sm text-text whitespace-nowrap font-mono tabular-nums";
const NOTE_WARN = "text-xs px-2 py-1 rounded border bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]";

const f = (v: number | null | undefined, dp: number) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(dp));
const beadKey = (s: string | null, t: string | null) => (s || t ? `${s ?? "—"} · ${t ?? "—"}` : "—");
const byCountDesc = <T,>(m: Map<string, T[]>) => Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);

export default function ReportView({ data, filterSummary }: Props) {
  const { t } = useLang();
  const c = useTokenColors(TOKENS);
  const [dim, setDim] = useState<GroupDim>("bead_type");
  const [ctrlType, setCtrlType] = useState("");
  const [pcfGroup, setPcfGroup] = useState("");
  const [agingType, setAgingType] = useState("");

  const blocks = data.blocks;
  const batches = data.batches;
  const tooltipStyle = { backgroundColor: c.surface, border: `1px solid ${c.border}`, color: c.text, fontSize: 12 };
  const axisProps = { stroke: c.muted, tick: { fontSize: 11, fill: c.muted } };

  // ---- 1. Output --------------------------------------------------------------------------
  const output = useMemo(() => {
    const blockKey = (b: HistoryBlock) =>
      dim === "bead_type" ? beadKey(b.bead_supplier, b.bead_type) : dim === "density" ? f(b.density, 2) : b.block_type ?? "—";
    const batchKey = (b: HistoryBatch) =>
      dim === "bead_type" ? beadKey(b.bead_supplier, b.bead_type) : dim === "density" ? f(b.density, 2) : null;
    const rows = new Map<string, { group: string; blocks: number; lbs: number; batches: number | null; kg: number | null }>();
    const row = (g: string) => {
      let r = rows.get(g);
      if (!r) {
        r = { group: g, blocks: 0, lbs: 0, batches: dim === "block_type" ? null : 0, kg: dim === "block_type" ? null : 0 };
        rows.set(g, r);
      }
      return r;
    };
    for (const b of blocks) {
      const r = row(blockKey(b));
      r.blocks += 1;
      r.lbs += b.block_weight_lbs ?? 0;
    }
    for (const b of batches) {
      const k = batchKey(b);
      if (k === null) continue; // block type applies to blocks only
      const r = row(k);
      r.batches = (r.batches ?? 0) + 1;
      r.kg = (r.kg ?? 0) + (b.weight_kg ?? 0);
    }
    return Array.from(rows.values()).sort((a, b) => a.group.localeCompare(b.group));
  }, [blocks, batches, dim]);

  const totals = {
    blocks: blocks.length,
    lbs: blocks.reduce((s, b) => s + (b.block_weight_lbs ?? 0), 0),
    batches: batches.length,
    kg: batches.reduce((s, b) => s + (b.weight_kg ?? 0), 0),
  };

  // ---- 2. Block demold-weight control, per block type --------------------------------------
  const byType = useMemo(() => groupBy(blocks, (b) => b.block_type ?? "—"), [blocks]);
  const typesByCount = byCountDesc(byType).map(([k]) => k);
  const ctrlKey = ctrlType && byType.has(ctrlType) ? ctrlType : typesByCount[0] ?? "";
  const ctrlStats = useMemo(
    () =>
      byCountDesc(byType).map(([type, rows]) => {
        const xs = rows.map((r) => r.block_weight_lbs).filter((v): v is number => v !== null && Number.isFinite(v));
        const lim = imrLimits(xs);
        const mm = minMax(xs);
        const dens = new Set(rows.map((r) => r.density).filter((d) => d !== null));
        return { type, rows, xs, lim, mm, out: outOfLimits(xs, lim).filter(Boolean).length, mixed: dens.size > 1 };
      }),
    [byType]
  );
  const ctrl = ctrlStats.find((s) => s.type === ctrlKey) ?? null;
  const ctrlPoints = useMemo(() => {
    if (!ctrl) return [];
    const pts = ctrl.rows.filter((r) => r.block_weight_lbs !== null && Number.isFinite(r.block_weight_lbs));
    const out = outOfLimits(pts.map((r) => r.block_weight_lbs as number), ctrl.lim);
    return pts.map((r, i) => ({
      seq: i + 1,
      y: r.block_weight_lbs as number,
      out: out[i],
      block_no: r.block_no ?? "—",
      date: r.log_date,
      lot: r.lot_no ?? "—",
    }));
  }, [ctrl]);

  // ---- 3. Expansion pcf consistency, per supplier · type · header density -----------------
  const pcfStats = useMemo(() => {
    const groups = groupBy(batches, (b) => `${beadKey(b.bead_supplier, b.bead_type)} · ${f(b.density, 2)}`);
    return byCountDesc(groups).map(([key, rows]) => {
      const pts = rows
        .map((r) => ({ r, pcf: pcfFromBucket(r.bucket_weight_g, r.bucket_volume_l ?? BUCKET_VOLUME_L) }))
        .filter((p): p is { r: HistoryBatch; pcf: number } => p.pcf !== null);
      const xs = pts.map((p) => p.pcf);
      const lim = imrLimits(xs);
      const target = rows[0]?.density ?? null;
      const m = mean(xs);
      return {
        key,
        pts,
        lim,
        target,
        mean: m,
        delta: m !== null && target !== null ? m - target : null,
        out: outOfLimits(xs, lim).filter(Boolean).length,
        excluded: rows.length - pts.length,
      };
    });
  }, [batches]);
  const pcfKey = pcfGroup && pcfStats.some((g) => g.key === pcfGroup) ? pcfGroup : pcfStats.find((g) => g.pts.length)?.key ?? "";
  const pcfSel = pcfStats.find((g) => g.key === pcfKey) ?? null;
  const pcfPoints = useMemo(() => {
    if (!pcfSel) return [];
    const out = outOfLimits(pcfSel.pts.map((p) => p.pcf), pcfSel.lim);
    return pcfSel.pts.map((p, i) => ({ seq: i + 1, y: p.pcf, out: out[i], date: p.r.log_date, lot: p.r.lot_no ?? "—" }));
  }, [pcfSel]);

  // ---- 4. Bead aging vs demold weight, per block type --------------------------------------
  const agingKey = agingType && byType.has(agingType) ? agingType : typesByCount[0] ?? "";
  const aging = useMemo(() => {
    const rows = byType.get(agingKey) ?? [];
    const pts = rows
      .map((r) => ({ x: agingHours(r.created_at, r.silo_full_at), y: r.block_weight_lbs, block_no: r.block_no ?? "—" }))
      .filter((p): p is { x: number; y: number; block_no: string } => p.x !== null && p.y !== null && Number.isFinite(p.y));
    const r = pts.length >= MIN_MEANINGFUL_N ? pearson(pts.map((p) => p.x), pts.map((p) => p.y)) : null;
    return { pts, excluded: rows.length - pts.length, r };
  }, [byType, agingKey]);

  // ---- CSV ----------------------------------------------------------------------------------
  function exportBlocks() {
    const cols = [
      "id", "session_id", "log_date", "block_type", "block_no", "block_size", "silo", "lot_no", "bead_supplier",
      "bead_type", "density", "silo_full_at", "rc_pct_open", "rc_speed", "virgin_pct_open", "virgin_speed",
      "mold_time", "block_weight_lbs", "operator_name", "created_at", "recipe_id", "recipe_version",
      "recipe_rc_pct_open", "recipe_rc_speed", "recipe_virgin_pct_open", "recipe_virgin_speed",
    ] as const;
    const rows = blocks.map((b) => [...cols.map((k) => b[k]), agingHours(b.created_at, b.silo_full_at)]);
    downloadCsv(`production-blocks_${data.range.from}_${data.range.to}.csv`, toCsv([...cols, "aging_h"], rows));
  }
  function exportBatches() {
    const cols = [
      "id", "session_id", "log_date", "bead_supplier", "bead_type", "density", "target_weight_g", "lot_no", "silo",
      "weight_kg", "heating_time_s", "bucket_weight_g", "bucket_volume_l", "operator_name", "created_at",
      "recipe_id", "recipe_version", "recipe_density", "recipe_heating_time_s",
    ] as const;
    const rows = batches.map((b) => [
      ...cols.map((k) => b[k]),
      pcfFromBucket(b.bucket_weight_g, b.bucket_volume_l ?? BUCKET_VOLUME_L),
    ]);
    downloadCsv(`production-batches_${data.range.from}_${data.range.to}.csv`, toCsv([...cols, "pcf"], rows));
  }

  // ---- shared chart bits --------------------------------------------------------------------
  function limitLines(lim: ImrLimits | null) {
    if (!lim) return null;
    const dash = lim.meaningful ? "6 4" : "2 6";
    const color = lim.meaningful ? c.warn : c.muted;
    return (
      <>
        <ReferenceLine y={lim.mean} stroke={c.muted} strokeWidth={1.5} label={{ value: t("production.report.meanShort"), fill: c.muted, fontSize: 11, position: "insideTopLeft" }} />
        {lim.ucl !== null && (
          <ReferenceLine y={lim.ucl} stroke={color} strokeDasharray={dash} label={{ value: "UCL", fill: c.muted, fontSize: 11, position: "insideTopLeft" }} />
        )}
        {lim.lcl !== null && (
          <ReferenceLine y={lim.lcl} stroke={color} strokeDasharray={dash} label={{ value: "LCL", fill: c.muted, fontSize: 11, position: "insideBottomLeft" }} />
        )}
      </>
    );
  }
  const limitNote = (lim: ImrLimits | null) =>
    lim && lim.n >= 2 && !lim.meaningful ? <p className={CAPTION}>{t("production.report.fewPoints")}</p> : null;
  const dot = (props: any) => {
    const { cx, cy, payload, index } = props;
    if (cx === undefined || cy === undefined) return <g key={`d-${index}`} />;
    return payload?.out ? (
      <circle key={`d-${index}`} cx={cx} cy={cy} r={5} fill={c.danger} stroke={c.surface} strokeWidth={1} />
    ) : (
      <circle key={`d-${index}`} cx={cx} cy={cy} r={2.5} fill={c.brand} />
    );
  };
  const typeSelect = (value: string, onChange: (v: string) => void, keys: string[], label: string) => (
    <label className="block max-w-xs no-print">
      <span className={LABEL_CLASS}>{label}</span>
      <select className={FIELD_CLASS + " cursor-pointer"} value={value} onChange={(e) => onChange(e.target.value)}>
        {keys.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
    </label>
  );

  const demoldLabel = t("production.report.demoldWet");

  if (!blocks.length && !batches.length) {
    return <p className="border border-border rounded px-4 py-6 text-sm text-muted">{t("production.report.noData")}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap gap-2">
        <button type="button" className={BTN_GHOST} onClick={() => window.print()}>
          {t("production.report.print")}
        </button>
        <button type="button" className={BTN_GHOST} onClick={exportBlocks} disabled={!blocks.length}>
          {t("production.report.blocksCsv")}
        </button>
        <button type="button" className={BTN_GHOST} onClick={exportBatches} disabled={!batches.length}>
          {t("production.report.batchesCsv")}
        </button>
      </div>

      <div className="production-print-region space-y-4">
        <p className="text-sm text-text">
          <span className="font-semibold">{t("production.report.title")}</span> ·{" "}
          <span className="font-mono tabular-nums">
            {data.range.from} → {data.range.to}
          </span>
          {filterSummary ? <> · {filterSummary}</> : null}
        </p>

        {/* 1. Output */}
        <section className={CARD}>
          <h2 className={H2}>{t("production.report.outputTitle")}</h2>
          <p className={CAPTION}>{t("production.report.outputCaption")}</p>
          <p className="text-sm text-muted">
            <span className="text-text font-semibold font-mono tabular-nums text-lg">{totals.blocks}</span>{" "}
            {t("production.today.blocksUnit")} ·{" "}
            <span className="text-text font-semibold font-mono tabular-nums text-lg">{totals.lbs.toFixed(1)}</span> {demoldLabel}
            <span className="mx-3 text-border">|</span>
            <span className="text-text font-semibold font-mono tabular-nums text-lg">{totals.batches}</span>{" "}
            {t("production.today.batchesUnit")} ·{" "}
            <span className="text-text font-semibold font-mono tabular-nums text-lg">{totals.kg.toFixed(1)}</span> kg
          </p>
          <label className="block max-w-xs no-print">
            <span className={LABEL_CLASS}>{t("production.report.groupBy")}</span>
            <select className={FIELD_CLASS + " cursor-pointer"} value={dim} onChange={(e) => setDim(e.target.value as GroupDim)}>
              <option value="bead_type">{t("production.report.dim.beadType")}</option>
              <option value="density">{t("production.report.dim.density")}</option>
              <option value="block_type">{t("production.report.dim.blockType")}</option>
            </select>
          </label>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={output} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid stroke={c.borderLight} vertical={false} />
                <XAxis dataKey="group" {...axisProps} />
                <YAxis yAxisId="count" allowDecimals={false} {...axisProps} />
                <YAxis yAxisId="lbs" orientation="right" {...axisProps} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: c.borderLight }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="count" dataKey="blocks" name={t("production.today.blocksUnit")} fill={c.brand} radius={[3, 3, 0, 0]} />
                <Bar yAxisId="lbs" dataKey="lbs" name={demoldLabel} fill={c.accent} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className={TH}>{t("production.report.col.group")}</th>
                  <th className={TH + " text-right"}>{t("production.today.blocksUnit")}</th>
                  <th className={TH + " text-right"}>{demoldLabel}</th>
                  <th className={TH + " text-right"}>{t("production.today.batchesUnit")}</th>
                  <th className={TH + " text-right"}>kg</th>
                </tr>
              </thead>
              <tbody>
                {output.map((r) => (
                  <tr key={r.group} className="border-b border-border">
                    <td className={TD + " font-sans"}>{r.group}</td>
                    <td className={TD + " text-right"}>{r.blocks}</td>
                    <td className={TD + " text-right"}>{r.lbs.toFixed(1)}</td>
                    <td className={TD + " text-right"}>{r.batches ?? "—"}</td>
                    <td className={TD + " text-right"}>{r.kg === null ? "—" : r.kg.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 2. Block demold-weight control chart */}
        <section className={CARD}>
          <h2 className={H2}>{t("production.report.ctrlTitle")}</h2>
          <p className={CAPTION}>{t("production.report.ctrlCaption")}</p>
          {ctrlStats.length === 0 ? (
            <p className="text-sm text-muted">{t("production.report.noBlocks")}</p>
          ) : (
            <>
              {typeSelect(ctrlKey, setCtrlType, typesByCount, t("production.newSheet.blockType"))}
              {ctrl?.mixed && <p className={NOTE_WARN}>{t("production.report.mixedDensity")}</p>}
              {limitNote(ctrl?.lim ?? null)}
              <div className="h-72">
                <ResponsiveContainer>
                  <LineChart data={ctrlPoints} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke={c.borderLight} />
                    <XAxis dataKey="seq" {...axisProps} />
                    <YAxis domain={["auto", "auto"]} {...axisProps} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={(_, p) => {
                        const d = p?.[0]?.payload;
                        return d ? `${d.block_no} · ${d.date} · ${t("production.field.lotNo")} ${d.lot}` : "";
                      }}
                    />
                    {limitLines(ctrl?.lim ?? null)}
                    <Line type="linear" dataKey="y" name={demoldLabel} stroke={c.brand} strokeWidth={1.5} dot={dot} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className={TH}>{t("production.newSheet.blockType")}</th>
                      <th className={TH + " text-right"}>n</th>
                      <th className={TH + " text-right"}>{t("production.report.col.mean")}</th>
                      <th className={TH + " text-right"}>{t("production.report.col.min")}</th>
                      <th className={TH + " text-right"}>{t("production.report.col.max")}</th>
                      <th className={TH + " text-right"}>σ̂ (I-MR)</th>
                      <th className={TH + " text-right"}>LCL</th>
                      <th className={TH + " text-right"}>UCL</th>
                      <th className={TH + " text-right"}>{t("production.report.col.out")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ctrlStats.map((s) => (
                      <tr key={s.type} className="border-b border-border">
                        <td className={TD + " font-sans"}>
                          {s.type}
                          {s.mixed && <span className="ml-1 text-[var(--warn-text)]" title={t("production.report.mixedDensity")}>*</span>}
                        </td>
                        <td className={TD + " text-right"}>{s.xs.length}</td>
                        <td className={TD + " text-right"}>{f(s.lim?.mean, 1)}</td>
                        <td className={TD + " text-right"}>{f(s.mm?.min, 1)}</td>
                        <td className={TD + " text-right"}>{f(s.mm?.max, 1)}</td>
                        <td className={TD + " text-right"}>{f(s.lim?.sigma, 2)}</td>
                        <td className={TD + " text-right"}>{f(s.lim?.lcl, 1)}</td>
                        <td className={TD + " text-right"}>{f(s.lim?.ucl, 1)}</td>
                        <td className={[TD, "text-right", s.out ? "text-[var(--danger-bg)] font-semibold" : ""].join(" ")}>{s.out}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {/* 3. Expansion pcf consistency */}
        <section className={CARD}>
          <h2 className={H2}>{t("production.report.pcfTitle")}</h2>
          <p className={CAPTION}>{t("production.report.pcfCaption")}</p>
          {pcfStats.length === 0 ? (
            <p className="text-sm text-muted">{t("production.report.noBatches")}</p>
          ) : (
            <>
              {typeSelect(pcfKey, setPcfGroup, pcfStats.map((g) => g.key), t("production.report.col.group"))}
              {limitNote(pcfSel?.lim ?? null)}
              {pcfSel && pcfSel.excluded > 0 && (
                <p className={CAPTION}>
                  {t("production.report.excludedNoBucket")}: <span className="font-mono tabular-nums">{pcfSel.excluded}</span>
                </p>
              )}
              <div className="h-72">
                <ResponsiveContainer>
                  <LineChart data={pcfPoints} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke={c.borderLight} />
                    <XAxis dataKey="seq" {...axisProps} />
                    <YAxis domain={["auto", "auto"]} {...axisProps} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={(_, p) => {
                        const d = p?.[0]?.payload;
                        return d ? `${d.date} · ${t("production.field.lotNo")} ${d.lot}` : "";
                      }}
                    />
                    {pcfSel?.target !== null && pcfSel?.target !== undefined && (
                      <ReferenceLine
                        y={pcfSel.target}
                        stroke={c.accent}
                        strokeWidth={1.5}
                        label={{ value: t("production.report.target"), fill: c.accent, fontSize: 11, position: "insideTopRight" }}
                      />
                    )}
                    {limitLines(pcfSel?.lim ?? null)}
                    <Line type="linear" dataKey="y" name="pcf" stroke={c.brand} strokeWidth={1.5} dot={dot} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className={TH}>{t("production.report.col.group")}</th>
                      <th className={TH + " text-right"}>n</th>
                      <th className={TH + " text-right"}>{t("production.report.col.targetPcf")}</th>
                      <th className={TH + " text-right"}>{t("production.report.col.meanPcf")}</th>
                      <th className={TH + " text-right"}>{t("production.report.col.delta")}</th>
                      <th className={TH + " text-right"}>σ̂ (I-MR)</th>
                      <th className={TH + " text-right"}>{t("production.report.col.out")}</th>
                      <th className={TH + " text-right"}>{t("production.report.col.excluded")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pcfStats.map((g) => (
                      <tr key={g.key} className="border-b border-border">
                        <td className={TD + " font-sans"}>{g.key}</td>
                        <td className={TD + " text-right"}>{g.pts.length}</td>
                        <td className={TD + " text-right"}>{f(g.target, 2)}</td>
                        <td className={TD + " text-right"}>{f(g.mean, 3)}</td>
                        <td className={TD + " text-right"}>
                          {g.delta === null ? "—" : `${g.delta >= 0 ? "+" : ""}${g.delta.toFixed(3)}`}
                        </td>
                        <td className={TD + " text-right"}>{f(g.lim?.sigma, 3)}</td>
                        <td className={[TD, "text-right", g.out ? "text-[var(--danger-bg)] font-semibold" : ""].join(" ")}>{g.out}</td>
                        <td className={TD + " text-right"}>{g.excluded}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {/* 4. Bead aging vs demold weight */}
        <section className={CARD}>
          <h2 className={H2}>{t("production.report.agingTitle")}</h2>
          <p className={CAPTION}>{t("production.report.agingCaption")}</p>
          {typesByCount.length === 0 ? (
            <p className="text-sm text-muted">{t("production.report.noBlocks")}</p>
          ) : (
            <>
              {typeSelect(agingKey, setAgingType, typesByCount, t("production.newSheet.blockType"))}
              <p className="text-sm text-muted">
                n = <span className="font-mono tabular-nums text-text">{aging.pts.length}</span> ·{" "}
                {t("production.report.excludedNoAging")}: <span className="font-mono tabular-nums text-text">{aging.excluded}</span>
                {aging.r !== null && (
                  <>
                    {" "}
                    · r = <span className="font-mono tabular-nums text-text">{aging.r.toFixed(2)}</span>{" "}
                    <span className="text-xs">({t("production.report.correlationOnly")})</span>
                  </>
                )}
              </p>
              <div className="h-72">
                <ResponsiveContainer>
                  <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke={c.borderLight} />
                    <XAxis type="number" dataKey="x" name={t("production.history.col.agingH")} {...axisProps} />
                    <YAxis type="number" dataKey="y" name={demoldLabel} domain={["auto", "auto"]} {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: "3 3", stroke: c.muted }} />
                    <Scatter data={aging.pts} fill={c.brand} isAnimationActive={false} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
