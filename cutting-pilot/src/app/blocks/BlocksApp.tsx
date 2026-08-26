"use client";
// Block Nesting: upload a PO spreadsheet, parse SKUs, correct via an editable grid (the safety
// net for mis-parses), set per-density block dimensions, then "Reload cut sheet" nests and
// renders the cut sheet (nest() + <CutSheet>).
import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Plus, Trash2, RefreshCw, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";
import Modal from "@/components/Modal";
import {
  DEFAULT_BLOCK,
  DEFAULT_BLOCKS,
  type BlockSize,
  type BlockSizes,
  type NestResult,
  type SkuLine,
} from "@/lib/blockTypes";
import { parsePoRows, type PoInputRow } from "@/lib/poParser";
import { runPoParserSelfCheck } from "@/lib/poParser.selfcheck";
import { nest } from "@/lib/blockNester";
import { runBlockNesterSelfCheck } from "@/lib/blockNester.selfcheck";
import CutSheet from "./CutSheet";

const ITEM_ALIASES = ["item", "sku", "part", "part#", "partno", "itemno", "itemnumber", "code"];
const DESC_ALIASES = ["description", "desc", "itemdescription", "partdescription"];
const QTY_ALIASES = ["qty", "quantity", "orderqty", "qtyordered", "orderedqty"];

