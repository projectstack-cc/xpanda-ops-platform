# Prompt 26 — Packing Slip Parser Overhaul

## Goal

Major improvements to the packing slip parser (`jobs/packing-slip-parser.js`) to handle real-world QuickBase-generated packing slips. Fixes multi-page parsing, address extraction, contact/phone splitting, line item recognition for diverse product formats, and filters out zero-qty and notes-only items.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Context

The parser currently only reads page 1 of a PDF and only recognizes line items that follow a narrow "Foam Block" format. Real packing slips from QuickBase have:
- Multi-page line items (10+ SKUs spanning 2+ pages)
- Multi-line product descriptions (category header, description, dimensions on separate lines)
- Products beyond "Foam Block" (Laminates, Holey Board, Plugs, Notched pieces, Plain Sheets)
- "notes" pseudo-items with qty=1 that aren't real products
- Items with zero or missing quantities
- Contact name and phone number split across lines or using non-standard phone formats (slashes, extensions, parentheses)
- Ship-to addresses where building names span multiple lines before the street address

---

## Step 1 — Multi-page text extraction

In the `parse()` function (around line 404), change from reading only page 1 to reading ALL pages:

Replace:
```javascript
const page = await pdf.getPage(1);
const tc   = await page.getTextContent();

const rawItems = tc.items
  .filter(item => item.str.trim())
  .map(item => ({
    text:  item.str,
    x:     item.transform[4],
    y:     item.transform[5],
    width: item.width || 0,
  }));
```

With:
```javascript
const numPages = pdf.numPages;
let rawItems = [];

for (let p = 1; p <= numPages; p++) {
  const page = await pdf.getPage(p);
  const tc   = await page.getTextContent();
  const vp   = page.getViewport({ scale: 1 });
  const pageHeight = vp.height;
  // Offset y by page number so page 2 items sort below page 1
  const yOffset = (p - 1) * pageHeight;

  const pageItems = tc.items
    .filter(item => item.str.trim())
    .map(item => ({
      text:  item.str,
      x:     item.transform[4],
      y:     item.transform[5] - yOffset, // page 2+ items get lower y values
      width: item.width || 0,
      page:  p,
    }));

  rawItems = rawItems.concat(pageItems);
}
```

This way all items from all pages feed into the same `parseDoc()` function. Page 2+ items have lower y values, so they naturally sort below page 1 items in the top-to-bottom ordering.

**Important:** The DESCRIPTION/QTY header repeats on page 2+. The line item parser needs to handle this — when it encounters another "DESCRIPTION ... QTY" header line, it should skip it rather than treating it as a line item. Add this check in `parseLineItems`:

```javascript
// Skip repeated DESCRIPTION/QTY headers on subsequent pages
if (/^\s*DESCRIPTION\b/i.test(lineText) && /\bQTY\b/i.test(lineText)) continue;
```

---

## Step 2 — Improved ship-to address parsing

Replace the `parseShipTo()` function. The current version assumes a strict order: company → attn → street → city/state/zip. Real packing slips have:
- Building names that span multiple lines before the street
- "Attn:" appearing mid-block (after building lines)
- Single letters (like "E") that are part of building names, not cities

New logic:

