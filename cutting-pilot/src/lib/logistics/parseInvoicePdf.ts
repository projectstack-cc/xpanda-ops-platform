// src/lib/logistics/parseInvoicePdf.ts
// Client-side freight-invoice PDF parser (PXXX invoice-analytics -d). Reuses the pdf.js loader
// pattern from src/lib/packingSlip.ts (a fresh copy, not a shared import — packingSlip.ts is
// left untouched per that file's own "do not edit" note). Column layout was validated against
// the real "26.03 Lisma Invoice Details 4611.pdf" (93 real line items, provided by Steve) — see
// parseInvoiceFromItems' doc comment for what that validation found.
//
// This is the ONLY PDF parsing in the whole invoice-analytics feature. Output rows are POSTed
// to /v2/api/logistics/invoice (-c), which does the actual BOL-token extraction, address
// resolution and mileage math — this file only reconstructs {lineNo, shipDate, loadNumber,
// poText, amount} + the header fields from the PDF's raw text layout.

export interface ParsedInvoiceLine {
  lineNo: number;
  shipDate?: string;
  loadNumber?: string;
  poText: string;
  amount: number;
}

export interface ParsedInvoice {
  vendor: string;
  invoiceNumber: string;
  invoiceDate?: string;
  lines: ParsedInvoiceLine[];
}

interface RawItem {
  text: string;
  x: number;
  y: number;
  width: number;
  page: number;
}

// ─── pdf.js loading (copied from packingSlip.ts's loadPdfJs — see that file's header note) ──

let _pdfjs: typeof import("pdfjs-dist") | null = null;

async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  const mod = await import("pdfjs-dist");
  mod.GlobalWorkerOptions.workerSrc = "/v2/pdf.worker.min.mjs";
  _pdfjs = mod;
  return _pdfjs;
}

// ─── Text layout reconstruction (copied from packingSlip.ts) ────────────────────────────────

interface LineGroup {
  y: number;
  items: RawItem[];
}

function groupByY(items: RawItem[], tol: number): LineGroup[] {
  const groups: LineGroup[] = [];
  for (const item of items) {
    let matched = false;
    for (const g of groups) {
      if (Math.abs(g.y - item.y) <= tol) {
        g.items.push(item);
        matched = true;
        break;
      }
    }
    if (!matched) groups.push({ y: item.y, items: [item] });
  }
  return groups;
}

function reconstructLine(sortedItems: RawItem[]): string {
  if (!sortedItems.length) return "";
  let result = sortedItems[0].text;
  let prevRight = sortedItems[0].x + (sortedItems[0].width || sortedItems[0].text.length * 5.5);
  for (let i = 1; i < sortedItems.length; i++) {
    const gap = sortedItems[i].x - prevRight;
    const spaces = gap > 5 ? Math.max(2, Math.min(40, Math.round(gap / 5))) : 1;
    result += " ".repeat(spaces) + sortedItems[i].text;
    prevRight = sortedItems[i].x + (sortedItems[i].width || sortedItems[i].text.length * 5.5);
  }
  return result;
}

// Joins a wrapped cell's lines (already in top-to-bottom order) into one string. A line ending
// in "-" is a real mid-token line break (confirmed on the real PDF: "VISTA CENTER EXPANSION
// (3715-" wraps to "03)" on the next line, one BOL token "3715-03" split across the wrap, not
// two words) — join those two pieces directly, no space. Every other line boundary is a real
// word/word gap and gets one.
function joinWrappedCell(pieces: string[]): string {
  let out = "";
  for (const piece of pieces) {
    if (!out) out = piece;
    else if (out.endsWith("-")) out += piece;
    else out += " " + piece;
  }
  return out.trim();
}

