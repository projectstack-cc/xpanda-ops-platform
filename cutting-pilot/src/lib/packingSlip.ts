// src/lib/packingSlip.ts
// Client-side parser for XPanda Foam packing slip PDFs (generated from QuickBooks).
// Ported as-is (behavioral parity) from jobs/packing-slip-parser.js — same y-coordinate/x-gap
// layout-reconstruction heuristics, same field-extraction regexes. This is NOT the
// anchor-relative rewrite (a separate future prompt) — do not "improve" the heuristics here.
//
// Uses the npm `pdfjs-dist` package (pinned to 4.4.168, the exact version the legacy CDN
// import loads) instead of a CDN <script>/dynamic import, so the build can bundle the library
// itself. The WORKER file is deliberately NOT routed through webpack's `new URL(...,
// import.meta.url)` asset-module trick — Next's Terser pass tries to minify the emitted `.mjs`
// as a non-module script and fails on its `import`/`export` statements. Instead, the postbuild
// `scripts/copy-pdf-worker.mjs` copies pdf.worker.min.mjs straight from node_modules into
// `.open-next/assets/v2/pdf.worker.min.mjs` (bypassing the JS pipeline entirely), and
// `workerSrc` below points at the literal `/v2/pdf.worker.min.mjs` URL — matching the physical
// path the Cloudflare Workers asset binding will actually serve, same "asset PATH must match
// the asset URL" discipline as the `_next` relocation (see next-platform-agent's P205 lesson).
//
// Field mapping onto the P339 OrderPayload/OrderLineItem shape is ported from jobs/index.html's
// prefillForm(): `customer` and `ship_to_*` come from the parsed SHIP TO block (not BILL TO —
// legacy deliberately uses ship-to as the customer name), ship_date converts MM/DD/YYYY →
// YYYY-MM-DD for the <input type="date">. Part-number matching against the parts library
// (matchLineItemToPart/getPartsLibrary in jobs/index.html) is legacy job-board-specific and is
// NOT ported here — out of P340's scope; line items come through with a blank part_number for
// manual entry, same as an unmatched row would in the legacy flow.

import type { OrderLineItem } from "@/components/orders/OrderEntryForm";

interface RawItem {
  text: string;
  x: number;
  y: number;
  width: number;
  page: number;
}

interface LineGroup {
  y: number;
  items: RawItem[];
}

interface ReconstructedLine {
  y: number;
  items: RawItem[];
  text: string;
}

interface ParsedAddress {
  company: string;
  attention?: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

interface ParsedLineItem {
  category: string;
  description: string;
  label: string;
  dimensions: string;
  quantity: number;
  qty_unit: "bdft" | "pcs";
  thickness?: number;
  _isNotes?: boolean;
  _descLines?: string[];
}

interface ParsedDoc {
  invoice_number: string;
  date: string;
  bill_to: ParsedAddress;
  ship_to: ParsedAddress;
  ship_date: string;
  ship_via: string;
  contact_name: string;
  contact_phone: string;
  po_number: string;
  line_items: ParsedLineItem[];
}

export interface PackingSlipPrefill {
  customer?: string;
  po_number?: string;
  invoice_number?: string;
  ship_to_company?: string;
  ship_to_attention?: string;
  ship_to_street?: string;
  ship_to_city?: string;
  ship_to_state?: string;
  ship_to_zip?: string;
  ship_date?: string;
  contact_name?: string;
  contact_phone?: string;
  line_items?: OrderLineItem[];
}

export type ParsePackingSlipResult =
  | { success: true; data: PackingSlipPrefill; filename: string }
  | { success: false; error: string };

// ─── pdf.js loading ──────────────────────────────────────────────────────

let _pdfjs: typeof import("pdfjs-dist") | null = null;

async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  const mod = await import("pdfjs-dist");
  // basePath ("/v2") applies automatically to page/API routing but NOT to this literal string —
  // it must match the physical file scripts/copy-pdf-worker.mjs places post-build.
  mod.GlobalWorkerOptions.workerSrc = "/v2/pdf.worker.min.mjs";
  _pdfjs = mod;
  return _pdfjs;
}