```javascript
function parseShipTo(rows) {
  const st = { company: '', attention: '', street: '', city: '', state: '', zip: '' };
  const r = rows.filter(t => t && !/^SHIP\s+TO$/i.test(t.trim()));
  if (!r.length) return st;

  // Step 1: Find the city/state/zip line (work backwards from the bottom)
  let cityStateIdx = -1;
  let zipIdx = -1;

  for (let i = r.length - 1; i >= 0; i--) {
    const line = r[i].trim();
    // Pure zip code on its own line
    if (/^\d{5}(-\d{4})?$/.test(line)) {
      zipIdx = i;
      st.zip = line;
      continue;
    }
    // City, ST ZIP or City, ST patterns
    const csz = line.match(/^(.+?),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (csz) {
      cityStateIdx = i;
      st.city = csz[1].trim();
      st.state = csz[2];
      st.zip = csz[3];
      break;
    }
    const cs = line.match(/^(.+?),?\s+([A-Z]{2})$/);
    if (cs && cs[1].length > 1) { // Don't match single letters as cities
      cityStateIdx = i;
      st.city = cs[1].trim();
      st.state = cs[2];
      break;
    }
  }

  // Step 2: Find the street address line (the line before city/state, that looks like a street)
  // A street line typically starts with a number or contains road-type words
  const endIdx = cityStateIdx >= 0 ? cityStateIdx : (zipIdx >= 0 ? zipIdx : r.length);
  let streetIdx = -1;

  for (let i = endIdx - 1; i >= 0; i--) {
    const line = r[i].trim();
    if (/^\d+\s/.test(line) || /\b(St|Rd|Ave|Blvd|Dr|Ln|Lane|Ct|Way|Pkwy|Terrace|Circle|Place|Highway|Hwy)\b/i.test(line)) {
      streetIdx = i;
      st.street = line;
      break;
    }
  }

  // Step 3: Find Attn line
  let attnIdx = -1;
  for (let i = 0; i < endIdx; i++) {
    if (/^Attn:/i.test(r[i].trim())) {
      attnIdx = i;
      // Attention may span this line and the next if it wraps
      let attnText = r[i].replace(/^Attn:\s*/i, '').trim();
      // Check if next line continues the attention (e.g. "& Sheet Metal of FL")
      if (i + 1 < endIdx && i + 1 !== streetIdx && /^[&a-zA-Z]/.test(r[i + 1].trim()) && !/^\d/.test(r[i + 1].trim())) {
        attnText += ' ' + r[i + 1].trim();
        attnIdx = i + 1; // mark both lines as consumed
      }
      st.attention = attnText;
      break;
    }
  }

  // Step 4: Everything before Attn (or before street if no Attn) is the company name
  const companyEndIdx = attnIdx >= 0 ? Math.min(...[attnIdx].filter(x => x >= 0).concat(r.findIndex(l => /^Attn:/i.test(l.trim())))) 
    : (streetIdx >= 0 ? streetIdx : endIdx);
  
  // Simpler approach: company is lines 0 through (first of: attn line, street line, city line) - 1
  let compEndIdx = endIdx;
  if (attnIdx >= 0) compEndIdx = Math.min(compEndIdx, r.findIndex(l => /^Attn:/i.test(l.trim())));
  if (streetIdx >= 0) compEndIdx = Math.min(compEndIdx, streetIdx);

  const companyLines = r.slice(0, Math.max(1, compEndIdx)).map(l => l.trim());
  st.company = companyLines.join(' ').trim();

  // If zip was on its own line below city/state, it's already captured
  // If zip wasn't found, try extracting from the last line
  if (!st.zip && cityStateIdx < 0) {
    const lastLine = r[r.length - 1].trim();
    const zipMatch = lastLine.match(/(\d{5}(-\d{4})?)$/);
    if (zipMatch) st.zip = zipMatch[1];
  }

  return st;
}
```

---

## Step 3 — Contact name/phone splitting

The current parser separates contact name and phone based on which PDF line they're on. But in many packing slips, the phone number starts on the same line as the name (e.g., "Trish Nicholson 954-" wrapping to "785-7557" on the next line), or uses non-standard formats like "(c)239/292-9125" or "352/624-0344 x809502".

In the ship date parsing section (around line 268), after the contact name and phone are extracted, add a post-processing step:

```javascript
// ── Post-process contact name/phone ──
// Rejoin phone fragments that wrapped to next line
if (data.contact_name && data.contact_phone) {
  // Check if name ends with a partial phone (digits and dash at end)
  const trailingPhone = data.contact_name.match(/\s+([\d(]+[\d\-\/()]{0,5})$/);
  if (trailingPhone) {
    data.contact_phone = trailingPhone[1] + data.contact_phone;
    data.contact_name = data.contact_name.slice(0, -trailingPhone[0].length).trim();
  }
}

// If contact_name contains a phone-like pattern, split it out
if (data.contact_name && !data.contact_phone) {
  // Match phone patterns: (xxx)xxx-xxxx, xxx-xxx-xxxx, xxx/xxx-xxxx, (c)xxx/xxx-xxxx
  const phoneInName = data.contact_name.match(/\s*(\(?\w?\)?\s*\d{3}[\-\/\.\s]\d{3}[\-\/\.\s]\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?)\s*$/i);
  if (phoneInName) {
    data.contact_phone = phoneInName[1].trim();
    data.contact_name = data.contact_name.slice(0, -phoneInName[0].length).trim();
  }
}

// Clean phone: normalize slashes to dashes for display
if (data.contact_phone) {
  data.contact_phone = data.contact_phone.replace(/\//g, '-').replace(/^\(c\)/i, '').trim();
}
```

