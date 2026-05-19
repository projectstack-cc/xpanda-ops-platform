# Prompt 18 — BOL PDF Coordinate Remap + Template Replacement

## Goal

Replace the blank BOL template with the updated version and remap all `COORDS` in the PDF generation function to match the new template layout. The logistics manager reorganized the BOL template, so text placement coordinates need updating.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Step 1 — Replace the blank template

Copy the new blank template into position:
```
cp /path/to/new/BLANK_BOL_Xpanda.pdf logistics/assets/BLANK_BOL_Xpanda.pdf
```

**Steve will handle this manually** — the new template file needs to be placed at `logistics/assets/BLANK_BOL_Xpanda.pdf` and redeployed.

---

## Step 2 — Update COORDS in `logistics/bol-generator.html`

Find the `COORDS` object inside `generatePdf()` (around line 1268). Replace the entire object with these corrected coordinates, derived from the filled reference PDF (`3964_copy.pdf`):

```javascript
const COORDS = {
    // Delivery time — top-right, next to logo (bold red)
    // Was incorrectly at top-left (x:38). Now top-right per logistics manager layout.
    deliveryTime:  { x: 383, y: 763, size: 18 },

    // Top-right block
    date:          { x: 346, y: 720, size: 10 },            // right of "Date:" label (label at x:310, y:718)
    bolNumber:     { x: 404, y: 693, size: 14, bold: true }, // below "Bill of Lading No:" (label at y:700)
    carrierName:   { x: 389, y: 655, size: 10 },             // right of "Carrier Name:" (label at x:310, y:654)
    trailerNo:     { x: 365, y: 622, size: 10 },             // right of "Trailer No:" (label at x:310, y:622)

    // Left column — Ship To (4 lines, INDENTED under "Ship To:" label)
    // Label "Ship To:" is at x:40, y:622. Address lines start indented at x:95.
    shipLine1:     { x: 95,  y: 615, size: 10 },
    shipLine2:     { x: 95,  y: 601, size: 10 },
    shipLine3:     { x: 95,  y: 587, size: 10 },
    shipLine4:     { x: 95,  y: 573, size: 10 },

    // Special Instructions — right column, below label (label at x:309, y:603)
    specialInstr:  { x: 315, y: 585, size: 9, lineH: 12, maxW: 255 },

    // Contact Info — right column, below label (label "Contact Info:" at x:312, y:544)
    contactInfo:   { x: 315, y: 530, size: 9, lineH: 12, maxW: 255 },

    // Scrap Pick Up checkboxes (☐ at x:107)
    // "Yes" checkbox at y:515, "No" checkbox at y:498
    scrapYes:      { x: 109, y: 515, size: 10 },
    scrapNo:       { x: 109, y: 498, size: 10 },

    // Commodity description — below "Commodity Description" header (header at y:454)
    // The small-print disclaimer ends at y:431. First commodity row starts below.
    // In the reference PDF, commodity text is rendered LARGE and centered.
    commodity:     { x: 55, y: 410, size: 13, lineH: 28, maxW: 510 },
};
```

### Key changes from the old COORDS:

| Field | Old | New | What changed |
|-------|-----|-----|-------------|
| `deliveryTime` | x:38, y:760 | x:383, y:763 | Moved from top-LEFT to top-RIGHT (next to logo) |
| `date` | y:715 | y:720 | Bumped up 5pt |
| `bolNumber` | x:413 | x:404 | Shifted left 9pt |
| `carrierName` | y:650 | y:655 | Bumped up 5pt |
| `trailerNo` | y:634 | y:622 | Dropped 12pt to align with "Trailer No:" label |
| `shipLine1-4` | x:42 | x:95 | Indented 53pt right (was overlapping "Ship To:" label) |
| `shipLine1` | y:609 | y:615 | Adjusted up 6pt |
| `shipLine2` | y:596 | y:601 | Adjusted up 5pt |
| `shipLine3` | y:583 | y:587 | Adjusted up 4pt |
| `shipLine4` | y:570 | y:573 | Adjusted up 3pt |
| `specialInstr` | x:311, y:583 | x:315, y:585 | Minor shift |
| `contactInfo` | x:313, y:522 | x:315, y:530 | Shifted up 8pt |
| `commodity` | x:38, y:420, size:10 | x:55, y:410, size:13, lineH:28 | Larger text, more line spacing, slightly indented, shifted down |

---

## Step 3 — Remove the `locationNo` field

The old COORDS had a `locationNo` field at `{ x: 250, y: 625, size: 10 }`. The new template layout doesn't have a separate "Location No" area — this was removed by the logistics manager. 

Remove the `locationNo` entry from COORDS and remove the line that draws it:
```javascript
// REMOVE this line:
drawText(bol.location_no, COORDS.locationNo);
```

---

## Step 4 — Verify commodity rendering

The reference BOL shows commodity lines rendered in a **larger font** (~13-14pt) with significant spacing between lines (~28pt). The old code used size:10 and lineH:10.5 which would be too small and cramped on the new template.

The updated COORDS set `size: 13, lineH: 28` for commodity. Verify that `drawMultiline` respects these values. It should — the function already reads `coord.size` and `coord.lineH`.

If the commodity text wraps (long descriptions), the `maxW: 510` should handle it. But verify the wrapped lines don't overlap with the table rows below.

---

## What NOT to touch

- Do NOT modify any form logic, API calls, or data handling
- Do NOT modify the `drawText` or `drawMultiline` helper functions (they're generic)
- Do NOT modify the BOL save/load logic
- Do NOT modify any other HTML pages
- Do NOT modify the scrap checkbox logic (just coords)
- Do NOT modify the delivery time's red/bold styling — just its position

---

## Completion checklist

Before stopping, verify:
- [ ] `COORDS` object fully replaced with new coordinates
- [ ] `locationNo` coord and its `drawText` call removed
- [ ] Delivery time renders top-right (x:383) not top-left
- [ ] Ship-to lines render indented (x:95) not flush-left
- [ ] Commodity text uses size:13 and lineH:28
- [ ] No other code changes outside the `COORDS` object and `locationNo` removal

**Notify Steve:** After completion, tell him to:
1. Replace `logistics/assets/BLANK_BOL_Xpanda.pdf` with the new blank template
2. Redeploy
3. Generate a test BOL and compare against the reference PDF (3964_copy.pdf)
