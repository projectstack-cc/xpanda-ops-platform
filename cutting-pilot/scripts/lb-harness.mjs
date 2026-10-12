// scripts/lb-harness.mjs
// lbr-01: Load Builder engine regression harness + baseline report (report-only).
//
// Runs every job cart in scripts/lb-fixtures.json (172 real orders exported from D1 2026-10-12)
// through BOTH load engines and writes Audits/lbr-01-engine-baseline.md:
//   - v2:     pack() from src/lib/packEngine.ts, 53ft Standard, DEFAULT_PACK_OPTIONS (no overrides)
//   - legacy: calcLoading() sliced out of logistics/load-builder.html and run in a node:vm context
//   - planner (lbr-02): planStacks() from src/lib/stackPlanner.ts, single-footprint Holey Board jobs only
// All results are normalized to trailers -> rows (nose->doors) -> columns -> layers (base first)
// and scored against the locked lbr engine rules (fewest trucks -> fewest top-offs -> <=2 sizes per
// stack, thinner on top -> thickest at nose / thinnest at doors).
//
// Row direction differs per engine (lbr-02 fix): v2's posFromFront 0 is the REAR/doors (packEngine.ts
// rowBaseThickness + simulate() row sort), so v2 rows sort DESCENDING; legacy's posFromFront 0 is the
// far wall/nose (load-builder.html's own FRONT label marks the doors), so legacy rows sort ascending.
//
// Run with: node scripts/lb-harness.mjs   (from cutting-pilot/; Node 22.6+/23.6+ strips
// packEngine's TypeScript syntax natively — no build step, no dependencies). Deterministic: the same
// fixtures produce a byte-identical report (the only date in it is the fixture's exportedAt).
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { pack, TRAILER_TYPES, DEFAULT_PACK_OPTIONS } from "../src/lib/packEngine.ts";
import { planStacks } from "../src/lib/stackPlanner.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", ".."); // cutting-pilot/scripts -> cutting-pilot -> repo root
const fixtures = JSON.parse(readFileSync(join(here, "lb-fixtures.json"), "utf8"));
const AUDIT_PATH = join(repoRoot, "Audits", "lbr-01-engine-baseline.md");

const TRAILER_KEY = "53ft Standard";
const TRAILER_LIMIT = 20;
const EPS = 1e-6;