Also update the phone detection on the "next line" (around line 319-331). Currently it only looks for `[\d\/]{7,}`. Make it more permissive:

```javascript
// Match phone patterns including (c), parentheses, slashes, extensions
if (/[\d(][\d\/\-().ext\s]{6,}/.test(it.text)) {
  data.contact_phone = it.text.trim();
  break;
}
```

---

## Step 4 — Line item parser overhaul

Replace the entire `parseLineItems()` function. The current version only recognizes "Foam Block" descriptions. Real packing slips have:

- **Category headers** (bold, right-aligned qty): "Block Foam:1.0# BLOCK FOAM - RC" with qty 2000
- **Product description lines**: "Foam Block 1.0# RC - PLUGS", "XLam PRO Laminate-ONE SIDE 1.0# density"
- **Sub-detail lines**: "KB 5 mL", "36 pieces per bundle / 8 BDFT per piece"
- **Dimension lines**: `2" x 3" x 11.875"` or `24" x 48" x 1"`
- **Notes pseudo-items**: first line is "notes" with qty 1, followed by freeform text
- **Items with no quantity** (blank = 0): should be filtered out

```javascript
function parseLineItems(groups, descriptionY) {
  const items = [];
  let current = null;

  const relevant = groups
    .filter(lg => lg.y < descriptionY)
    .sort((a, b) => b.y - a.y);

  for (const lg of relevant) {
    const sorted = [...lg.items].sort((a, b) => a.x - b.x);
    const lineText = reconstructLine(sorted).trim();
    if (!lineText) continue;

    // Skip repeated DESCRIPTION/QTY headers (from page 2+)
    if (/^\s*DESCRIPTION\b/i.test(lineText) && /\bQTY\b/i.test(lineText)) continue;

    // Skip the MNMFC / boilerplate / legal sections at bottom
    if (/Commodities requiring/i.test(lineText)) break;
    if (/NOTE:\s*Liability/i.test(lineText)) break;
    if (/Customer acknowledges/i.test(lineText)) break;
    if (/certify that/i.test(lineText)) break;
    if (/Carrier Signature/i.test(lineText)) break;
    if (/Shipper Signature/i.test(lineText)) break;

    if (isItemHeader(sorted)) {
      if (current) items.push(current);
      const qty = parseInt(sorted[sorted.length - 1].text.replace(/,/g, ''), 10);
      const category = reconstructLine(sorted.slice(0, -1)).trim();

      // Detect "notes" pseudo-items
      const isNotes = /^notes\b/i.test(category);

      current = {
        category,
        description: '',
        label: '',
        dimensions: '',
        quantity: qty,
        _isNotes: isNotes,
        _descLines: [],
      };

    } else if (current) {
      // If this is a notes item, skip all its content lines
      if (current._isNotes) continue;

      // Try to extract dimensions from this line
      // Match patterns like: 2" x 3" x 11.875", 57.75" x 108.75" x 5", 24" x 48" x 1"
      // Also match non-smart-quote patterns: 2" x 48" x 144"
      const dimMatch = lineText.match(/(\d[\d.\/\-]*)\s*[""\u201D]?\s*[xX×]\s*(\d[\d.\/\-]*)\s*[""\u201D]?\s*[xX×]\s*(\d[\d.\/\-]*)\s*[""\u201D]?/);

      if (dimMatch && !current.dimensions) {
        current.dimensions = dimMatch[0].trim();
      }

      // Build description from content lines (not bundle info or label instructions)
      if (!/^\d+\s*pieces?\s*per\s*bundle/i.test(lineText) &&
          !/^LABEL\s+AS\s+INDICATED/i.test(lineText) &&
          !/^NO\s+LABEL/i.test(lineText)) {
        current._descLines.push(lineText);
      }

      // Try specific description patterns
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

  // Post-processing: finalize descriptions, filter out junk
  return items
    .filter(item => {
      // Remove notes pseudo-items
      if (item._isNotes) return false;
      // Remove zero-quantity items
      if (!item.quantity || item.quantity <= 0) return false;
      return true;
    })
    .map(item => {
      // If no specific description was found, join the collected desc lines
      if (!item.description && item._descLines.length) {
        // Use the most informative line (longest, or one with dimensions)
        item.description = item._descLines
          .filter(l => !/^\d+\s*pieces?\s*per/i.test(l))
          .join(' — ')
          .slice(0, 200);
      }
      // Clean up internal properties
      delete item._isNotes;
      delete item._descLines;
      return item;
    });
}
```