// ─── Column-band detection ────────────────────────────────────────────────────────────────
//
// The real Lisma/Seal table has 5 LABELED headers ("#", "Date", "Load #", "PO #", "Amount")
// but 6 visual columns — an unlabeled description column sits between "Load #" and "PO #"
// (confirmed against the real PDF: body text there has its own stable x, just no header
// token). Naively assigning every item to its nearest LABELED header x mis-assigns that
// description column into "Load #" (it's numerically closer to Load #'s x than to PO #'s).
// Two more real wrinkles: the "PO #" header token itself sits ~60pt right of where the PO #
// column's body text actually starts (headers are centered/right-shifted, body is left-
// aligned), and "Amount" is right-aligned (wider dollar amounts start further left) — so a
// column's body x is not always close to its own header x, and can't be trusted to be
// perfectly constant either.
//
// Fix: cluster ALL body-row x positions (gap-based 1D clustering — a real inter-column gap is
// tens of points, real intra-column jitter is near zero), keep only clusters big enough to be
// a real column (drops one-off noise like a "Total:" label's own x), then match the 5 labeled
// headers to those clusters by LEFT-TO-RIGHT ORDER rather than raw x distance — distance alone
// picks the wrong cluster for "PO #" on the real invoice (its header token sits closer to the
// Amount column's body x than to PO #'s own, since Amount is right-aligned and shifts left for
// wider dollar amounts). When there's exactly one more significant cluster than there are
// headers, the extra one is the unlabeled description column — known, on both real vendor
// layouts, to sit between "Load #" and "PO #" — and is skipped positionally, never assigned to
// any of the 5 columns ParseInvoiceLine actually needs. Its content is simply never read.
interface Cluster {
  min: number;
  max: number;
  count: number;
}

const CLUSTER_GAP = 20;
const COLUMN_MARGIN = 8;

// Deliberately NOT deduplicated — count must reflect how many items actually sit in a band
// (roughly one per data row) so significantClusters() can tell a real column apart from a
// stray one-off label at a nearby x (see its own comment).
function clusterXs(xs: number[]): Cluster[] {
  const sorted = xs.map((x) => Math.round(x * 100) / 100).sort((a, b) => a - b);
  const clusters: number[][] = [];
  let cur: number[] = [];
  for (const x of sorted) {
    if (cur.length && x - cur[cur.length - 1] > CLUSTER_GAP) {
      clusters.push(cur);
      cur = [];
    }
    cur.push(x);
  }
  if (cur.length) clusters.push(cur);
  return clusters.map((c) => ({ min: c[0], max: c[c.length - 1], count: c.length }));
}

// Real columns are hit once (or a few times, for a wrapped cell) per data row — dozens of
// items. A stray label like a "Total:" row's own x position forms its own 1-item cluster that
// can sit numerically closer to a header token than the real column (the "PO #" header, in
// particular, sits well right of the PO # column's own body text — see the big comment above).
// Dropping low-count clusters before nearest-matching keeps that noise from ever winning.
function significantClusters(clusters: Cluster[]): Cluster[] {
  const maxCount = Math.max(0, ...clusters.map((c) => c.count));
  const floor = Math.max(3, maxCount * 0.15);
  return clusters.filter((c) => c.count >= floor);
}