// --- SKU coercion: verbatim copy of jobPull.ts's (unexported) coerceSku ---
function coerceSku(raw) {
  const length = Number(raw?.length);
  const width = Number(raw?.width);
  const height = Number(raw?.height);
  const weight = Number(raw?.weight);
  if (!raw?.id || !Number.isFinite(length) || length <= 0 || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  return {
    id: String(raw.id),
    name: String(raw.name || raw.sku || raw.id),
    sku: String(raw.sku || ""),
    length,
    width,
    height,
    weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
    category: raw.category || undefined,
    allowRotation: !!raw.allowRotation,
    bundleQty: Number.isFinite(Number(raw.bundleQty)) && Number(raw.bundleQty) > 0 ? Number(raw.bundleQty) : undefined,
  };
}

const skus = fixtures.skus.map(coerceSku).filter((s) => s !== null);
const skuById = new Map(skus.map((s) => [s.id, s]));

// --- Legacy engine: slice load-builder.html and run it in a vm context ---
const START_ANCHOR = "const TRAILER_TYPES = {";
const END_ANCHOR = "function groupCartByZone(cart) {";

function loadLegacyEngine() {
  const html = readFileSync(join(repoRoot, "logistics", "load-builder.html"), "utf8");
  const lines = html.split(/\r?\n/);
  const startHits = lines.filter((l) => l.includes(START_ANCHOR)).length;
  const endHits = lines.filter((l) => l.includes(END_ANCHOR)).length;
  if (startHits !== 1 || endHits !== 1) {
    console.error(`lb-harness: legacy anchors not unique (start=${startHits}, end=${endHits}) — stopping.`);
    process.exit(1);
  }
  const startIdx = lines.findIndex((l) => l.includes(START_ANCHOR));
  const endIdx = lines.findIndex((l) => l.includes(END_ANCHOR));
  const slice = lines.slice(startIdx, endIdx).join("\n");

  // A self-returning Proxy stands in for document/window: any property read or call yields the
  // proxy again, so incidental top-level DOM touches in the slice are inert.
  const domProxy = new Proxy(function () {}, {
    get: (_t, prop) => (prop === Symbol.toPrimitive ? () => "" : domProxy),
    apply: () => domProxy,
    construct: () => domProxy,
  });
  const context = vm.createContext({
    document: domProxy,
    window: domProxy,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    console,
  });
  // The slice declares its own `let state = {...}` (autoDownsize: true etc.); replace it with the
  // prompt's stub afterwards. With autoDownsize undefined the legacy last-trailer box-truck
  // downsize is skipped — matching v2's DEFAULT_PACK_OPTIONS.autoDownsize = false.
  vm.runInContext(slice, context, { filename: "load-builder.html#calcLoading-slice" });
  vm.runInContext("state = { forcedMode: false, forcedTrailers: [], runnerHeight: 0 };", context);
  return {
    TRAILER_TYPES: vm.runInContext("TRAILER_TYPES", context),
    calcLoading: vm.runInContext("calcLoading", context),
    sliceLines: endIdx - startIdx,
    startLine: startIdx + 1,
    endLine: endIdx,
  };
}

const legacy = loadLegacyEngine();

// --- Normalization: trailers -> rows (nose->doors) -> columns -> layers (base first) ---
// Each engine passes its own verified nose->doors comparator (see the header comment).
const V2_NOSE_FIRST = (a, b) => b.posFromFront - a.posFromFront; // v2: posFromFront 0 = rear/doors
const LEGACY_NOSE_FIRST = (a, b) => a.posFromFront - b.posFromFront; // legacy: posFromFront 0 = nose
function normalize(trailers, noseFirst) {
  return trailers.map((t) => ({
    rows: [...t.rows]
      .sort(noseFirst)
      .map((r) => ({
        columns: [...r.columns]
          .sort((a, b) => (a.posY ?? 0) - (b.posY ?? 0))
          .map((c) => ({ layers: c.layers.map((l) => ({ unitHeight: l.unitHeight, count: l.count, skuId: l.skuId })) })),
      })),
  }));
}

// Row order check: true when the engine's own array order is already nose->doors.
function rowsNoseFirst(trailers, noseFirst) {
  return trailers.every((t) => t.rows.every((r, i) => i === 0 || noseFirst(t.rows[i - 1], r) <= 0));
}

function runV2(cart) {
  const plan = pack(cart, skus, TRAILER_TYPES[TRAILER_KEY], { ...DEFAULT_PACK_OPTIONS });
  return { trailers: normalize(plan.trailers, V2_NOSE_FIRST), noseFirst: rowsNoseFirst(plan.trailers, V2_NOSE_FIRST), warnings: plan.warnings, height: TRAILER_TYPES[TRAILER_KEY].height };
}

function runLegacy(cart) {
  // Fresh copies — calcLoading never mutates inputs we rely on, but keep runs independent anyway.
  const res = legacy.calcLoading(cart.map((c) => ({ ...c })), skus.map((s) => ({ ...s })), legacy.TRAILER_TYPES[TRAILER_KEY], 0, {});
  return { trailers: normalize(res.trailers, LEGACY_NOSE_FIRST), noseFirst: rowsNoseFirst(res.trailers, LEGACY_NOSE_FIRST), warnings: res.warnings, height: legacy.TRAILER_TYPES[TRAILER_KEY].height };
}

// Planner (lbr-02): single-footprint, all-Holey-Board carts only. planStacks returns stacks in
// loading order (index 0 = nose); chunk them into trucks of stacksPerTruck and rows of
// floor(98 / W) columns so the same metrics() applies.
function plannerEligible(cart) {
  const lines = cart.filter((c) => c.qty > 0);
  if (!lines.length || !lines.every((c) => skuById.get(c.skuId)?.category === "Holey Board")) return false;
  if (new Set(lines.map((c) => footprintKey(c.skuId))).size !== 1) return false;
  // Carts whose volume alone needs more than the 20-trailer cap (INV 4174 / 4186, quantity
  // artifacts — see Outliers) are excluded: the engines stop at the cap anyway, and the planner's
  // exhaustive break search is not meant for 50+-truck carts.
  return truckLB(cart) <= TRAILER_LIMIT;
}

function runPlanner(cart) {
  if (!plannerEligible(cart)) return null;
  const lines = cart.filter((c) => c.qty > 0);
  const s0 = skuById.get(lines[0].skuId);
  const dims = TRAILER_TYPES[TRAILER_KEY];
  const colsPerRow = Math.floor(dims.width / s0.width);
  const stacksPerTruck = Math.floor(dims.length / s0.length) * colsPerRow;
  const plan = planStacks(lines.map((c) => ({ skuId: c.skuId, unitHeight: skuById.get(c.skuId).height, qty: c.qty })), dims.height, stacksPerTruck);
  const trailers = [];
  for (let i = 0; i < plan.stacks.length; i += stacksPerTruck) {
    const truckStacks = plan.stacks.slice(i, i + stacksPerTruck);
    const rows = [];
    for (let r = 0; r < truckStacks.length; r += colsPerRow) {
      rows.push({
        columns: truckStacks.slice(r, r + colsPerRow).map((st) => ({
          layers: [st.base, ...(st.top ? [st.top] : [])].map((l) => ({ unitHeight: l.unitHeight, count: l.count, skuId: l.skuId })),
        })),
      });
    }
    trailers.push({ rows });
  }
  if (trailers.length !== plan.trucks) {
    console.error(`lb-harness: planner stacks chunk into ${trailers.length} trucks but plan.trucks = ${plan.trucks} — stopping.`);
    process.exit(1);
  }
  return { trailers, plan, warnings: [], height: dims.height };
}

// --- Metrics ---
function footprintKey(skuId) {
  const s = skuById.get(skuId);
  return s ? `${s.length}x${s.width}` : `?${skuId}`;
}

function metrics(result, cart) {
  const m = { trucks: result.trailers.length, stacks: 0, mixed: 0, over2: 0, inverted: 0, frontRowMixed: 0, seqViolations: 0, overHeight: 0, unplaced: 0 };
  let placed = 0;
  for (const t of result.trailers) {
    t.rows.forEach((row, ri) => {
      for (const col of row.columns) {
        m.stacks++;
        const ids = new Set(col.layers.map((l) => l.skuId));
        const isMixed = ids.size > 1;
        if (isMixed) m.mixed++;
        if (ids.size > 2) m.over2++;
        if (isMixed && ri === 0) m.frontRowMixed++;
        if (col.layers.some((l, i) => i > 0 && l.unitHeight > col.layers[i - 1].unitHeight + EPS)) m.inverted++;
        const h = col.layers.reduce((s, l) => s + l.unitHeight * l.count, 0);
        if (h > result.height + EPS) m.overHeight++;
        placed += col.layers.reduce((s, l) => s + l.count, 0);
      }
    });
    // Rule 4: per footprint family (base layer's stated L×W), compare adjacent rows holding that family.
    const families = new Map(); // key -> [{min,max}] per row, front->rear
    for (const row of t.rows) {
      const perFam = new Map();
      for (const col of row.columns) {
        const base = col.layers[0];
        const key = footprintKey(base.skuId);
        const cur = perFam.get(key) ?? { min: Infinity, max: -Infinity };
        cur.min = Math.min(cur.min, base.unitHeight);
        cur.max = Math.max(cur.max, base.unitHeight);
        perFam.set(key, cur);
      }
      for (const [key, v] of perFam) {
        if (!families.has(key)) families.set(key, []);
        families.get(key).push(v);
      }
    }
    for (const seq of families.values()) {
      for (let i = 1; i < seq.length; i++) if (seq[i].max > seq[i - 1].min + EPS) m.seqViolations++;
    }
  }
  const demanded = cart.reduce((s, c) => s + c.qty, 0);
  m.unplaced = demanded - placed;
  return m;
}

function truckLB(cart) {
  const lines = cart.filter((c) => c.qty > 0);
  const fps = new Set(lines.map((c) => footprintKey(c.skuId)));
  if (fps.size !== 1 || lines.some((c) => !skuById.has(c.skuId))) return null;
  const s0 = skuById.get(lines[0].skuId);
  const dims = TRAILER_TYPES[TRAILER_KEY];
  const colsPerTrailer = Math.floor(dims.length / s0.length) * Math.floor(dims.width / s0.width);
  if (colsPerTrailer <= 0) return null;
  const totalH = lines.reduce((s, c) => s + c.qty * skuById.get(c.skuId).height, 0);
  return Math.ceil(totalH / (dims.height * colsPerTrailer) - EPS);
}

// --- Run all jobs ---
const jobs = fixtures.jobs.map((job) => {
  const v2 = runV2(job.cart);
  const lg = runLegacy(job.cart);
  const pl = runPlanner(job.cart);
  return {
    job,
    v2,
    lg,
    pl,
    mv2: metrics(v2, job.cart),
    mlg: metrics(lg, job.cart),
    mpl: pl ? { ...metrics(pl, job.cart), shortened: pl.plan.shortenedStacks } : null,
    lb: truckLB(job.cart),
  };
});

// --- Golden fixture: INV 4472 trailer-1 piece set ---
const GOLDEN_4472_T1 = [
  { skuId: "67fa27f6-197b-4065-ac0c-ae364089ed06", qty: 85 }, // 13in block (HB, 48x24)
  { skuId: "98516c6f-0741-4804-8941-3ded5d6e5c76", qty: 120 }, // 12in block
  { skuId: "73f78498-fe5e-49f9-8847-88e64e924000", qty: 195 }, // 11in block
  { skuId: "3c15ee96-184e-4dc4-bbbd-3cef509a9890", qty: 85 }, // 10in block
  { skuId: "7ad6bbc9-ca9a-42fe-9511-4d9b8cabe1a5", qty: 6 }, // 9in block
  { skuId: "8de3b61e-25fa-4fbc-b57a-0010e879472c", qty: 1 }, // 8in block
];
for (const [i, h] of [13, 12, 11, 10, 9, 8].entries()) {
  const s = skuById.get(GOLDEN_4472_T1[i].skuId);
  if (!s || s.height !== h || s.length !== 48 || s.width !== 24) {
    console.error(`lb-harness: GOLDEN_4472_T1 sku ${GOLDEN_4472_T1[i].skuId} is not the ${h}in 48x24 block — stopping.`);
    process.exit(1);
  }
}
const golden = { v2: runV2(GOLDEN_4472_T1), lg: runLegacy(GOLDEN_4472_T1), pl: runPlanner(GOLDEN_4472_T1) };
golden.mv2 = metrics(golden.v2, GOLDEN_4472_T1);
golden.mlg = metrics(golden.lg, GOLDEN_4472_T1);
golden.mpl = { ...metrics(golden.pl, GOLDEN_4472_T1), shortened: golden.pl.plan.shortenedStacks };
golden.lb = truckLB(GOLDEN_4472_T1);

// --- Report ---
const n = (x) => (Number.isInteger(x) ? String(x) : String(Number(x.toFixed(3))));
const KEYS = ["trucks", "stacks", "mixed", "over2", "inverted", "frontRowMixed", "seqViolations", "overHeight", "unplaced"];
function sum(engine, list = jobs) {
  const t = Object.fromEntries(KEYS.map((k) => [k, 0]));
  for (const j of list) for (const k of KEYS) t[k] += j[engine][k];
  return t;
}
const tv2 = sum("mv2");
const tlg = sum("mlg");
const plJobs = jobs.filter((j) => j.mpl);
const tpl = sum("mpl", plJobs);
const plShortened = plJobs.reduce((s, j) => s + j.mpl.shortened, 0);
const plAtLB = plJobs.filter((j) => j.mpl.trucks === j.lb).length;
const plSaved = plJobs.filter((j) => j.pl.plan.trucks < j.pl.plan.pureTrucks);
// lbr-01 published these with v2's rows reversed (see Notes); kept for the before/after line.
const LBR01_V2_FRONT_ROW_MIXED = 194;
const LBR01_V2_SEQ_VIOLATIONS = 205;
const withLB = jobs.filter((j) => j.lb !== null);
const v2OverLB = withLB.filter((j) => j.mv2.trucks > j.lb).length;
const lgOverLB = withLB.filter((j) => j.mlg.trucks > j.lb).length;
const lbSum = withLB.reduce((s, j) => s + j.lb, 0);

function diagram(result) {
  const out = [];
  result.trailers.forEach((t, ti) => {
    out.push(`Trailer ${ti + 1} (${t.rows.length} rows, nose -> doors)`);
    t.rows.forEach((row, ri) => {
      const cols = row.columns.map((c) => c.layers.map((l) => `${n(l.unitHeight)}x${l.count}`).join("+"));
      out.push(`  R${String(ri + 1).padStart(2, "0")}: ${cols.join("  ")}`);
    });
  });
  return out.join("\n");
}

function violations(result) {
  const out = [];
  result.trailers.forEach((t, ti) => {
    t.rows.forEach((row, ri) => {
      row.columns.forEach((col, ci) => {
        const where = `T${ti + 1} R${ri + 1} C${ci + 1}`;
        const desc = col.layers.map((l) => `${n(l.unitHeight)}x${l.count}`).join("+");
        const ids = new Set(col.layers.map((l) => l.skuId));
        if (ids.size > 2) out.push(`${where} \`${desc}\`: ${ids.size} sizes in one stack (rule 3, max 2)`);
        if (col.layers.some((l, i) => i > 0 && l.unitHeight > col.layers[i - 1].unitHeight + EPS))
          out.push(`${where} \`${desc}\`: thicker on thinner (rule 3)`);
        if (ids.size > 1 && ri === 0) out.push(`${where} \`${desc}\`: mixed stack in the nose row (rule 5)`);
        const h = col.layers.reduce((s, l) => s + l.unitHeight * l.count, 0);
        if (h > result.height + EPS) out.push(`${where} \`${desc}\`: ${n(h)}" exceeds ${result.height}" (over height)`);
      });
    });
    for (let ri = 1; ri < t.rows.length; ri++) {
      const prev = t.rows[ri - 1].columns.map((c) => c.layers[0].unitHeight);
      const cur = t.rows[ri].columns.map((c) => c.layers[0].unitHeight);
      if (Math.max(...cur) > Math.min(...prev) + EPS)
        out.push(`T${ti + 1} R${ri}->R${ri + 1}: door-side row base ${n(Math.max(...cur))}" > nose-side row base ${n(Math.min(...prev))}" (rule 5 sequencing)`);
    }
  });
  return out;
}

function mixedStackNote(m) {
  return `${m.mixed} mixed of ${m.stacks} stacks`;
}

function totalsLine(m) {
  return `trucks ${m.trucks} · stacks ${m.stacks} · mixed ${m.mixed} · over2 ${m.over2} · inverted ${m.inverted} · frontRowMixed ${m.frontRowMixed} · seqViolations ${m.seqViolations} · overHeight ${m.overHeight} · unplaced ${m.unplaced}`;
}

// One-line likely cause for an outlier, derived from what the engines actually reported.
const NO_FIT_RE = /^sku (\S+) \(([^)]+)\) does not fit trailer/;
function noFitSkus(j) {
  return j.v2.warnings.map((w) => w.match(NO_FIT_RE)).filter(Boolean).map((m) => ({ id: m[1], dims: m[2] }));
}
function outlierCause(j) {
  const causes = [];
  const totalH = j.job.cart.reduce((s, c) => s + c.qty * (skuById.get(c.skuId)?.height ?? 0), 0);
  if (j.mv2.trucks >= TRAILER_LIMIT || j.mlg.trucks >= TRAILER_LIMIT) {
    const pcs = j.job.cart.reduce((s, c) => s + c.qty, 0);
    causes.push(
      j.lb !== null && j.lb > TRAILER_LIMIT
        ? `${pcs.toLocaleString("en-US")} pcs (${Math.round(totalH).toLocaleString("en-US")} stacked in.) need ≥ ${j.lb} trailers by volume alone, so both engines stop at the ${TRAILER_LIMIT}-trailer cap — a quantity artifact on the job (not one shipment), not an engine fault`
        : `hit the ${TRAILER_LIMIT}-trailer cap`
    );
  }
  const noFit = noFitSkus(j);
  if (noFit.length && j.mlg.unplaced === 0) {
    const sample = noFit.map((x) => `${x.dims}`).join(", ");
    causes.push(`v2 can't place ${noFit.length === 1 ? "a non-Holey SKU" : `${noFit.length} non-Holey SKUs`} stated as L×W×H ${sample} with \`allowRotation: false\` (no legal orientation fits 636×98×109); legacy ignores \`allowRotation\` for non-Holey parts and stands them on another face`);
  } else if (noFit.length) {
    causes.push(`v2: no legal orientation for ${noFit.map((x) => x.dims).join(", ")}`);
  }
  if (!causes.length) causes.push("unplaced pieces with no fit warning — needs a look");
  return causes.join("; ");
}

