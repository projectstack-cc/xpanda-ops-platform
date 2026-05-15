# Prompt 11 — BOL Generator: Update to New PDF Template

You are working inside the xPanda Operations Platform repository.
Follow all rules in AGENTS.md.

---

## Objective

Replace the BOL PDF template asset and update `generatePdf()` in `bol-generator.html` to match the new layout. Field positions have changed significantly, several fields have been removed, and two fields (Scrap Pick Up, Contact Info) have changed behavior.

---

## Scope

**Files to modify:**

1. `/logistics/assets/BLANK_BOL_Xpanda.pdf` — replace with the new template file provided separately
2. `/logistics/bol-generator.html` — update `COORDS` object and all field writes in `generatePdf()` only

**Do NOT modify:**
- Any form UI, input fields, save/load logic, or API calls
- The `drawText`, `drawMultiline` helper functions
- The download/open logic at the end of `generatePdf()`
- Anything outside of `generatePdf()`

---

## What changed between old and new template

**Removed fields (no longer written to PDF):**
- Seal Number — removed from template
- SCAC — removed from template
- Pro No — removed from template
- FOB checkboxes — removed
- Master BOL checkbox — removed
- Collect / 3rd Party freight checkboxes — removed
- Third party bill-to text area — removed

**Changed behavior:**
- **Prepaid** — now hardcoded ☒ in the template itself. Do NOT write anything for freight terms — the checkbox is already marked on the blank template.
- **Scrap Pick Up** — now a real checkbox (☐ Yes / ☐ No) printed on the template. Write `'X'` next to the **Yes** checkbox when `bol.is_scrap_pickup` is true, or next to the **No** checkbox when false. Both checkboxes are always visible on the template.
- **Special Instructions** — now has its own dedicated section in the right column (was previously a smaller area). Multiline, right column.
- **Contact Info** — new field, own dedicated section in the right column. Multiline. Maps to `bol.contact_info`.

**Unchanged fields:**
- Date, BOL Number, Carrier Name, Trailer No
- Ship To (4 lines), Location No
- Delivery Time (bold red, top right)
- Commodity description (multiline)

---

## Step 2 — Replace `COORDS` and field writes

Page is 612pt × 792pt. pdf-lib uses y=0 at the **bottom**. All coordinates below are pre-calculated.

### New `COORDS` object

Replace the entire existing `COORDS` object with:

```js
const COORDS = {
  // Top-right bold red delivery time
  deliveryTime:    { x: 430, y: 741, size: 18 },

  // Top-right block
  date:            { x: 360, y: 721, size: 10 },
  bolNumber:       { x: 420, y: 704, size: 14, bold: true },
  carrierName:     { x: 390, y: 656, size: 10 },
  trailerNo:       { x: 365, y: 640, size: 10 },

  // Left column — Ship To (4 lines)
  shipLine1:       { x: 42,  y: 609, size: 10 },
  shipLine2:       { x: 42,  y: 596, size: 10 },
  shipLine3:       { x: 42,  y: 583, size: 10 },
  shipLine4:       { x: 42,  y: 570, size: 10 },

  // Left column — Location No (same row as Ship To label)
  locationNo:      { x: 250, y: 625, size: 10 },

  // Right column — Special Instructions (multiline)
  specialInstr:    { x: 311, y: 592, size: 9, lineH: 11, maxW: 255 },

  // Right column — Contact Info (multiline)
  contactInfo:     { x: 313, y: 530, size: 9, lineH: 11, maxW: 255 },

  // Left column — Scrap Pick Up checkboxes
  scrapYes:        { x: 109, y: 515, size: 10 },   // X next to ☐ Yes
  scrapNo:         { x: 110, y: 498, size: 10 },   // X next to ☐ No

  // Commodity description (multiline, full width)
  commodity:       { x: 38,  y: 424, size: 10, lineH: 9.7, maxW: 535 },
};
```

### New field write block

