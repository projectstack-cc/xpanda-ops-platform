// src/lib/blockCalc/xlsx.ts — blk-02
// Block Calculator XLSX export. Port of legacy manufacturing/block-calculator.html
// exportXlsxFromCalc (~2153) + buildAndDownloadXlsx (~2252): the same three sheets (Cut List,
// Summary, Parts), same cells, same column widths, file block-calculator.xlsx. Sheet contents stay
// English like legacy (it's a data file); only the button is translated.
//
// Summary uses the PRIMARY-only utilization / waste (p.utilPct, p.wasteVol) exactly as legacy's
// export does — not the combined figures the on-screen stat tiles show.
//
// One deliberate difference: legacy's Parts sheet re-reads secondary dims from the inputs with
// Number(value) || 0, so a fraction ("2 1/4") lands as 0. v2 writes the parsed dims the calc used.
import type { BlockCalcInput, BlockCalcResult } from "@/lib/blockEngine";
import type { CutListRow, Routing } from "./cutList";

export type Cell = string | number;
export type Aoa = Cell[][];

export interface XlsxPartMeta {
  part_number: string;
  customer: string;
  density_material: string;
  length_in: number;
  width_in: number;
  height_in: number;
  role: string;
}

export interface XlsxMeta {
  blockStr: string;
  orientMode: string;
  machines: string;
  date: string;
  parts_per_block: number;
  util_pct: number;
  waste_vol: number;
  blocks_needed: number | null;
  total_produced: number | null;
  surplus: number | null;
  secondary_totals: { label: string; total: number }[];
}

export interface LibMeta {
  part_number?: string;
  customer?: string;
  density_material?: string;
}

export interface BlockCalcSheets {
  cutList: Aoa;
  summary: Aoa;
  parts: Aoa;
}

export const COLS = {
  cutList: [4, 20, 22, 28, 14, 18, 8, 16, 12],
  summary: [26, 16],
  parts: [14, 18, 20, 12, 12, 12, 22],
} as const;

/** Legacy exportXlsxFromCalc's meta. `date` is the caller's toLocaleDateString(). */
export function buildXlsxMeta(calc: BlockCalcResult, input: BlockCalcInput, routing: Routing, date: string): XlsxMeta {
  const p = calc.primary;
  const machines: string[] = [];
  if (routing.crossCutter) machines.push("Cross Cutter");
  machines.push("Main Line");
  if (routing.blueLine) machines.push("Blue Line");
  return {
    blockStr: `${input.bL}" × ${input.bW}" × ${input.bH}"`,
    orientMode: input.mode === "auto" ? "Auto (Best Fit)" : "Fixed (As Entered)",
    machines: machines.join(", "),
    date,
    parts_per_block: p.total,
    util_pct: p.utilPct,
    waste_vol: p.wasteVol,
    blocks_needed: calc.blocksNeeded,
    total_produced: calc.totalProduced,
    surplus: calc.surplus,
    secondary_totals: calc.secondaries.map((s) => ({ label: s.label, total: s.totalPieces })),
  };
}

/** Legacy partsMeta: the primary, then each secondary that yields pieces, in input order. */
export function buildPartsMeta(
  calc: BlockCalcResult,
  input: BlockCalcInput,
  primaryLib: LibMeta | null,
  secLibById: Record<string, LibMeta | null | undefined>
): XlsxPartMeta[] {
  const out: XlsxPartMeta[] = [
    {
      part_number: primaryLib?.part_number || "Manual Entry",
      customer: primaryLib?.customer || "",
      density_material: primaryLib?.density_material || "",
      length_in: input.pL,
      width_in: input.pW,
      height_in: input.pH,
      role: "Primary",
    },
  ];
  for (const sec of calc.secondaries) {
    if (sec.totalPieces === 0) continue;
    const sl = secLibById[sec._secId] || null;
    out.push({
      part_number: sl?.part_number || "Manual Entry",
      customer: sl?.customer || "",
      density_material: sl?.density_material || "",
      length_in: sec._dims.L,
      width_in: sec._dims.W,
      height_in: sec._dims.H,
      role: `Secondary (${sec.label})`,
    });
  }
  return out;
}

const round3 = (n: number) => parseFloat(n.toFixed(3));

/** Legacy buildAndDownloadXlsx's three arrays-of-arrays. */
export function buildBlockCalcSheets(rows: CutListRow[], partsMeta: XlsxPartMeta[], meta: XlsxMeta): BlockCalcSheets {
  const cutList: Aoa = [
    ["xPanda Foam — Block Calculator"],
    [`Date: ${meta.date}`],
    [`Block Size: ${meta.blockStr}`],
    [`Orientation: ${meta.orientMode}`],
    [`Active Machines: ${meta.machines}`],
    [],
    ["#", "Machine", "Cut Direction", "Part", "Part Number", "Customer", "Pieces", "Cut Spacing (in)", "Remnant (in)"],
  ];
  for (const r of rows) {
    const machine = r.machine_rerouted ? `${r.machine} (from ${r.machine_rerouted_from})` : r.machine;
    // Legacy bakes the auto-orientation hint into the direction text.
    const direction = r.remapFrom ? `${r.direction} (← Part ${r.remapFrom})` : r.direction;
    cutList.push([
      r.step, machine, direction, r.part_label, r.part_number || "", r.customer || "", r.pieces, round3(r.spacing), round3(r.remnant),
    ]);
  }

  const summary: Aoa = [
    ["Summary"],
    [],
    ["Parts per Block", meta.parts_per_block],
    ["Utilization", parseFloat((meta.util_pct || 0).toFixed(1)) + "%"],
    ["Waste per Block (in³)", Math.round(meta.waste_vol || 0)],
    ["Blocks Needed", meta.blocks_needed ?? "N/A"],
    ["Total Produced", meta.total_produced ?? "N/A"],
    ["Surplus", meta.surplus ?? "N/A"],
  ];
  if (meta.secondary_totals.length > 0) {
    summary.push([], ["Secondary Part Yields"]);
    for (const st of meta.secondary_totals) if (st.total > 0) summary.push([st.label, st.total]);
  }

  const parts: Aoa = [["Part Number", "Customer", "Density / Material", "Length (in)", "Width (in)", "Height (in)", "Role"]];
  for (const pm of partsMeta) {
    parts.push([pm.part_number || "", pm.customer || "", pm.density_material || "", pm.length_in, pm.width_in, pm.height_in, pm.role]);
  }

  return { cutList, summary, parts };
}

/** Builds the workbook (lazy-loads SheetJS) and downloads `<filename>.xlsx`. */
export async function downloadBlockCalcXlsx(sheets: BlockCalcSheets, filename = "block-calculator"): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const add = (aoa: Aoa, cols: readonly number[], name: string) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = cols.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  add(sheets.cutList, COLS.cutList, "Cut List");
  add(sheets.summary, COLS.summary, "Summary");
  add(sheets.parts, COLS.parts, "Parts");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