const L = [];
L.push("# lbr-01 — Load Builder engine baseline (v2 `pack()` vs legacy `calcLoading`)");
L.push("");
L.push("> **Re-run in lbr-02 with the row-direction fix.** lbr-01 read v2's rows back to front: v2's `posFromFront` 0 is the doors, not the nose. That made its v2 front-row and sequencing numbers wrong; everything below is corrected. lbr-02 also adds the `planStacks` planner (`src/lib/stackPlanner.ts`) as a third engine for single-footprint Holey Board jobs, which fills the old `mixedLB` stub.");
L.push("");
L.push(`Generated by \`cutting-pilot/scripts/lb-harness.mjs\` from \`cutting-pilot/scripts/lb-fixtures.json\` (exported ${fixtures.exportedAt}; ${fixtures.source}; ${fixtures.jobs.length} jobs with a non-empty cart, ${skus.length} SKUs). Trailer: ${TRAILER_KEY} (${TRAILER_TYPES[TRAILER_KEY].length}×${TRAILER_TYPES[TRAILER_KEY].width}×${TRAILER_TYPES[TRAILER_KEY].height}). v2 runs \`DEFAULT_PACK_OPTIONS\` with no overrides; legacy runs \`calcLoading(cart, skus, TRAILER_TYPES["${TRAILER_KEY}"], 0, {})\`. Re-run with \`node scripts/lb-harness.mjs\` from \`cutting-pilot/\` — output is deterministic.`);
L.push("");
L.push("Locked rules (Steve, 2026-10-12, final; they supersede `holey-sequential-fill`), in priority order: 1) fewest trucks: if mixing saves a truck, always mix; 2) pure first: full-height pure stacks plus at most one leftover per size, mixing only to save a truck, with overflow pieces becoming top-offs (single pieces where possible); 3) at most 2 sizes per stack, top-off strictly thinner than the base; 4) shorten a full stack only as a last resort, as few as possible; 5) thickest at the nose, thinnest at the doors; within a size, pure full stacks first and topped-off and partial stacks last.");
L.push("");
L.push("## 1. Totals across all jobs");
L.push("");
L.push(`The v2 and legacy columns sum all ${jobs.length} jobs. The planner column sums only the ${plJobs.length} single-footprint Holey Board jobs it runs on; the last three rows compare all three engines on exactly those jobs.`);
L.push("");
L.push(`| Metric | v2 | legacy | planner (${plJobs.length} jobs) |`);
L.push("|---|---:|---:|---:|");
for (const k of KEYS) L.push(`| Σ ${k} | ${tv2[k]} | ${tlg[k]} | ${tpl[k]} |`);
L.push(`| Σ shortened stacks (rule 4) | n/a | n/a | ${plShortened} |`);
L.push(`| Jobs with trucks > truckLB (of ${withLB.length} single-footprint jobs) | ${v2OverLB} | ${lgOverLB} | n/a |`);
L.push(`| Σ trucks over single-footprint jobs (Σ truckLB = ${lbSum}) | ${withLB.reduce((s, j) => s + j.mv2.trucks, 0)} | ${withLB.reduce((s, j) => s + j.mlg.trucks, 0)} | n/a |`);
const plLB = plJobs.reduce((s, j) => s + j.lb, 0);
L.push(`| **Planner jobs only (${plJobs.length}; Σ truckLB = ${plLB}): Σ trucks** | ${plJobs.reduce((s, j) => s + j.mv2.trucks, 0)} | ${plJobs.reduce((s, j) => s + j.mlg.trucks, 0)} | ${tpl.trucks} |`);
L.push(`| Planner jobs only: Σ mixed | ${plJobs.reduce((s, j) => s + j.mv2.mixed, 0)} | ${plJobs.reduce((s, j) => s + j.mlg.mixed, 0)} | ${tpl.mixed} |`);
L.push(`| Planner jobs only: jobs at truckLB | ${plJobs.filter((j) => j.mv2.trucks === j.lb).length} | ${plJobs.filter((j) => j.mlg.trucks === j.lb).length} | ${plAtLB} |`);
L.push("");
L.push(`Before/after the direction fix (v2): Σ frontRowMixed ${LBR01_V2_FRONT_ROW_MIXED} → ${tv2.frontRowMixed}, Σ seqViolations ${LBR01_V2_SEQ_VIOLATIONS} → ${tv2.seqViolations}. Legacy's numbers are unchanged because its direction was already right.`);
L.push("");
L.push("## 2. Per-job table");
L.push("");
L.push("Sorted by v2 `mixed` descending (ties: v2 trucks descending, then inv ascending). v2/legacy cells are `trucks/stacks/mixed/over2/inverted/front/seq`; `front` = frontRowMixed, `seq` = seqViolations. Planner cells are `trucks/stacks/mixed/shortened` for single-footprint Holey Board jobs, and `—` otherwise. The planner column replaces lbr-01's `mixedLB` stub.");
L.push("");
L.push("| inv | lines | unmatched | v2 t/s/m/o2/inv/front/seq | legacy t/s/m/o2/inv/front/seq | truckLB | planner t/s/m/sh |");
L.push("|---|---:|---:|---|---|---:|---|");
const plCell = (m) => (m ? [m.trucks, m.stacks, m.mixed, m.shortened].join("/") : "—");
const cell = (m) => [m.trucks, m.stacks, m.mixed, m.over2, m.inverted, m.frontRowMixed, m.seqViolations].join("/");
const sorted = [...jobs].sort(
  (a, b) => b.mv2.mixed - a.mv2.mixed || b.mv2.trucks - a.mv2.trucks || String(a.job.inv).localeCompare(String(b.job.inv), "en", { numeric: true }) || a.job.jobId.localeCompare(b.job.jobId)
);
for (const j of sorted) {
  L.push(`| ${j.job.inv} | ${j.job.lines} | ${j.job.unmatched} | ${cell(j.mv2)} | ${cell(j.mlg)} | ${j.lb ?? "n/a"} | ${plCell(j.mpl)} |`);
}
L.push("");
L.push("### Planner: jobs where mixing saved a truck");
L.push("");
if (!plSaved.length) L.push("None.");
else {
  L.push("| inv | pure trucks → planner trucks | truckLB | legacy trucks | v2 trucks | planner stacks / top-offs / shortened |");
  L.push("|---|---|---:|---:|---:|---|");
  for (const j of [...plSaved].sort((a, b) => String(a.job.inv).localeCompare(String(b.job.inv), "en", { numeric: true }))) {
    L.push(`| ${j.job.inv} | ${j.pl.plan.pureTrucks} → ${j.pl.plan.trucks} | ${j.lb} | ${j.mlg.trucks} | ${j.mv2.trucks} | ${j.mpl.stacks} / ${j.mpl.mixed} / ${j.mpl.shortened} |`);
  }
}
L.push("");
L.push("## 3. Outliers");
L.push("");
L.push(`Every job where either engine hits the ${TRAILER_LIMIT}-trailer limit or leaves pieces unplaced.`);
L.push("");
const outliers = sorted
  .filter((j) => j.mv2.trucks >= TRAILER_LIMIT || j.mlg.trucks >= TRAILER_LIMIT || j.mv2.unplaced > 0 || j.mlg.unplaced > 0)
  .sort((a, b) => String(a.job.inv).localeCompare(String(b.job.inv), "en", { numeric: true }));
