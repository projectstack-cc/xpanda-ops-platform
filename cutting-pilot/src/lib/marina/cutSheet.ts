// src/lib/marina/cutSheet.ts — marina-05
// Pure cut-sheet text → part suggestion (label, dim chips, notes) for the Marina setup screen. No
// imports beyond inches.ts: the browser feeds it pdf.js getTextContent() items, the selfcheck feeds it
// the real fixtures in ./fixtures. Rules were tuned on Piper's real sheets (D7 CR, D7 L, D6 L, 2095):
//   1. Drop empty / whitespace-only items (pdf.js emits "" markers and a " " spanning the page).
//   2. Lines = same baseline within 0.5×h, ordered by x, SPLIT where the x gap from the previous item's
//      right edge exceeds 1×h (the "… TOP" label shares a baseline with "CUT TIME:" and "… TOP2").
//   3. Merge "41" + "3/8" (fraction starting within 1×h of the whole number's right edge) → "41 3/8".
//   4. Label = first line (print order) matching /^(.+?)\s+TOP$/i, else the fallback.
//   5. Chips = purely numeric tokens on lines that are not label / note / cut-time lines; parseInches,
//      drop null / 0 / > 2000 and any value equal to a standalone number in the label; dedupe by 1/16
//      (first printed text wins); sort descending.
//   6. Notes = REPLACE / NO FI… lines (tolerates OCR "NO FIRE"), deduped, "\n"-joined. CUT TI… lines
//      (tolerates OCR "CUT TIRE") are ignored.
import { parseInches, roundToSixteenth } from "../inches";

export interface TextItem { str: string; x: number; y: number; w: number; h: number; }
export interface DimChip { value_in: number; text: string; }          // text = as printed, normalized ("41 3/8")
export interface PageSuggestion { label: string; labelFromText: boolean; chips: DimChip[]; notes: string; hasText: boolean; }

const MAX_IN = 2000;
const MIN_H = 4; // floor for a non-empty item reported with h = 0, so the tolerances never collapse
const NUMERIC = /^(?:\d+(?:\.\d+)?|\.\d+|\d+ \d+\/\d+|\d+\/\d+|\d+-\d+\/\d+)$/;
const LABEL_RE = /^(.+?)\s+TOP$/i;
const NOTE_RE = /\bREPLACE\b|\bNO\s*FI\w*\b/i;
const CUT_TIME_RE = /\bCUT\s*TI\w*\b/i;

const r1 = (n: number) => Math.round(n * 10) / 10;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

// pdf.js TextContent.items → TextItem[] (marked-content entries have no `str` and are skipped).
// Same mapping as the step-0 fixture dump: x/y from transform, h = height || |transform[3]|, 0.1 rounding.
export function textItemsFromContent(items: readonly unknown[]): TextItem[] {
  const out: TextItem[] = [];
  for (const raw of items) {
    const it = raw as { str?: unknown; transform?: number[]; width?: number; height?: number };
    if (typeof it?.str !== "string" || !Array.isArray(it.transform)) continue;
    const t = it.transform;
    out.push({ str: it.str, x: r1(t[4] ?? 0), y: r1(t[5] ?? 0), w: r1(it.width ?? 0), h: r1(it.height || Math.abs(t[3] ?? 0)) });
  }
  return out;
}

interface Tok { text: string; x: number; right: number; h: number; order: number; }
interface Line { text: string; toks: Tok[]; order: number; }

function buildLines(items: TextItem[]): Line[] {
  const toks: (Tok & { y: number })[] = [];
  items.forEach((it, i) => {
    const text = squash(it.str);
    if (!text) return;
    const h = Math.max(it.h || 0, MIN_H);
    toks.push({ text, x: it.x, right: it.x + Math.max(it.w || 0, 0), h, order: i, y: it.y });
  });

  // Baseline rows: greedy over y (descending = top of page first in PDF space).
  const byY = [...toks].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: (typeof toks)[] = [];
  for (const t of byY) {
    const row = rows.find((r) => Math.abs(r[0].y - t.y) <= 0.5 * Math.max(r[0].h, t.h));
    if (row) row.push(t);
    else rows.push([t]);
  }

  const lines: Line[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let seg: Tok[] = [];
    const flush = () => {
      if (!seg.length) return;
      const merged = mergeFractions(seg);
      lines.push({ text: merged.map((m) => m.text).join(" "), toks: merged, order: Math.min(...seg.map((s) => s.order)) });
      seg = [];
    };
    for (const t of row) {
      const prev = seg[seg.length - 1];
      if (prev && t.x - prev.right > Math.max(prev.h, t.h)) flush();
      seg.push(t);
    }
    flush();
  }
  return lines.sort((a, b) => a.order - b.order);
}

// "41" + "3/8" (fraction starting within 1×h of the whole number's right edge) → one "41 3/8" token.
function mergeFractions(seg: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < seg.length; i++) {
    const a = seg[i];
    const b = seg[i + 1];
    if (b && /^\d+$/.test(a.text) && /^\d+\/\d+$/.test(b.text) && b.x - a.right <= a.h) {
      out.push({ text: `${a.text} ${b.text}`, x: a.x, right: b.right, h: Math.max(a.h, b.h), order: a.order });
      i++;
    } else {
      out.push(a);
    }
  }
  return out;
}

function normalizeDimText(s: string): string {
  return squash(s).replace(/^(\d+)-(\d+\/\d+)$/, "$1 $2");
}

export function suggestFromPage(items: TextItem[], fallbackLabel: string): PageSuggestion {
  const hasText = items.some((i) => i.str.trim());
  const lines = buildLines(items);

  let label = fallbackLabel;
  let labelFromText = false;
  let labelLine: Line | null = null;
  for (const line of lines) {
    const m = line.text.match(LABEL_RE);
    if (m && squash(m[1])) {
      label = squash(m[1]);
      labelFromText = true;
      labelLine = line;
      break;
    }
  }
  const labelNumbers = labelFromText
    ? label.split(" ").filter((p) => /^\d+(?:\.\d+)?$/.test(p)).map((p) => roundToSixteenth(Number(p)))
    : [];

  const notes: string[] = [];
  const chips: DimChip[] = [];
  const seen = new Set<number>();
  for (const line of lines) {
    if (CUT_TIME_RE.test(line.text)) continue;
    if (NOTE_RE.test(line.text)) {
      if (!notes.includes(line.text)) notes.push(line.text);
      continue;
    }
    if (line === labelLine) continue;
    for (const tok of line.toks) {
      if (!NUMERIC.test(tok.text)) continue;
      const v = parseInches(tok.text);
      if (v === null || v <= 0 || v > MAX_IN) continue;
      const key = roundToSixteenth(v);
      if (labelNumbers.includes(key) || seen.has(key)) continue;
      seen.add(key);
      chips.push({ value_in: v, text: normalizeDimText(tok.text) });
    }
  }
  chips.sort((a, b) => b.value_in - a.value_in);

  return { label, labelFromText, chips, notes: notes.join("\n"), hasText };
}

// "D7 CR.pdf", 3 → "D7 CR 3"; no filename → "Page 3".
export function fallbackLabelFor(filename: string | null, pageNo: number): string {
  const base = squash(squash(String(filename ?? "")).replace(/\.pdf$/i, ""));
  return `${base || "Page"} ${pageNo}`;
}