function nearestCluster(clusters: Cluster[], x: number): Cluster | null {
  let best: Cluster | null = null;
  let bestDist = Infinity;
  for (const c of clusters) {
    const dist = x < c.min ? c.min - x : x > c.max ? x - c.max : 0;
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

type ColumnName = "#" | "date" | "load" | "po" | "amount";

// headers must already be in left-to-right x order (#, date, load, po, amount). clusters must
// already be in left-to-right min-x order.
function matchColumnsToClusters(
  headers: { name: ColumnName; x: number }[],
  clusters: Cluster[]
): Partial<Record<ColumnName, Cluster>> {
  const result: Partial<Record<ColumnName, Cluster>> = {};

  if (clusters.length === headers.length) {
    headers.forEach((h, i) => {
      result[h.name] = clusters[i];
    });
    return result;
  }

  if (clusters.length === headers.length + 1) {
    // Exactly one unclaimed column — the unlabeled description column between "Load #" (header
    // index 2) and "PO #" (header index 3). Skip cluster index 3 (0-based); shift everything
    // from "PO #" onward by one.
    let ci = 0;
    headers.forEach((h, hi) => {
      if (hi === 3) ci++;
      result[h.name] = clusters[ci];
      ci++;
    });
    return result;
  }

  // Unexpected column count (not one of the two known vendor layouts) — fall back to
  // nearest-by-distance per header rather than refusing to parse at all.
  for (const h of headers) {
    const c = nearestCluster(clusters, h.x);
    if (c) result[h.name] = c;
  }
  return result;
}

function inColumn(clusters: Partial<Record<ColumnName, Cluster>>, name: ColumnName, x: number): boolean {
  const c = clusters[name];
  if (!c) return false;
  return x >= c.min - COLUMN_MARGIN && x <= c.max + COLUMN_MARGIN;
}

// Finds the header row (the y-group containing "Date"/"Load"/"PO"/"Amount" tokens) and returns
// each labeled header's {name, x}. Returns null if no header row is found (caller falls back
// to raw header-token x's with no clustering — degrades gracefully rather than throwing).
function findHeaderTokens(items: RawItem[]): { name: ColumnName; x: number; y: number }[] | null {
  const page1 = items.filter((it) => it.page === 1);
  const groups = groupByY(page1, 3);
  for (const g of groups) {
    const text = reconstructLine([...g.items].sort((a, b) => a.x - b.x));
    if (/\bDate\b/i.test(text) && /\bLoad\b/i.test(text) && /\bPO\b/i.test(text) && /\bAmount\b/i.test(text)) {
      const tokens: { name: ColumnName; x: number; y: number }[] = [];
      for (const it of g.items) {
        const t = it.text.trim();
        if (/^#$/.test(t)) tokens.push({ name: "#", x: it.x, y: g.y });
        else if (/^Date$/i.test(t)) tokens.push({ name: "date", x: it.x, y: g.y });
        else if (/^Load/i.test(t)) tokens.push({ name: "load", x: it.x, y: g.y });
        else if (/^PO/i.test(t)) tokens.push({ name: "po", x: it.x, y: g.y });
        else if (/^Amount$/i.test(t)) tokens.push({ name: "amount", x: it.x, y: g.y });
      }
      return tokens.length === 5 ? tokens : null;
    }
  }
  return null;
}

// ─── Header block (vendor / invoice # / invoice date) ────────────────────────────────────────

function deriveVendor(companyLine: string): string {
  if (/lisma/i.test(companyLine)) return "Lisma";
  if (/seal\s*express/i.test(companyLine)) return "Seal Express";
  return companyLine.trim();
}

// mm/dd/yy or mm/dd/yyyy -> yyyy-mm-dd. Returns the raw string if it doesn't parse cleanly.
function toIsoDate(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return raw.trim();
  const [, mm, dd, yy] = m;
  const year = yy.length === 2 ? `20${yy}` : yy;
  return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function extractHeader(items: RawItem[], headerY: number): { vendor: string; invoiceNumber: string; invoiceDate?: string } {
  const page1 = items.filter((it) => it.page === 1 && it.y > headerY);
  const groups = groupByY(page1, 3).sort((a, b) => b.y - a.y);
  const lines = groups.map((g) => reconstructLine([...g.items].sort((a, b) => a.x - b.x)));

  let vendor = "";
  for (const line of lines) {
    if (/lisma/i.test(line) || /seal\s*express/i.test(line)) {
      vendor = deriveVendor(line);
      break;
    }
  }

  let invoiceNumber = "";
  for (const line of lines) {
    // Capture an optional short alpha prefix + the digits ("SE 5046", "SE5046", "4611"). Requiring a
    // digit means a bare prefix like "SE" can never become the key — the old (\S+) stopped at the
    // first space and stored every Seal Express invoice as "SE" (inv-dup-01).
    const m = line.match(/Invoice\s*#\s*([A-Za-z]{0,4}[\s-]?\d[\w-]*)/i);
    if (m) {
      invoiceNumber = m[1].replace(/\s+/g, " ").trim();
      break;
    }
  }

  let invoiceDate: string | undefined;
  for (const line of lines) {
    const m = line.match(/^Date:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (m) {
      invoiceDate = toIsoDate(m[1]);
      break;
    }
  }

  return { vendor, invoiceNumber, invoiceDate };
}

// ─── Row extraction (pure — testable without pdf.js) ─────────────────────────────────────────
//
// A logical row is anchored by its "#" column integer (1, 2, 3, ...) — the only column that's
// reliably single-line and monotonically sequential. Every other item (Date/Load #/PO #/
// Amount) is assigned to whichever row's "#" baseline is Y-NEAREST to it, not to a fixed
// "between this row's y and the next row's y" window — a wrapped PO # cell can wrap to a line
// ABOVE its own row's numeric baseline as easily as below it (confirmed on the real PDF: row 4's
// 3-line PO # cell has one line above its baseline, one at it, one below), so nearest-baseline
// is the only rule that assigns every wrapped line to the correct row regardless of which way
// it wraps. The trailing "Total:" row has no "#" cell, so it never becomes a baseline and its
// Amount/label text is simply never claimed by any row.
export function parseInvoiceFromItems(items: RawItem[]): ParsedInvoice {
  const headerTokens = findHeaderTokens(items);

  let clusters: Partial<Record<ColumnName, Cluster>> = {};
  let headerY = 0;

  // Everything at or above the header row's own y on page 1 is masthead/header text, never a
  // data row — excluded from both column-band detection and row-content matching so the header
  // row's own "Date"/"Load #"/"PO #"/"Amount" cells can never be mistaken for the nearest
  // baseline's content (they'd otherwise be numerically closest to row 1).
  let bodyItems = items;

  if (headerTokens) {
    headerY = headerTokens[0].y;
    bodyItems = items.filter((it) => !(it.page === 1 && it.y >= headerY - 3));
    const sortedHeaders = [...headerTokens].sort((a, b) => a.x - b.x);
    const bandClusters = significantClusters(clusterXs(bodyItems.map((it) => it.x))).sort(
      (a, b) => a.min - b.min
    );
    clusters = matchColumnsToClusters(sortedHeaders, bandClusters);
  }

  const header = extractHeader(items, headerY);

  // "#" column baselines, in reading order (page, then descending y).
  const hashItems = bodyItems
    .filter((it) => inColumn(clusters, "#", it.x) && /^\d+$/.test(it.text.trim()))
    .sort((a, b) => (a.page !== b.page ? a.page - b.page : b.y - a.y));

  const lines: ParsedInvoiceLine[] = [];

  for (let i = 0; i < hashItems.length; i++) {
    const baseline = hashItems[i];
    const lineNo = parseInt(baseline.text.trim(), 10);
    if (!Number.isFinite(lineNo)) continue;

    // Candidate items: same page, within a generous y-window so a neighboring row's baseline
    // (on the same page) can win the nearest-baseline comparison below.
    const pageBaselines = hashItems.filter((h) => h.page === baseline.page);
    const pageItems = bodyItems.filter((it) => it.page === baseline.page);

    const nearestIsThisRow = (y: number) => {
      let best: RawItem | null = null;
      let bestDist = Infinity;
      for (const b of pageBaselines) {
        const dist = Math.abs(b.y - y);
        if (dist < bestDist) {
          bestDist = dist;
          best = b;
        }
      }
      return best === baseline;
    };

    const dateItem = pageItems.find((it) => inColumn(clusters, "date", it.x) && nearestIsThisRow(it.y));
    const loadItem = pageItems.find((it) => inColumn(clusters, "load", it.x) && nearestIsThisRow(it.y));
    const amountItem = pageItems.find((it) => inColumn(clusters, "amount", it.x) && nearestIsThisRow(it.y));
    const poItems = pageItems
      .filter((it) => inColumn(clusters, "po", it.x) && nearestIsThisRow(it.y))
      .sort((a, b) => b.y - a.y);

    const poText = joinWrappedCell(poItems.map((it) => it.text.trim()));
    const amountText = (amountItem?.text ?? "").replace(/[$,]/g, "").trim();
    const amount = amountText ? parseFloat(amountText) : NaN;

    lines.push({
      lineNo,
      shipDate: dateItem ? toIsoDate(dateItem.text) : undefined,
      loadNumber: loadItem ? loadItem.text.trim() : undefined,
      poText,
      amount: Number.isFinite(amount) ? amount : 0,
    });
  }

  return { vendor: header.vendor, invoiceNumber: header.invoiceNumber, invoiceDate: header.invoiceDate, lines };
}

// ─── Public API ────────────────────────────────────────────────────────────────────────────

export async function parseInvoicePdf(file: File): Promise<ParsedInvoice> {
  const lib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: arrayBuffer }).promise;

  const items: RawItem[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const pageItems: RawItem[] = tc.items
      .filter((item: any) => item.str && item.str.trim())
      .map((item: any) => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width || 0,
        page: p,
      }));
    items.push(...pageItems);
  }

  return parseInvoiceFromItems(items);
}