if (!outliers.length) L.push("None.");
else {
  L.push("| inv | v2 trucks / unplaced | legacy trucks / unplaced | likely cause |");
  L.push("|---|---|---|---|");
  for (const j of outliers) {
    L.push(`| ${j.job.inv} | ${j.mv2.trucks} / ${j.mv2.unplaced} | ${j.mlg.trucks} / ${j.mlg.unplaced} | ${outlierCause(j)} |`);
  }
}
L.push("");
L.push("## 4. Golden fixture: INV 4472, trailer-1 piece set (`GOLDEN_4472_T1`)");
L.push("");
L.push("All 48×24 Holey Board: 13\"×85, 12\"×120, 11\"×195, 10\"×85, 9\"×6, 8\"×1. Columns are written `heightxcount`, layers base first joined by `+`; each row lists its columns across the trailer width.");
L.push("");
L.push(`| Engine | trucks | stacks | mixed | over2 | inverted | front | seq | overHeight | unplaced | truckLB |`);
L.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
L.push(`| planner | ${golden.mpl.trucks} | ${golden.mpl.stacks} | ${golden.mpl.mixed} | ${golden.mpl.over2} | ${golden.mpl.inverted} | ${golden.mpl.frontRowMixed} | ${golden.mpl.seqViolations} | ${golden.mpl.overHeight} | ${golden.mpl.unplaced} | ${golden.lb ?? "n/a"} |`);
L.push(`| v2 | ${golden.mv2.trucks} | ${golden.mv2.stacks} | ${golden.mv2.mixed} | ${golden.mv2.over2} | ${golden.mv2.inverted} | ${golden.mv2.frontRowMixed} | ${golden.mv2.seqViolations} | ${golden.mv2.overHeight} | ${golden.mv2.unplaced} | ${golden.lb ?? "n/a"} |`);
L.push(`| legacy | ${golden.mlg.trucks} | ${golden.mlg.stacks} | ${golden.mlg.mixed} | ${golden.mlg.over2} | ${golden.mlg.inverted} | ${golden.mlg.frontRowMixed} | ${golden.mlg.seqViolations} | ${golden.mlg.overHeight} | ${golden.mlg.unplaced} | ${golden.lb ?? "n/a"} |`);
L.push("");
L.push(`Reference (Orchestrator sandbox): the exact optimum is 1 truck with 29 top-offs (30 with ≤2 sizes per stack). Planner: ${golden.pl.plan.trucks} truck (pure plan ${golden.pl.plan.pureTrucks}), ${golden.pl.plan.topOffStacks} top-offs, ${golden.pl.plan.shortenedStacks} stack shortened.`);
L.push("");
for (const [label, res] of [["planner `planStacks()`", golden.pl], ["v2 `pack()`", golden.v2], ["legacy `calcLoading`", golden.lg]]) {
  L.push(`### ${label}`);
  L.push("");
  L.push("```");
  L.push(diagram(res));
  L.push("```");
  L.push("");
  const v = violations(res);
  L.push(`Rule violations (${v.length}):`);
  L.push("");
  if (!v.length) L.push("- none");
  for (const line of v) L.push(`- ${line}`);
  L.push("");
}
const full = jobs.find((j) => String(j.job.inv) === "4472");
L.push("### Full INV 4472 cart");
L.push("");
if (full) {
  L.push(`- v2: ${totalsLine(full.mv2)} · truckLB ${full.lb ?? "n/a"}`);
  L.push(`- legacy: ${totalsLine(full.mlg)} · truckLB ${full.lb ?? "n/a"}`);
  if (full.mpl) L.push(`- planner: ${totalsLine(full.mpl)} · shortened ${full.mpl.shortened} · pure trucks ${full.pl.plan.pureTrucks} · truckLB ${full.lb ?? "n/a"}`);
} else L.push("- INV 4472 not present in fixtures.");
L.push("");
L.push("## 5. Notes");
L.push("");
L.push(`- **Legacy slice:** \`logistics/load-builder.html\` lines ${legacy.startLine}–${legacy.endLine} (from \`${START_ANCHOR}\` up to, not including, \`${END_ANCHOR}\`), run in a \`node:vm\` context with a self-returning \`Proxy\` for \`document\`/\`window\` and a no-op \`localStorage\`. No further stubs were needed. The HTML is never edited.`);
L.push("- **`state` stub:** the slice declares its own `let state = {…}` (including `autoDownsize: true`), so the prompt's stub `{ forcedMode: false, forcedTrailers: [], runnerHeight: 0 }` is assigned over it after the slice loads. With `autoDownsize` therefore falsy, legacy's last-trailer 26ft-box-truck downsize is skipped — matching v2, whose `DEFAULT_PACK_OPTIONS.autoDownsize` is `false`. Both engines thus report every trailer as a 53ft Standard.");
L.push("- **Row order (fixed in lbr-02):** every diagram and metric reads rows nose → doors (row 1 = nose), with columns sorted by `posY`. The two engines use opposite origins:");
L.push("  - **v2:** `posFromFront` 0 is the REAR (doors), despite the name. Evidence: the comment on `packEngine.ts`'s `rowBaseThickness`, `simulate()`'s row sort (lb-engine-03 B3, row-order-nose-first: \"thinnest base layer at posFromFront 0 (the rear, where the doors are — loaded last)\"), and `TrailerDiagram.tsx`'s header (\"`trailer.rows` itself is still ordered rear-first\"). The harness sorts v2 rows by `posFromFront` **descending**. lbr-01 sorted them ascending, which read every v2 trailer back to front.");
L.push("  - **legacy:** `posFromFront` 0 is the far wall (nose). `logistics/load-builder.html` says this shop's FRONT/REAR is the reverse of standard trucking terms: \"FRONT = the doors (buildTopViewSVG draws FRONT at the high-posFromFront end), REAR = the far wall\" (:1043–1046, restated at :1329). The diagrams draw the FRONT label at the high-`posFromFront` end (:1499, :1583), and reflow anchors \"posFromFront=0 = rear / left of diagram\" (:2284). `calcLoading` builds its tallest rows first at `curX = 0` (`sortDemandPriority`: \"tallest blocks first (shop floor loading order)\"). The harness sorts legacy rows **ascending**, as lbr-01 did, so lbr-01's legacy numbers were already correct.");
L.push(`  - Native array order: v2 emits rows ${jobs.every((j) => j.v2.noseFirst) && golden.v2.noseFirst ? "nose-first on every run" : "doors-first (reversed by the sort above)"}; legacy emits them ${jobs.every((j) => j.lg.noseFirst) && golden.lg.noseFirst ? "nose-first on every run" : "not always nose-first (re-sorted)"}.`);
L.push("- **SKU coercion:** fixture SKUs pass through a verbatim copy of `jobPull.ts`'s `coerceSku` (it is not exported) before either engine runs; legacy receives the same coerced list.");
L.push("- **`unplaced`** is Σ cart qty − Σ placed layer counts, which covers both v2's `balance` and legacy's \"could not be placed\" warnings.");
L.push("- **`seqViolations`** groups each row's columns by the base layer's stated catalog L×W (footprint family) and compares adjacent rows that hold that family; `truckLB` uses stated L×W only (no rotation) and is `n/a` for multi-footprint carts.");
L.push(`- **Planner engine (lbr-02):** \`planStacks(skus, 109, floor(636/L) × floor(98/W))\` runs on the ${plJobs.length} jobs whose cart is all Holey Board with one stated footprint and whose \`truckLB\` is within the ${TRAILER_LIMIT}-trailer cap (this excludes INV ${jobs.filter((j) => !j.mpl && j.lb !== null && j.lb > TRAILER_LIMIT && j.job.cart.every((c) => skuById.get(c.skuId)?.category === "Holey Board")).map((j) => j.job.inv).join(" and ")}, the quantity-artifact outliers). Its loading-order stacks are chunked into trucks of \`stacksPerTruck\` and rows of \`floor(98/W)\` columns (nose first), then scored with the same metrics as the other engines; the harness checks that the chunked truck count equals \`plan.trucks\`. The planner reached \`truckLB\` on ${plAtLB} of ${plJobs.length} jobs and saved a truck over its own pure plan on ${plSaved.length}. No \`maxPerStack\` weight cap is passed.`);
L.push(`- **Planner \`frontRowMixed\` (${tpl.frontRowMixed}) is a harness artifact, not a planner rule break.** \`planStacks\` returns one nose→doors sequence for the whole load, and the harness chunks it into trucks of \`stacksPerTruck\` naively. When one size's topped-off run spans a truck boundary, those stacks open the next truck's nose row (e.g. INV 4106 trucks 2–7). A size with less than a row of stacks also puts its leftover or topped stack in the first row (e.g. INV 4434 truck 1). Per-truck assignment and ordering is lbr-03's job when \`planStacks\` is wired into \`packEngine.ts\`.`);
const notableNotes = [];
const clean = jobs.filter((j) => j.mv2.unplaced === 0 && j.mlg.unplaced === 0);
const v2Fewer = clean.filter((j) => j.mv2.trucks < j.mlg.trucks).length;
const v2More = clean.filter((j) => j.mv2.trucks > j.mlg.trucks).length;
notableNotes.push(
  `**Like-for-like trucks:** on the ${clean.length} jobs where neither engine leaves pieces unplaced, v2 uses fewer trucks than legacy on ${v2Fewer}, more on ${v2More}, the same on ${clean.length - v2Fewer - v2More} (Σ ${clean.reduce((s, j) => s + j.mv2.trucks, 0)} v2 vs ${clean.reduce((s, j) => s + j.mlg.trucks, 0)} legacy). The raw Σ trucks / Σ unplaced totals in section 1 are skewed by the outliers in section 3.`
);
const rotJobs = jobs.filter((j) => noFitSkus(j).length > 0 && j.mlg.unplaced === 0).length;
notableNotes.push(
  `**\`allowRotation\` divergence (surprising):** on ${rotJobs} jobs v2 leaves non-Holey SKUs unplaced because their catalog L×W×H has \`allowRotation: false\` and doesn't fit upright (e.g. 144"-long pieces stated with 144 as height). Legacy \`buildDemand\` always tries all six orientations for non-Holey parts regardless of the flag. This is a catalog-data and parity question for lbr-03 or the parts library, not something this harness changes.`
);
notableNotes.push(
  `**Legacy never tops off:** legacy produced ${tlg.mixed} mixed stacks across all ${jobs.length} jobs. Pass 1's \`buildColumn\` hard-codes \`shouldMix = false\` and builds each size's remainder as a short pure stack (\`maxBase = min(remaining, floor(H / h))\`), so pass 2's remainder consolidation is left with nothing to mix on these carts.`
);
notableNotes.push(
  `**Golden v2 vs the sandbox:** the Orchestrator's sandbox reported v2 at 51 of 52 mixed stacks on this piece set; the harness measures ${golden.mv2.mixed} of ${golden.mv2.stacks} (cross-checked against \`plan.mixedStacks\` and the per-column \`mixed\` flag, which agree). The truck count (1) matches. The sandbox's "thinnest pieces at the nose" was the same row-direction reversal fixed above: v2 actually loads the 13s at the nose. The mixed-count gap is not explained here (a different engine revision or counting method is possible); lbr-03 should gate on this harness's number.`
);
for (const s of notableNotes) L.push(`- ${s}`);
L.push("");

const report = L.join("\n");
writeFileSync(AUDIT_PATH, report);

console.log(`lb-harness: ${jobs.length} jobs -> ${AUDIT_PATH}`);
console.log(`  v2     ${totalsLine(tv2)} · over truckLB ${v2OverLB}/${withLB.length}`);
console.log(`  legacy ${totalsLine(tlg)} · over truckLB ${lgOverLB}/${withLB.length}`);
console.log(`  GOLDEN_4472_T1  v2: ${golden.mv2.trucks} truck(s), ${mixedStackNote(golden.mv2)} · legacy: ${golden.mlg.trucks} truck(s), ${mixedStackNote(golden.mlg)}`);