Replace all field write calls after the `drawMultiline` helper definition with the following — in this exact order:

```js
// ── Delivery time (bold red, top right) ──
if (bol.delivery_time) {
  page.drawText(String(bol.delivery_time), {
    x: COORDS.deliveryTime.x, y: COORDS.deliveryTime.y,
    size: 18, font: fontBold, color: rgb(1, 0, 0),
  });
}

// ── Date and BOL Number ──
drawText(bol.date,             COORDS.date);
drawText(String(bol.bol_number), COORDS.bolNumber);

// ── Carrier block ──
drawText(bol.carrier_name, COORDS.carrierName);
drawText(bol.trailer_no,   COORDS.trailerNo);

// ── Ship To (up to 4 lines) ──
const shipLines = [
  bol.ship_to_company,
  bol.ship_to_attention,
  [bol.ship_to_street, bol.ship_to_street2].filter(Boolean).join(', '),
  [bol.ship_to_city, bol.ship_to_state, bol.ship_to_zip].filter(Boolean).join(', '),
].filter(Boolean);
const shipCoords = [COORDS.shipLine1, COORDS.shipLine2, COORDS.shipLine3, COORDS.shipLine4];
shipLines.forEach((line, i) => { if (shipCoords[i]) drawText(line, shipCoords[i]); });

// ── Location No ──
drawText(bol.location_no, COORDS.locationNo);

// ── Special Instructions (multiline) ──
drawMultiline(bol.special_instructions, COORDS.specialInstr);

// ── Contact Info (multiline) ──
drawMultiline(bol.contact_info, COORDS.contactInfo);

// ── Scrap Pick Up ──
// Template has ☐ Yes and ☐ No already printed.
// Write X next to whichever applies.
if (bol.is_scrap_pickup) {
  drawText('X', COORDS.scrapYes);
} else {
  drawText('X', COORDS.scrapNo);
}

// ── Commodity description (multiline) ──
drawMultiline(bol.commodity_description, COORDS.commodity);
```

---

## Step 3 — Add `contact_info` to the BOL form

In the BOL generator form UI, add a `Contact Info` textarea field. It should be positioned near the Special Instructions field and use the same styling pattern.

Add a field `id="f-contact-info"` with label `Contact Info`.

In the `collectBol()` function (or wherever form fields are read into the BOL object), add:

```js
contact_info: document.getElementById('f-contact-info').value.trim(),
```

In `populateBol()` (or equivalent function that fills the form when editing), add:

```js
document.getElementById('f-contact-info').value = bol.contact_info || '';
```

In the form clear/reset function, add `'f-contact-info'` to the fields that get cleared.

---

## Step 4 — Add `contact_info` to the API

In `_worker.js`, in the BOLs POST handler, add `contact_info` to the list of extracted fields:

```js
const contact_info = String(payload.contact_info || '').trim();
```

Add `contact_info` to the INSERT column list and `.bind()` values.

In the PUT handler, add `contact_info` to the updatable fields block, same pattern as existing fields.

In the schema comment for the `bols` table, add:

```sql
contact_info TEXT NOT NULL DEFAULT '',
```

---

## Step 5 — D1 Migration

Do NOT run this. Write it here so I can run it manually in the Cloudflare Dashboard Console:

```sql
ALTER TABLE bols ADD COLUMN contact_info TEXT NOT NULL DEFAULT '';
```

---

## Constraints

- Do NOT write anything for freight terms — Prepaid is hardcoded on the template
- Do NOT write Seal Number, SCAC, Pro No, Master BOL, or third-party bill-to
- Scrap Pick Up always writes an X to one of the two boxes — never leaves both blank
- Do NOT modify `drawText` or `drawMultiline` helpers
- Do NOT touch any other function in `bol-generator.html`

---

## Completion

Notify me when done and remind me to:
1. Copy the new `BLANK_BOL_Xpanda.pdf` into `/logistics/assets/`
2. Run the D1 migration in the Cloudflare Dashboard Console before testing