// ─── Text layout reconstruction ──────────────────────────────────────────

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

// ─── Address block parsers ────────────────────────────────────────────────

function parseCityStateLine(text: string, obj: ParsedAddress) {
  const m = text.match(/^(.+?),?\s+([A-Z]{2})\s*$/);
  if (m) {
    obj.city = m[1].trim();
    obj.state = m[2];
  } else {
    obj.city = text.trim();
  }
}

function parseBillTo(rows: string[]): ParsedAddress {
  const bt: ParsedAddress = { company: "", street: "", city: "", state: "", zip: "" };
  const r = rows.filter((t) => t && !/^BILL\s+TO$/i.test(t.trim()));
  let i = 0;
  if (i < r.length) bt.company = r[i++].trim();
  if (i < r.length) bt.street = r[i++].trim();
  if (i < r.length) parseCityStateLine(r[i++], bt);
  if (i < r.length && /^\d{5}(-\d{4})?$/.test(r[i].trim())) bt.zip = r[i].trim();
  return bt;
}

function parseShipTo(rows: string[]): ParsedAddress {
  const st: ParsedAddress = { company: "", attention: "", street: "", city: "", state: "", zip: "" };
  const r = rows.filter((t) => t && !/^SHIP\s+TO$/i.test(t.trim()));
  if (!r.length) return st;

  let cityStateIdx = -1;
  let zipIdx = -1;

  for (let i = r.length - 1; i >= 0; i--) {
    const line = r[i].trim();
    if (/^\d{5}(-\d{4})?$/.test(line)) {
      zipIdx = i;
      st.zip = line;
      continue;
    }
    const csz = line.match(/^(.+?),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (csz) {
      cityStateIdx = i;
      st.city = csz[1].trim();
      st.state = csz[2];
      st.zip = csz[3];
      break;
    }
    const cs = line.match(/^(.+?),?\s+([A-Z]{2})$/);
    if (cs && cs[1].length > 1) {
      cityStateIdx = i;
      st.city = cs[1].trim();
      st.state = cs[2];
      break;
    }
  }

  const endIdx = cityStateIdx >= 0 ? cityStateIdx : zipIdx >= 0 ? zipIdx : r.length;
  let streetIdx = -1;

  for (let i = endIdx - 1; i >= 0; i--) {
    const line = r[i].trim();
    if (
      /^\d+\s/.test(line) ||
      /\b(St|Rd|Ave|Blvd|Dr|Ln|Lane|Ct|Way|Pkwy|Terrace|Circle|Place|Highway|Hwy)\b/i.test(line)
    ) {
      streetIdx = i;
      st.street = line;
      break;
    }
  }

  let attnIdx = -1;
  for (let i = 0; i < endIdx; i++) {
    if (/^Attn:/i.test(r[i].trim())) {
      attnIdx = i;
      let attnText = r[i].replace(/^Attn:\s*/i, "").trim();
      if (i + 1 < endIdx && i + 1 !== streetIdx && /^[&a-zA-Z]/.test(r[i + 1].trim()) && !/^\d/.test(r[i + 1].trim())) {
        attnText += " " + r[i + 1].trim();
        attnIdx = i + 1;
      }
      st.attention = attnText;
      break;
    }
  }
  void attnIdx;

  let compEndIdx = endIdx;
  const firstAttnIdx = r.findIndex((l) => /^Attn:/i.test(l.trim()));
  if (firstAttnIdx >= 0) compEndIdx = Math.min(compEndIdx, firstAttnIdx);
  if (streetIdx >= 0) compEndIdx = Math.min(compEndIdx, streetIdx);

  const companyLines = r.slice(0, Math.max(1, compEndIdx)).map((l) => l.trim());
  st.company = companyLines.join(" ").trim();

  if (!st.zip && cityStateIdx < 0) {
    const lastLine = r[r.length - 1].trim();
    const zipMatch = lastLine.match(/(\d{5}(-\d{4})?)$/);
    if (zipMatch) st.zip = zipMatch[1];
  }

  return st;
}

// ─── Line item parsing ────────────────────────────────────────────────────

function isItemHeader(sortedItems: RawItem[]): boolean {
  if (sortedItems.length < 2) return false;
  const last = sortedItems[sortedItems.length - 1];
  const qtyText = last.text.trim().replace(/,/g, "");
  if (!/^\d+$/.test(qtyText)) return false;
  const prev = sortedItems[sortedItems.length - 2];
  const gap = last.x - (prev.x + (prev.width || prev.text.length * 5.5));
  return gap > 50;
}

// Extract a Holey Board thickness (the trailing inch value) from an item's text.
function extractThickness(text: string): number | null {
  if (!text) return null;
  const stripped = String(text).replace(/\([^)]*\)/g, " ");
  const re = /(\d+(?:\.\d+)?)\s*["“”″]/g;
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped)) !== null) matches.push(match);
  if (!matches.length) return null;
  const t = parseFloat(matches[matches.length - 1][1]);
  return isNaN(t) ? null : t;
}

