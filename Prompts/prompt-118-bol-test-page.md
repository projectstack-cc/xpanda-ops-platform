# Prompt 118 — BOL output test page (no-persistence preview harness)

Read `AGENTS.md` and `xpanda-ops-agents.md` first. This adds a standalone test/preview page for
BOL PDF output — assume the **logistics-agent** (`xpanda-ops-agents.md`) and the **Frontend
Designer** agent (`agent-frontend-designer.md`).

Goal: a dev harness, modeled on `jobs/packing-slip-test.html`, to render a BOL PDF for positioning
and field-fill verification **without** generating a saved BOL record (no more generate → save →
delete cycle).

Scope: **create ONE new file, `logistics/bol-test.html`.** Do **not** modify `bol-shared.js`,
`bol-generator.html`, `bol-editor.js`, the worker, or any other file. **No migration. No nav link**
anywhere (homepage, module headers, anywhere) — it is reached by direct URL only, exactly like the
packing-slip test page.

---

## Hard rule: zero persistence

The page must **never** call any `/api/*` endpoint. Specifically it must never POST or PUT to
`/api/bols`. The only thing it does is render a PDF client-side and show it. This is the entire
point — nothing is written to D1, so there is nothing to delete.

## How it renders (reuse the shared engine — do NOT reimplement BOL drawing)

The page renders by calling the existing single-source engine with the preview flag:

```js
const result = await BolShared.generatePdf([bol], { previewOnly: true });
// result.blobUrl is an object URL to the rendered PDF; show it in the iframe.
iframe.src = result.blobUrl;
```

`generatePdf(..., { previewOnly: true })` returns `{ blobUrl, pdfBytes }` and does not open a tab,
download, or save anything. Before each re-render, revoke the previous `blobUrl`
(`URL.revokeObjectURL`) to avoid leaks. Wrap the call in try/catch and show any error
(e.g. template fetch failure) in a visible status line on the page.

## Required dependencies (copy these exact includes from `bol-generator.html`)

```html
<link rel="stylesheet" href="/logistics/logistics-shared.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
<script src="/logistics/bol-shared.js"></script>
```

(No `logistics-header.js`, no `bol-editor.js` — keep it a bare harness like the parser test page.)

## The `bol` object — build it from the form, using these EXACT property names

`generatePdf` reads these fields off the `bol` object (verified against `bol-shared.js`). The form
must have an input for each, and the page assembles them into one object with these keys:

| Form field | `bol` property | Notes |
|---|---|---|
| Delivery Time | `delivery_time` | renders bold red, top-right |
| Date | `date` | use an `<input type="date">`; value is `YYYY-MM-DD` (engine formats to `MM/DD/YYYY`) |
| BOL Number | `bol_number` | |
| Carrier | `carrier_name` | |
| Trailer # | `trailer_no` | |
| Ship-To Company | `ship_to_company` | ship-to block is built by `buildShipToLines` |
| Ship-To Attention | `ship_to_attention` | |
| Ship-To Street | `ship_to_street` | |
| Ship-To Street 2 | `ship_to_street2` | |
| Ship-To City | `ship_to_city` | |
| Ship-To State | `ship_to_state` | |
| Ship-To Zip | `ship_to_zip` | |
| Contact Name | `contact_name` | engine renders `POC: <name> <phone>` |
| Contact Phone | `contact_phone` | |
| PO Number | `po_number` | engine prefixes `PO: ` |
| Commodity Description | `commodity_description` | centered, auto-sized by line count |
| Special Instructions | `special_instructions` | multiline (`<textarea>`) |
| Scrap Pickup | `is_scrap_pickup` | checkbox → boolean; draws an `X` in the Yes box when true, No box when false |
| (hidden/fixed) | `access_token` | set to a dummy value so the tracking QR renders for positioning |

Do **not** pass `_overrides` — this harness tests the standard (un-overridden) render path.

## Prefilled dummy data (obvious test garbage, so each field is identifiable on the PDF)

Prefill all inputs on load with values like these so positioning is easy to verify at a glance:

```
delivery_time:        "DELIVERY 8:00 AM"
date:                 "2026-06-05"
bol_number:           "TEST-BOL-001"
carrier_name:         "ABC Carrier Co"
trailer_no:           "TRLR-9999"
ship_to_company:      "ABC Company"
ship_to_attention:    "John Tester"
ship_to_street:       "123 Test St"
ship_to_street2:      "Suite 100"
ship_to_city:         "Testville"
ship_to_state:        "FL"
ship_to_zip:          "33000"
contact_name:         "Jane Tester"
contact_phone:        "555-0100"
po_number:            "PO-TEST-456"
commodity_description: "TEST COMMODITY — Foam Blocks 12x12x12, Qty 40"
special_instructions: "TEST special instructions line one\nTEST line two"
is_scrap_pickup:      true   (checkbox checked by default)
access_token:         "TESTTOKEN123"
```

## Layout / behavior

- Two-column on desktop (form left, PDF preview iframe right), single column on mobile — follow the
  Frontend Designer tokens/components and `logistics-shared.css` for styling. Use existing CSS
  variables; no hardcoded colors where a token exists.
- A **"Render BOL"** button builds the `bol` object and renders into the iframe.
- A **"Reset to sample"** button restores the dummy values above.
- Render once automatically on page load so the preview is populated immediately.
- A small status line shows "Rendered" / any error text.

## Result
Open `/logistics/bol-test.html` directly → the dummy BOL renders instantly in the preview. Edit any
field, hit Render, and confirm placement on the template. Toggle Scrap Pickup to confirm the `X`
moves between the Yes/No boxes. Nothing is ever saved; there is no record to delete. Because it
calls `BolShared.generatePdf`, any future coordinate change in `bol-shared.js` is reflected here
automatically with no edits to this page.

## Verify after editing
- Confirm the new file deployed to Cloudflare and loads at `/logistics/bol-test.html`.
- Confirm no `/api/bols` (or any `/api/*`) request fires on render — check the Network tab; the only
  fetch should be the BOL template PDF and the static assets.
- Confirm the page is **not** linked from the homepage or any module header.
