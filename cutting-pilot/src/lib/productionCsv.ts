// src/lib/productionCsv.ts
// RFC 4180 CSV for the Production report exports (prod-c-04). toCsv is pure; downloadCsv touches
// the DOM and must only run client-side.

type Cell = string | number | null | undefined;

function field(v: Cell): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Quotes fields containing , " CR or LF (embedded quotes doubled); null → empty; CRLF line endings.
export function toCsv(headers: string[], rows: Cell[][]): string {
  return [headers, ...rows].map((r) => r.map(field).join(",")).join("\r\n") + "\r\n";
}

// UTF-8 with BOM so Excel reads accented es / ht names correctly.
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
