# Prompt 13 — BOL Generator: Fix PDF Field Coordinates

You are working inside the xPanda Operations Platform repository.
Follow all rules in AGENTS.md.

---

## Objective

Fix the `COORDS` object in `generatePdf()` so all field values land in the correct positions on the new BOL template. Also move the delivery time field to above the "Straight Bill of Lading" title (top-left), as the logo now occupies the top-right area.

---

## Scope

**One file only:**

`/logistics/bol-generator.html`

Change the `COORDS` object only. Do NOT modify any other logic, field writes, helpers, or functions.

---

## Updated `COORDS`

Replace the entire `COORDS` object with the following:

```js
const COORDS = {
  // Delivery time — top-left, ABOVE "Straight Bill of Lading" title
  // Logo occupies top-right; this renders above the title text
  deliveryTime:  { x: 38,  y: 760, size: 18 },

  // Top-right block
  date:          { x: 347, y: 721, size: 10 },           // right of "Date:" label
  bolNumber:     { x: 420, y: 700, size: 14, bold: true },// below "Bill of Lading No:" label
  carrierName:   { x: 390, y: 656, size: 10 },            // right of "Name:" label
  trailerNo:     { x: 365, y: 640, size: 10 },            // right of "No:" label

  // Left column — Ship To (4 lines, inside cell)
  shipLine1:     { x: 42,  y: 618, size: 10 },
  shipLine2:     { x: 42,  y: 605, size: 10 },
  shipLine3:     { x: 42,  y: 592, size: 10 },
  shipLine4:     { x: 42,  y: 579, size: 10 },

  // Location No — same baseline as first Ship To line
  locationNo:    { x: 250, y: 618, size: 10 },

  // Right column — Special Instructions (multiline, below label)
  specialInstr:  { x: 311, y: 595, size: 9, lineH: 11, maxW: 255 },

  // Right column — Contact Info (multiline, below label)
  contactInfo:   { x: 313, y: 533, size: 9, lineH: 11, maxW: 255 },

  // Left column — Scrap Pick Up checkboxes
  scrapYes:      { x: 109, y: 515, size: 10 },   // X next to ☐ Yes
  scrapNo:       { x: 110, y: 498, size: 10 },   // X next to ☐ No

  // Commodity description rows
  commodity:     { x: 38,  y: 421, size: 10, lineH: 10.5, maxW: 535 },
};
```

---

## Delivery time — color change

The delivery time currently renders in bold red. Keep it bold red — do not change the color or font weight. Only the position changes.

---

## Constraints

- Change ONLY the `COORDS` object — nothing else in `generatePdf()`
- Do not change any field write calls, helper functions, or logic
- Do not modify any other function in the file

---

## Completion

Notify me when done. No migration required.