function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findColumn(headerRow: string[], aliases: string[]): number {
  const normalized = headerRow.map(normalizeHeader);
  for (const alias of aliases) {
    const idx = normalized.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseNum(v: string): number {
  const n = parseFloat(v);
  return Number.isNaN(n) ? 0 : n;
}

export default function BlocksApp() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [skuLines, setSkuLines] = useState<SkuLine[]>([]);
  const [blockSizes, setBlockSizes] = useState<BlockSizes>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [computeError, setComputeError] = useState<string | null>(null);
  const [nestResult, setNestResult] = useState<NestResult | null>(null);
  const [nestedBlockSizes, setNestedBlockSizes] = useState<BlockSizes>({});

  // Column/sheet picker — only shown when the first sheet's headers don't auto-match.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSheet, setPickerSheet] = useState("");
  const [pickerHeaderRow, setPickerHeaderRow] = useState<string[]>([]);
  const [pickerItemIdx, setPickerItemIdx] = useState<number>(-1);
  const [pickerDescIdx, setPickerDescIdx] = useState<number>(-1);
  const [pickerQtyIdx, setPickerQtyIdx] = useState<number>(-1);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const parserCheck = runPoParserSelfCheck();
    // eslint-disable-next-line no-console
    console[parserCheck.pass ? "log" : "warn"](
      `[blocks] PO parser self-check: ${parserCheck.pass ? "PASS" : "FAIL"}`,
      parserCheck.results
    );
    const nesterCheck = runBlockNesterSelfCheck();
    // eslint-disable-next-line no-console
    console[nesterCheck.pass ? "log" : "warn"](
      `[blocks] Nester self-check: ${nesterCheck.pass ? "PASS" : "FAIL"}`,
      nesterCheck.results
    );
  }, []);

  function applyMapping(
    wb: XLSX.WorkBook,
    sheetName: string,
    headerRow: string[],
    cols: { item: number; desc: number; qty: number }
  ) {
    const ws = wb.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    const inputRows: PoInputRow[] = rows.slice(1).map((r) => ({
      item: cols.item >= 0 ? String(r[cols.item] ?? "") : "",
      desc: String(r[cols.desc] ?? ""),
      qty: parseNum(String(r[cols.qty] ?? "0")),
    }));

    const parsed = parsePoRows(inputRows);
    setSkuLines(parsed);
    setUploadError(null);
    setNestResult(null);
    setComputeError(null);
    setPickerOpen(false);

    // Seed per-density block sizes for any newly discovered density, defaulting to that
    // density's DEFAULT_BLOCKS entry (the customer's current molds), falling back to
    // DEFAULT_BLOCK for any density not in that table.
    setBlockSizes((prev) => {
      const next = { ...prev };
      for (const line of parsed) {
        if (!line.parsed || line.density <= 0) continue;
        const key = String(line.density);
        if (!next[key]) next[key] = { ...(DEFAULT_BLOCKS[key] ?? DEFAULT_BLOCK) };
      }
      return next;
    });
  }

  function trySheet(wb: XLSX.WorkBook, sheetName: string) {
    const ws = wb.Sheets[sheetName];
    if (!ws) return;
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (!rows.length) {
      openPicker(wb, sheetName, []);
      return;
    }
    const headerRow = (rows[0] as unknown[]).map((h) => String(h ?? ""));
    const itemIdx = findColumn(headerRow, ITEM_ALIASES);
    const descIdx = findColumn(headerRow, DESC_ALIASES);
    const qtyIdx = findColumn(headerRow, QTY_ALIASES);

    if (descIdx === -1 || qtyIdx === -1) {
      openPicker(wb, sheetName, headerRow, itemIdx, descIdx, qtyIdx);
      return;
    }

    applyMapping(wb, sheetName, headerRow, { item: itemIdx, desc: descIdx, qty: qtyIdx });
  }

  function openPicker(
    wb: XLSX.WorkBook,
    sheetName: string,
    headerRow: string[],
    itemIdx = -1,
    descIdx = -1,
    qtyIdx = -1
  ) {
    setPickerSheet(sheetName);
    setPickerHeaderRow(headerRow);
    setPickerItemIdx(itemIdx);
    setPickerDescIdx(descIdx);
    setPickerQtyIdx(qtyIdx);
    setPickerOpen(true);
  }

  function pickerChangeSheet(sheetName: string) {
    if (!workbook) return;
    const ws = workbook.Sheets[sheetName];
    const rows: unknown[][] = ws ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) : [];
    const headerRow = rows.length ? (rows[0] as unknown[]).map((h) => String(h ?? "")) : [];
    setPickerSheet(sheetName);
    setPickerHeaderRow(headerRow);
    setPickerItemIdx(findColumn(headerRow, ITEM_ALIASES));
    setPickerDescIdx(findColumn(headerRow, DESC_ALIASES));
    setPickerQtyIdx(findColumn(headerRow, QTY_ALIASES));
  }

  function confirmPicker() {
    if (!workbook || pickerDescIdx < 0 || pickerQtyIdx < 0) return;
    applyMapping(workbook, pickerSheet, pickerHeaderRow, {
      item: pickerItemIdx,
      desc: pickerDescIdx,
      qty: pickerQtyIdx,
    });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      setWorkbook(wb);
      trySheet(wb, wb.SheetNames[0]);
    } catch {
      setUploadError("Couldn't read that file — is it a valid .xlsx?");
    }
  }

  function updateRow(idx: number, patch: Partial<SkuLine>) {
    setSkuLines((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function deleteRow(idx: number) {
    setSkuLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function addRow() {
    setSkuLines((prev) => [
      ...prev,
      { item: "", width: 0, length: 0, tlo: 0, thi: 0, density: 0, qty: 0, parsed: true, raw: "" },
    ]);
  }

  const presentDensities = useMemo(() => {
    const set = new Set<number>();
    for (const line of skuLines) {
      if (line.parsed && line.density > 0) set.add(line.density);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [skuLines]);

  function updateBlockSize(densityKey: string, patch: Partial<BlockSize>) {
    setBlockSizes((prev) => ({
      ...prev,
      [densityKey]: { ...(prev[densityKey] ?? DEFAULT_BLOCKS[densityKey] ?? DEFAULT_BLOCK), ...patch },
    }));
  }

  function handleReload() {
    setComputeError(null);
    setNestResult(null);

    const usable = skuLines.filter((l) => l.qty > 0);
    if (usable.length === 0) {
      setComputeError("No SKU lines with quantity — upload a PO or add rows to the grid.");
      return;
    }
    for (const d of presentDensities) {
      const bs = blockSizes[String(d)];
      if (!bs || bs.width <= 0 || bs.height <= 0 || bs.length <= 0) {
        setComputeError(`Block size for ${d}# density is missing or invalid.`);
        return;
      }
    }
    setNestResult(nest(skuLines, blockSizes));
    setNestedBlockSizes(blockSizes);
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-text">Block nesting</h2>
          <p className="text-sm text-muted">Upload a PO, correct the parse, set block sizes, nest.</p>
        </div>

        {/* Upload */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[44px] px-4 inline-flex items-center gap-2 bg-[var(--primary-bg)] text-[var(--primary-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <Upload size={16} aria-hidden="true" />
            Upload PO (.xlsx)
          </button>
          {uploadError && <span className="text-sm text-[var(--danger-bg)]">{uploadError}</span>}
        </div>

        {/* Editable grid */}
        {skuLines.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">Parsed SKUs ({skuLines.length})</h3>
              <button
                type="button"
                onClick={addRow}
                className="min-h-[36px] px-3 inline-flex items-center gap-1.5 bg-[var(--ghost-bg)] text-text border border-border rounded text-xs font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <Plus size={14} aria-hidden="true" />
                Add row
              </button>
            </div>

            <div className="overflow-x-auto border border-border rounded">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[var(--surface-2)] text-left text-xs text-muted">
                    <th className="px-2 py-2 font-medium">Item</th>
                    <th className="px-2 py-2 font-medium">Width</th>
                    <th className="px-2 py-2 font-medium">Length</th>
                    <th className="px-2 py-2 font-medium">Tlo</th>
                    <th className="px-2 py-2 font-medium">Thi</th>
                    <th className="px-2 py-2 font-medium">Density</th>
                    <th className="px-2 py-2 font-medium">Qty</th>
                    <th className="px-2 py-2 font-medium" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {skuLines.map((row, idx) => (
                    <tr
                      key={idx}
                      className="border-t border-border"
                      style={
                        !row.parsed
                          ? { background: "var(--warn-bg)" }
                          : undefined
                      }
                    >
                      <td className="p-1">
                        <input
                          type="text"
                          value={row.item}
                          onChange={(e) => updateRow(idx, { item: e.target.value })}
                          className="w-24 min-h-[44px] px-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded text-text text-sm"
                        />
                      </td>
                      {(["width", "length", "tlo", "thi", "density"] as const).map((field) => (
                        <td className="p-1" key={field}>
                          <input
                            type="number"
                            value={row[field]}
                            onChange={(e) => updateRow(idx, { [field]: parseNum(e.target.value) } as Partial<SkuLine>)}
                            className="w-20 min-h-[44px] px-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded text-text text-sm"
                          />
                        </td>
                      ))}
                      <td className="p-1">
                        <input
                          type="number"
                          value={row.qty}
                          onChange={(e) => updateRow(idx, { qty: parseNum(e.target.value) })}
                          className="w-20 min-h-[44px] px-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded text-text text-sm"
                        />
                      </td>
                      <td className="p-1 text-center">
                        <button
                          type="button"
                          onClick={() => deleteRow(idx)}
                          aria-label={`Delete row ${idx + 1}`}
                          className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-muted hover:text-[var(--danger-bg)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {skuLines.some((r) => !r.parsed) && (
              <p className="flex items-center gap-1.5 text-xs text-[var(--warn-text)]">
                <AlertTriangle size={14} aria-hidden="true" />
                Highlighted rows couldn&apos;t be auto-parsed — correct them by hand.
              </p>
            )}
          </div>
        )}

        {/* Per-density block-size inputs */}
        {presentDensities.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-text">Block size by density</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {presentDensities.map((d) => {
                const key = String(d);
                const bs = blockSizes[key] ?? DEFAULT_BLOCKS[key] ?? DEFAULT_BLOCK;
                return (
                  <div key={key} className="border border-border rounded p-3 space-y-2">
                    <div className="text-sm font-semibold text-text">{d}# density</div>
                    <div className="grid grid-cols-3 gap-2">
                      {(["width", "height", "length"] as const).map((dim) => (
                        <label key={dim} className="text-xs text-muted flex flex-col gap-1">
                          {dim}
                          <input
                            type="number"
                            value={bs[dim]}
                            onChange={(e) => updateBlockSize(key, { [dim]: parseNum(e.target.value) } as Partial<BlockSize>)}
                            className="min-h-[44px] px-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded text-text text-sm"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Reload cut sheet */}
        {skuLines.length > 0 && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleReload}
              className="min-h-[44px] px-5 inline-flex items-center gap-2 bg-[var(--brand)] text-white rounded text-sm font-semibold cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <RefreshCw size={16} aria-hidden="true" />
              Reload cut sheet
            </button>
            {computeError && <p className="text-sm text-[var(--danger-bg)]">{computeError}</p>}
          </div>
        )}

        {/* Cut sheet */}
        {nestResult && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-text">Cut sheet</h3>
            <CutSheet result={nestResult} blockSizes={nestedBlockSizes} />
          </div>
        )}
      </div>

      {/* Sheet/column picker — only surfaced when the first sheet's headers don't auto-match */}
      <Modal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} title="Confirm columns" size="lg">
        <div className="space-y-3">
          <label className="text-xs text-muted flex flex-col gap-1">
            Sheet
            <select
              value={pickerSheet}
              onChange={(e) => pickerChangeSheet(e.target.value)}
              className="min-h-[44px] px-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded text-text text-sm"
            >
              {(workbook?.SheetNames ?? []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {(["item", "desc", "qty"] as const).map((field) => {
            const value = field === "item" ? pickerItemIdx : field === "desc" ? pickerDescIdx : pickerQtyIdx;
            const setValue = field === "item" ? setPickerItemIdx : field === "desc" ? setPickerDescIdx : setPickerQtyIdx;
            const label = field === "item" ? "Item (optional)" : field === "desc" ? "Description" : "Qty";
            return (
              <label key={field} className="text-xs text-muted flex flex-col gap-1">
                {label}
                <select
                  value={value}
                  onChange={(e) => setValue(Number(e.target.value))}
                  className="min-h-[44px] px-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded text-text text-sm"
                >
                  <option value={-1}>— none —</option>
                  {pickerHeaderRow.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="min-h-[44px] px-4 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pickerDescIdx < 0 || pickerQtyIdx < 0}
              onClick={confirmPicker}
              className="min-h-[44px] px-4 bg-[var(--brand)] text-white rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
            >
              Use these columns
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