---

## Step 5 — Handle commas in quantities

The `isItemHeader` function checks if the rightmost item is a pure integer with `/^\d+$/`. But quantities like "8,064" or "22,393" have commas. Update the regex:

```javascript
function isItemHeader(sortedItems) {
  if (sortedItems.length < 2) return false;
  const last = sortedItems[sortedItems.length - 1];
  const qtyText = last.text.trim().replace(/,/g, '');
  if (!/^\d+$/.test(qtyText)) return false;
  const prev = sortedItems[sortedItems.length - 2];
  const gap = last.x - (prev.x + (prev.width || prev.text.length * 5.5));
  return gap > 50;
}
```

And update the qty extraction in the item creation to strip commas:
```javascript
const qty = parseInt(sorted[sorted.length - 1].text.replace(/,/g, ''), 10);
```

---

## Step 6 — Ship date extraction fix

The current ship date extraction depends on `SHIP VIA` being present in the header line (`/SHIP\s+DATE/i.test(t) && /SHIP\s+VIA/i.test(t)`). But some packing slips have "SHIP DATE" and "SHIPMENT CONTACT WITH PHONE #" without "SHIP VIA" appearing as a separate text item.

Make the header detection more permissive:

```javascript
if (/SHIP\s+DATE/i.test(t) && (/SHIP\s+VIA/i.test(t) || /SHIPMENT\s+CONTACT/i.test(t) || /PHONE/i.test(t))) shipDateHdrIdx = i;
```

Also, the ship date value extraction assumes `valItems[0]` is the date. But sometimes the PDF text items are in a different order. Look specifically for a date pattern:

```javascript
// Ship date: find item matching date pattern
for (const it of valItems) {
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(it.text.trim())) {
    data.ship_date = it.text.trim();
    break;
  }
}
```

---

## Step 7 — PO number extraction fix

The PO number column sometimes doesn't align neatly with the header. Add a fallback: if `data.po_number` is still empty after positional extraction, scan the value lines for text that looks like a PO number (alphanumeric string in the rightmost position):

```javascript
// Fallback PO extraction: rightmost non-phone, non-date item on the value line
if (!data.po_number && valItems.length >= 2) {
  for (let vi = valItems.length - 1; vi >= 1; vi--) {
    const t = valItems[vi].text.trim();
    // Skip if it looks like a date or phone
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) continue;
    if (/^\d{3}[\-\/]\d{3}[\-\/]\d{4}/.test(t)) continue;
    if (/^CARRIER$/i.test(t)) continue;
    data.po_number = t;
    break;
  }
}
```

---

## What NOT to touch

- Do NOT modify the job board form (`jobs/index.html`)
- Do NOT modify the worker API
- Do NOT modify any other parser consumers
- Do NOT modify the `parse()` public API signature — it must still return `{ success, data }` with the same data shape

---

## Completion checklist

- [ ] Multi-page PDF reading (all pages extracted and combined)
- [ ] Repeated DESCRIPTION/QTY headers on page 2+ are skipped
- [ ] Ship-to address handles multi-line building names (e.g., "GRANDE LAKE - BLDG E")
- [ ] Ship-to address handles "Attn:" appearing mid-block
- [ ] Contact name/phone correctly split when phone wraps to next line
- [ ] Phone formats handled: xxx-xxx-xxxx, xxx/xxx-xxxx, (c)xxx/xxx-xxxx, xxx-xxx-xxxx xNNNNNN
- [ ] Line items recognized for: Block Foam, Laminate, Holey Board, Plugs, Notched, Plain Sheet
- [ ] Quantities with commas parsed correctly (8,064 → 8064)
- [ ] Zero-quantity items filtered out
- [ ] "notes" pseudo-items (qty=1) filtered out
- [ ] Ship date extracted even when "SHIP VIA" text varies
- [ ] PO number extracted with fallback logic
- [ ] Boilerplate sections (legal text, signature areas) don't get parsed as line items

**Notify Steve:** No migration needed. Test with the following packing slips:
- INV 3815 (AccuSolar — single item, contact phone wrap)
- INV 3249 (Moorings Park — multi-page, complex address, notes items)
- INV 3986 (Lansing — many items, zero-qty items, multi-page, extension phone)
- INV 3982 (Blue Hippo — missing phone, notes item)
