# Prompt 12 — BOL Generator: Form Cleanup

You are working inside the xPanda Operations Platform repository.
Follow all rules in AGENTS.md.

---

## Objective

Clean up the BOL generator form by removing obsolete fields, reorganizing sections, and remapping how fields write to the PDF payload. This is a UI/form-only change — no PDF layout or COORDS changes.

---

## Scope

**One file only:**

`/logistics/bol-generator.html`

Do NOT modify `_worker.js`, any other file, or the `generatePdf()` function.

---

## Changes Required

### 1. Carrier section — remove Seal Number, SCAC, Pro No

Remove these three fields from the HTML form entirely:
- The `bol-row bol-row-2` containing `f-seal-number` and the Seal Number label
- The `bol-row bol-row-2` containing `f-scac` and `f-pro-no` and their labels

After removal, the Carrier section should only contain:
- Carrier Name (search input)
- Trailer No (single field, no longer paired in a row)

---

### 2. Remove the entire Freight Terms section

Remove the entire `bol-section` div that contains:
- The "Freight Terms" section title
- The prepaid/collect/3rd party radio buttons
- The Scrap Pick-Up checkbox
- The 3rd Party Bill To hidden field (`#third-party-field`)

---

### 3. Restructure the Special Instructions section

The Special Instructions section currently contains: Contact Name, Contact Phone, PO #, Additional Instructions textarea, and Master BOL checkbox.

Replace it with the following structure:

```
Section title: "Special Instructions & Contact"

  [Scrap Pick-Up checkbox]  ← moved from Freight Terms

  Label: Additional Instructions
  <textarea id="f-special-instructions" rows="3" placeholder="Loading notes, special requirements…">

  Label: Contact Name
  <input type="text" id="f-contact-name">

  Label: Contact Phone
  <input type="tel" id="f-contact-phone">

  Label: Contact Info
  <textarea id="f-contact-info" rows="2" placeholder="Additional contact details…">
```

Remove the Master BOL checkbox entirely.
Remove the PO # field entirely.

---

### 4. Remove the entire Weight & Handling section

Remove the entire `bol-section` div that contains the collapsible "Weight & Handling" section, including:
- The collapsible header and button
- Handling Unit QTY, Handling Unit Type
- Package QTY, Package Type
- Weight (lbs)

---

### 5. Update `collectPayload()`

Replace the entire payload-building logic in `collectPayload()` with the following:

```js
function collectPayload() {
  // Contact info maps to contact_info field on BOL
  const contact = document.getElementById('f-contact-name').value.trim();
  const phone   = document.getElementById('f-contact-phone').value.trim();
  const extra   = document.getElementById('f-contact-info').value.trim();
  const contactParts = [];
  if (contact || phone) contactParts.push([contact, phone].filter(Boolean).join(' · '));
  if (extra) contactParts.push(extra);

  // Additional Instructions maps to special_instructions field on BOL
  const specialInstr = document.getElementById('f-special-instructions').value.trim();

  // Project name converts to "Project c/o Company" ship-to pattern
  const project  = document.getElementById('f-project-name').value.trim();
  const company  = document.getElementById('f-ship-company').value.trim();
  let shipCompany   = company;
  let shipAttention = document.getElementById('f-ship-attention').value.trim();
  if (project) {
    shipCompany   = project;
    shipAttention = 'c/o ' + company;
  }

  return {
    bol_number:            parseInt(document.getElementById('f-bol-number').value, 10) || null,
    date:                  document.getElementById('f-date').value,
    customer_id:           selectedCustomerId || null,
    ship_to_company:       shipCompany,
    ship_to_attention:     shipAttention,
    ship_to_street:        document.getElementById('f-ship-street').value.trim(),
    ship_to_street2:       document.getElementById('f-ship-street2').value.trim(),
    ship_to_city:          document.getElementById('f-ship-city').value.trim(),
    ship_to_state:         document.getElementById('f-ship-state').value.trim(),
    ship_to_zip:           document.getElementById('f-ship-zip').value.trim(),
    location_no:           document.getElementById('f-location-no').value.trim(),
    carrier_id:            selectedCarrierId || null,
    carrier_name:          document.getElementById('carrier-search').value.trim(),
    trailer_no:            document.getElementById('f-trailer-no').value.trim(),
    is_scrap_pickup:       document.getElementById('f-scrap-pickup').checked ? 1 : 0,
    special_instructions:  specialInstr,
    contact_info:          contactParts.join('\n'),
    commodity_description: document.getElementById('f-commodity').value.trim(),
    delivery_time:         document.getElementById('f-delivery-time').value.trim(),
    notes:                 document.getElementById('f-notes').value.trim(),
    job_id:                prefilledJobId || null,
  };
}
```

---

### 6. Update `setupFreightTerms()`

Remove the `setupFreightTerms()` function entirely, and remove its call from wherever it is invoked (likely in a `DOMContentLoaded` or `init` function).

---

### 7. Update the form reset / clear function

In the function that clears all form fields (called by the Clear button), remove these field IDs from the reset list:
- `f-seal-number`
- `f-scac`
- `f-pro-no`
- `f-third-party-bill-to`
- `f-master-bol`
- `f-hu-qty`
- `f-hu-type`
- `f-pkg-qty`
- `f-pkg-type`
- `f-weight`
- `f-po-number`

Add these field IDs to the reset list:
- `f-contact-info`

Also reset the scrap pickup checkbox: `document.getElementById('f-scrap-pickup').checked = false;`

---

### 8. Update `populateBol()` (the edit/load function)

In the function that populates the form when loading an existing BOL for editing, remove any references to:
- `f-seal-number`, `f-scac`, `f-pro-no`
- `f-third-party-bill-to`
- `f-master-bol`
- `f-hu-qty`, `f-hu-type`, `f-pkg-qty`, `f-pkg-type`, `f-weight`
- `f-po-number`
- `freight-terms` radio buttons

Add population of `f-contact-info`:
```js
document.getElementById('f-contact-info').value = bol.contact_info || '';
```

For `f-contact-name` and `f-contact-phone`, these should now be populated by parsing `bol.contact_info` if the old format is present, OR just leave them blank since `contact_info` is the new combined field. Simpler approach: leave `f-contact-name` and `f-contact-phone` blank on load; only populate `f-contact-info` from `bol.contact_info`.

For `f-special-instructions`, populate from `bol.special_instructions` as before.

For the scrap pickup checkbox:
```js
document.getElementById('f-scrap-pickup').checked = !!bol.is_scrap_pickup;
```

---

## Constraints

- Do NOT modify `generatePdf()` or any COORDS
- Do NOT modify `_worker.js`
- Keep `f-contact-name` and `f-contact-phone` field IDs unchanged — they are still used in the form
- Keep all existing BOL fields in the DB payload that the API already handles — only remove fields that no longer exist in the form
- The Internal Notes section and Commodity Description section are untouched

---

## Completion

Notify me when done. No migration required.