function parseLineItems(groups: LineGroup[], descriptionY: number): ParsedLineItem[] {
  const items: ParsedLineItem[] = [];
  let current: ParsedLineItem | null = null;

  const relevant = groups.filter((lg) => lg.y < descriptionY).sort((a, b) => b.y - a.y);

  for (const lg of relevant) {
    const sorted = [...lg.items].sort((a, b) => a.x - b.x);
    const lineText = reconstructLine(sorted).trim();
    if (!lineText) continue;

    if (/^\s*DESCRIPTION\b/i.test(lineText) && /\bQTY\b/i.test(lineText)) continue;

    if (/Commodities requiring/i.test(lineText)) break;
    if (/NOTE:\s*Liability/i.test(lineText)) break;
    if (/Customer acknowledges/i.test(lineText)) break;
    if (/certify that/i.test(lineText)) break;
    if (/Carrier Signature/i.test(lineText)) break;
    if (/Shipper Signature/i.test(lineText)) break;

    if (isItemHeader(sorted)) {
      if (current) items.push(current);
      const qty = parseInt(sorted[sorted.length - 1].text.replace(/,/g, ""), 10);
      const category = reconstructLine(sorted.slice(0, -1)).trim();
      const isNotes = /^notes\b/i.test(category);

      current = {
        category,
        description: "",
        label: "",
        dimensions: "",
        quantity: qty,
        qty_unit: "pcs",
        _isNotes: isNotes,
        _descLines: [],
      };
    } else if (current) {
      if (current._isNotes) continue;

      const dimMatch = lineText.match(
        /(\d[\d.\/\-]*)\s*["”]?\s*[xX×]\s*(\d[\d.\/\-]*)\s*["”]?\s*[xX×]\s*(\d[\d.\/\-]*)\s*["”]?/
      );
      if (dimMatch && !current.dimensions) {
        current.dimensions = dimMatch[0].trim();
      }

      if (
        !/^\d+\s*pieces?\s*per\s*bundle/i.test(lineText) &&
        !/^LABEL\s+AS\s+INDICATED/i.test(lineText) &&
        !/^NO\s+LABEL/i.test(lineText)
      ) {
        current._descLines!.push(lineText);
      }

      if (!current.description) {
        if (/Foam Block/i.test(lineText)) {
          current.description = lineText;
        } else if (/Laminate/i.test(lineText) && !/specify Laminate type/i.test(lineText)) {
          current.description = lineText;
        } else if (/Holey Board/i.test(lineText)) {
          current.description = lineText;
        } else if (/Insulperm/i.test(lineText)) {
          current.description = lineText;
        }
      }
    }
  }

  if (current) items.push(current);

  return items
    .filter((item) => {
      if (item._isNotes) return false;
      if (/credit card|processing fee/i.test((item.category || "") + " " + (item._descLines || []).join(" ") + " " + (item.description || ""))) return false;
      if (!item.quantity || item.quantity <= 0) return false;
      return true;
    })
    .map((item) => {
      if (!item.description && item._descLines!.length) {
        item.description = item._descLines!
          .filter((l) => !/^\d+\s*pieces?\s*per/i.test(l))
          .join(" — ")
          .slice(0, 200);
      }
      item.qty_unit = /BDFT\s*per\s*piece/i.test(item._descLines!.join(" ")) ? "bdft" : "pcs";
      const thkSrc = [item.category, item.description, ...(item._descLines || [])].join(" ");
      if (/holey board|insulperm/i.test(thkSrc)) {
        const thk = extractThickness(thkSrc);
        if (thk != null) item.thickness = thk;
      }
      delete item._isNotes;
      delete item._descLines;
      return item;
    });
}

// ─── Main document parser ─────────────────────────────────────────────────

function parseDoc(rawItems: RawItem[]): ParsedDoc {
  const data: ParsedDoc = {
    invoice_number: "",
    date: "",
    bill_to: { company: "", street: "", city: "", state: "", zip: "" },
    ship_to: { company: "", attention: "", street: "", city: "", state: "", zip: "" },
    ship_date: "",
    ship_via: "",
    contact_name: "",
    contact_phone: "",
    po_number: "",
    line_items: [],
  };

  const groups = groupByY(rawItems, 3);
  groups.sort((a, b) => b.y - a.y);
  for (const g of groups) g.items.sort((a, b) => a.x - b.x);

  const lines: ReconstructedLine[] = groups.map((g) => ({
    y: g.y,
    items: g.items,
    text: reconstructLine(g.items),
  }));

  let billToIdx = -1;
  let shipDateHdrIdx = -1;
  let descriptionIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text;
    if (/BILL\s+TO/i.test(t) && /SHIP\s+TO/i.test(t)) billToIdx = i;
    if (/SHIP\s+DATE/i.test(t) && (/SHIP\s+VIA/i.test(t) || /SHIPMENT\s+CONTACT/i.test(t) || /PHONE/i.test(t)))
      shipDateHdrIdx = i;
    if (/^\s*DESCRIPTION\b/i.test(t) && /\bQTY\b/i.test(t) && descriptionIdx < 0) descriptionIdx = i;
  }

  if (billToIdx >= 0) {
    const m = lines[billToIdx].text.match(/INVOICE\s*#\s*(\S+)/i);
    if (m) data.invoice_number = m[1].trim();
  }

  if (billToIdx >= 0 && billToIdx + 1 < lines.length) {
    const m = lines[billToIdx + 1].text.match(/DATE\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (m) data.date = m[1].trim();
  }

  if (shipDateHdrIdx >= 0) {
    const hdrLine = lines[shipDateHdrIdx];
    const valIdx = shipDateHdrIdx + 1;

    let contactHdrX: number | null = null;
    let poHdrX: number | null = null;

    for (const it of hdrLine.items) {
      if (/PHONE/i.test(it.text) && contactHdrX === null) contactHdrX = it.x;
      if (/PURCHASE/i.test(it.text) && poHdrX === null) poHdrX = it.x;
    }

    if (valIdx < lines.length) {
      const valItems = [...lines[valIdx].items].sort((a, b) => a.x - b.x);

      for (const it of valItems) {
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(it.text.trim())) {
          data.ship_date = it.text.trim();
          break;
        }
      }

      if (contactHdrX !== null && poHdrX !== null) {
        const contactPoMid = (contactHdrX + poHdrX) / 2;
        const shipViaParts: string[] = [];
        const contactParts: string[] = [];
        const poParts: string[] = [];

        for (const it of valItems.slice(1)) {
          if (it.x < contactHdrX - 20) {
            shipViaParts.push(it.text.trim());
          } else if (it.x < contactPoMid) {
            contactParts.push(it.text.trim());
          } else {
            poParts.push(it.text.trim());
          }
        }

        data.ship_via = shipViaParts.join(" ").trim();
        data.contact_name = contactParts.join(" ").trim();
        data.po_number = poParts.join(" ").trim();
      } else {
        if (valItems.length >= 2) data.ship_via = valItems[1].text.trim();
        if (valItems.length >= 4) {
          data.po_number = valItems[valItems.length - 1].text.trim();
          data.contact_name = valItems
            .slice(2, -1)
            .map((it) => it.text.trim())
            .join(" ")
            .trim();
        } else if (valItems.length === 3) {
          data.po_number = valItems[2].text.trim();
        }
      }

      if (valIdx + 1 < lines.length) {
        const phoneLine = lines[valIdx + 1];
        if (contactHdrX !== null) {
          const phoneItems = phoneLine.items.filter(
            (it) => it.x >= (contactHdrX as number) - 30 && it.x < (poHdrX ?? Infinity)
          );
          data.contact_phone = phoneItems.map((it) => it.text.trim()).join("").trim();
        } else {
          for (const it of phoneLine.items) {
            if (/[\d(][\d\/\-().ext\s]{6,}/.test(it.text)) {
              data.contact_phone = it.text.trim();
              break;
            }
          }
        }
      }

      if (!data.po_number && valItems.length >= 2) {
        for (let vi = valItems.length - 1; vi >= 1; vi--) {
          const t = valItems[vi].text.trim();
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) continue;
          if (/^\d{3}[\-\/]\d{3}[\-\/]\d{4}/.test(t)) continue;
          if (/^CARRIER$/i.test(t)) continue;
          data.po_number = t;
          break;
        }
      }
    }
  }

  if (data.contact_name && data.contact_phone) {
    const trailingPhone = data.contact_name.match(/\s+([\d(]+[\d\-\/()]{0,5})$/);
    if (trailingPhone) {
      data.contact_phone = trailingPhone[1] + data.contact_phone;
      data.contact_name = data.contact_name.slice(0, -trailingPhone[0].length).trim();
    }
  }

  if (data.contact_name && !data.contact_phone) {
    const phoneInName = data.contact_name.match(
      /\s*(\(?\w?\)?\s*\d{3}[\-\/\.\s]\d{3}[\-\/\.\s]\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?)\s*$/i
    );
    if (phoneInName) {
      data.contact_phone = phoneInName[1].trim();
      data.contact_name = data.contact_name.slice(0, -phoneInName[0].length).trim();
    }
  }

  if (data.contact_phone) {
    data.contact_phone = data.contact_phone.replace(/\//g, "-").replace(/^\(c\)/i, "").trim();
  }

  if (billToIdx >= 0) {
    const hdrItems = [...lines[billToIdx].items].sort((a, b) => a.x - b.x);
    let billToX: number | null = null,
      shipToX: number | null = null,
      invoiceX: number | null = null;

    for (const it of hdrItems) {
      if (/BILL/i.test(it.text) && billToX === null) billToX = it.x;
      if (/SHIP/i.test(it.text) && it.x > (billToX ?? -1) && shipToX === null) shipToX = it.x;
      if (/INVOICE/i.test(it.text) && invoiceX === null) invoiceX = it.x;
    }

    if (billToX !== null && shipToX !== null) {
      const mid = (billToX + shipToX) / 2;
      const shipRightBound = invoiceX !== null ? invoiceX - 5 : Infinity;
      const startY = lines[billToIdx].y;

      const addrEndLine = lines.find(
        (l) => l.y < startY && (/SHIPMENT\s+CONTACT/i.test(l.text) || /SHIP\s+DATE/i.test(l.text))
      );
      const endY = addrEndLine ? addrEndLine.y : -Infinity;

      const billRows: string[] = [];
      const shipRows: string[] = [];

      const addrGroups = groups.filter((g) => g.y < startY && g.y > endY).sort((a, b) => b.y - a.y);

      for (const g of addrGroups) {
        const billItems = g.items.filter((it) => it.x <= mid).sort((a, b) => a.x - b.x);
        const shipItems = g.items.filter((it) => it.x > mid && it.x < shipRightBound).sort((a, b) => a.x - b.x);
        if (billItems.length) billRows.push(billItems.map((it) => it.text).join(" ").trim());
        if (shipItems.length) shipRows.push(shipItems.map((it) => it.text).join(" ").trim());
      }

      data.bill_to = parseBillTo(billRows);
      data.ship_to = parseShipTo(shipRows);
    }
  }

  if (descriptionIdx >= 0) {
    data.line_items = parseLineItems(groups, lines[descriptionIdx].y);
  }

  data.line_items = (data.line_items || []).filter((li) => {
    const qty = Number(li.quantity);
    return qty && qty > 0;
  });

  return data;
}

// ─── Field mapping onto the order-entry form ──────────────────────────────

// MM/DD/YYYY (as extracted) → YYYY-MM-DD (<input type="date">). Ported from prefillForm().
function toIsoDate(mmddyyyy: string): string | undefined {
  const parts = mmddyyyy.split("/");
  if (parts.length !== 3) return undefined;
  return `${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
}

function mapToPrefill(data: ParsedDoc): PackingSlipPrefill {
  const prefill: PackingSlipPrefill = {};

  // Customer + ship-to fields come from the SHIP TO block, not BILL TO — matches
  // jobs/index.html's prefillForm() (`f-customer` is set from data.ship_to.company).
  if (data.ship_to.company) {
    prefill.customer = data.ship_to.company;
    prefill.ship_to_company = data.ship_to.company;
  }
  if (data.ship_to.attention) prefill.ship_to_attention = data.ship_to.attention;
  if (data.ship_to.street) prefill.ship_to_street = data.ship_to.street;
  if (data.ship_to.city) prefill.ship_to_city = data.ship_to.city;
  if (data.ship_to.state) prefill.ship_to_state = data.ship_to.state;
  if (data.ship_to.zip) prefill.ship_to_zip = data.ship_to.zip;

  if (data.po_number) prefill.po_number = data.po_number;
  if (data.invoice_number) prefill.invoice_number = data.invoice_number;

  if (data.contact_name) prefill.contact_name = data.contact_name;
  if (data.contact_phone) prefill.contact_phone = data.contact_phone;

  if (data.ship_date) {
    const iso = toIsoDate(data.ship_date);
    if (iso) prefill.ship_date = iso;
  }

  if (data.line_items.length) {
    prefill.line_items = data.line_items.map((li) => {
      const descParts = [li.description];
      if (li.label) descParts.push("– " + li.label);
      return {
        part_number: "",
        description: descParts.filter(Boolean).join(" ").trim(),
        quantity: String(li.quantity ?? 1),
        dimensions: li.dimensions || "",
        density: deriveDensity(
          [li.category, li.description, li.label, ...(li._descLines ?? [])].filter(Boolean).join(" ")
        ),
      };
    });
  }

  return prefill;
}

// ─── Public API ───────────────────────────────────────────────────────────

// P431 — derive the density code from a line item's combined text. The number comes from the
// `X.X#` pound marker (a DECIMAL is required, so product codes like "#206" and weights never
// match). Suffix is V when the item is virgin (the word VIRGIN, or a "- V" header code),
// otherwise RC — RECYCLE/Regrind/RC/"- RC" and also the no-keyword products (Holey Board /
// Insulperm, Laminate) which carry no virgin/RC word on the slip. Output matches the legacy
// density field: "1.0 RC", "1.25 V". Detection is per line item (a slip can mix V and RC).
function deriveDensity(text: string): string {
  const m = text.match(/(\d+\.\d+)\s*#/);
  if (!m) return "";
  const num = m[1];
  const isVirgin = /\bVIRGIN\b/i.test(text) || /[-–]\s*V\b/.test(text);
  return `${num} ${isVirgin ? "V" : "RC"}`;
}

export async function parsePackingSlip(file: File): Promise<ParsePackingSlipResult> {
  try {
    const lib = await loadPdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    let rawItems: RawItem[] = [];

    for (let p = 1; p <= numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const vp = page.getViewport({ scale: 1 });
      const pageHeight = vp.height;
      const yOffset = (p - 1) * pageHeight;

      const pageItems: RawItem[] = tc.items
        .filter((item: any) => item.str && item.str.trim())
        .map((item: any) => ({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5] - yOffset,
          width: item.width || 0,
          page: p,
        }));

      rawItems = rawItems.concat(pageItems);
    }

    const data = parseDoc(rawItems);
    return { success: true, data: mapToPrefill(data), filename: file.name };
  } catch (err: any) {
    return { success: false, error: err?.message || "Could not extract text from PDF" };
  }
}
