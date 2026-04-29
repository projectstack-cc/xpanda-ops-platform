# BOL PDF Generator — Plan & Claude Code Prompts

## Analysis Summary

### What I Found

**67 PDF files** in the zip — 46 unique customer BOLs, their copies, and 4 blank templates:
- `BLANK_BOL_Xpanda.pdf` — The clean blank template (non-fillable PDF, text overlays needed)
- `BLANK_BOL.pdf` — A filled example (N. FL Roof Decks, BOL #3234)
- `BW_Blank BOL.pdf` / `BW_2Blank BOL.pdf` / `BH-BLANK_BOL.pdf` / `BlueWater- BLANK BOL.pdf` — Customer-specific blank variants (Blue Water / Blue Hippo)

**Template format:** Standard "Straight Bill of Lading — Original – Not Negotiable" with fixed Ship From (Xpanda Foam, LLC / 1090 Gills Dr. / Orlando, FL 32824). The PDFs are **not fillable** — they have no form fields. All customer data is baked into each PDF as text overlays on the blank template.

**Key fields identified from all 46 BOLs:**

| Field | Example | Notes |
|-------|---------|-------|
| Date | 12/01/25 | Ship date, top right |
| Bill of Lading No | 3425 | Large bold number |
| Ship To (Company) | Homosassa Printing | Line 1 of ship-to block |
| Ship To (Attn/c/o) | c/o ABC Supply -Dunnellon #497 | Optional line 2 |
| Ship To (Street) | 7975 W. Grover Cleveland Blvd. | Street address |
| Ship To (City/State/Zip) | Homosassa, FL 34446 | City state zip |
| Location No | (rarely used) | Optional |
| Carrier Name | LISMA Logistics, Xpanda Truck, XP Co. Truck, CPU, Priority1 | ~5 carriers |
| Trailer No | (sometimes filled) | |
| Seal Number(s) | (rarely used) | |
| SCAC | (rarely used) | |
| Pro No | (rarely used) | |
| Freight Terms | Prepaid / Collect / 3rd Party / Scrap Pick-Up | Checkboxes |
| 3rd Pty Bill To | (sometimes filled) | |
| Special Instructions | Contact + PO info area | Free text |
| Master BOL | (checkbox, rarely used) | |
| Commodity Description | Free-text product list | Multi-line, variable |
| Handling Unit QTY/TYPE | (sometimes used) | |
| Package QTY/TYPE | (sometimes used) | |
| Weight | (sometimes used) | |
| Delivery time annotations | "MON. 8:00am", "Fri. 10:00am" | Sometimes added above title |

**Customer data extracted:** 32 customers with complete, verified address data seeded into the database. 14 customers were excluded due to missing addresses (job-site-only deliveries) or incomplete data — these can be added manually through the address manager.

**Carriers observed:** LISMA Logistics, LISMA Flatbed, Xpanda Truck, XP Co. Truck, Xpanda Co Truck, CPU (Customer Pick Up), Priority1

---

## Architecture Plan

### Phase 1: Database Schema, API Routes, and Customer Seed Data

**New D1 table:** `bol_customers` — stores customer ship-to addresses extracted from the BOLs, plus manual entry.

**New D1 table:** `bols` — stores generated BOL records with auto-incrementing BOL numbers.

**New D1 table:** `bol_carriers` — stores carrier names for dropdown reuse.

**API routes** in `_worker.js` for CRUD on customers, carriers, and BOL generation.

### Phase 2: BOL Generator UI + PDF Generation

New page at `/logistics/bol-generator.html` that:
1. Lets user select a customer from saved addresses (searchable dropdown) OR manually enter a custom ship-to address
2. Fills in all BOL fields via a form
3. Generates a filled PDF using the blank template (client-side with pdf-lib)
4. Auto-increments BOL numbers
5. Stores the BOL record in the database

### Phase 3 (Optional): Job Board Integration

Soft link: "Generate BOL" button on Done/Shipped job cards pre-fills the form from job data.

---

## Claude Code Prompts

### Prompt 1: Database Schema, API Routes, and Customer Seed Data

```
You are working inside the xPanda Operations Platform repository.

Follow all rules defined in AGENTS.md.

**Prerequisite:** The Logistics Dashboard at `/logistics/` exists with shared CSS/header and the `shipments` table in D1. The `/logistics/index.html` page is already built.

---

## Objective

Add the backend for a BOL PDF generator: database tables for customer addresses, carrier list, and BOL records; API routes for CRUD operations; and seed data from extracted customer BOLs.

---

## Scope of Changes

### 1. Database Schema

Add three new tables to D1. Document the CREATE TABLE SQL as a comment block in `_worker.js` near the new route handlers.

#### Table: `bol_customers`

Stores saved ship-to addresses. Some customers deliver to job sites rather than a fixed address — those customers can be added manually as needed. The BOL generator also supports a "Custom Address" mode for one-off deliveries.

```sql
CREATE TABLE IF NOT EXISTS bol_customers (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  attention TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  street2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bol_customers_company ON bol_customers(company);
CREATE INDEX IF NOT EXISTS idx_bol_customers_active ON bol_customers(is_active);
```

#### Table: `bol_carriers`

```sql
CREATE TABLE IF NOT EXISTS bol_carriers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scac TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Seed with these carriers extracted from the BOLs:
- LISMA Logistics
- LISMA Flatbed
- Xpanda Truck
- XP Co. Truck
- Customer Pickup (CPU)
- Priority1

#### Table: `bols`

Stores generated BOL records. The `bol_number` auto-increments from the last used number.

```sql
CREATE TABLE IF NOT EXISTS bols (
  id TEXT PRIMARY KEY,
  bol_number INTEGER NOT NULL UNIQUE,
  date TEXT NOT NULL,
  customer_id TEXT DEFAULT NULL,
  ship_to_company TEXT NOT NULL DEFAULT '',
  ship_to_attention TEXT NOT NULL DEFAULT '',
  ship_to_street TEXT NOT NULL DEFAULT '',
  ship_to_street2 TEXT NOT NULL DEFAULT '',
  ship_to_city TEXT NOT NULL DEFAULT '',
  ship_to_state TEXT NOT NULL DEFAULT '',
  ship_to_zip TEXT NOT NULL DEFAULT '',
  location_no TEXT NOT NULL DEFAULT '',
  carrier_id TEXT DEFAULT NULL,
  carrier_name TEXT NOT NULL DEFAULT '',
  trailer_no TEXT NOT NULL DEFAULT '',
  seal_number TEXT NOT NULL DEFAULT '',
  scac TEXT NOT NULL DEFAULT '',
  pro_no TEXT NOT NULL DEFAULT '',
  freight_terms TEXT NOT NULL DEFAULT 'prepaid',
  third_party_bill_to TEXT NOT NULL DEFAULT '',
  special_instructions TEXT NOT NULL DEFAULT '',
  is_master_bol INTEGER NOT NULL DEFAULT 0,
  commodity_description TEXT NOT NULL DEFAULT '',
  handling_unit_qty TEXT NOT NULL DEFAULT '',
  handling_unit_type TEXT NOT NULL DEFAULT '',
  package_qty TEXT NOT NULL DEFAULT '',
  package_type TEXT NOT NULL DEFAULT '',
  weight TEXT NOT NULL DEFAULT '',
  delivery_time TEXT NOT NULL DEFAULT '',
  job_id TEXT DEFAULT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES bol_customers(id) ON DELETE SET NULL,
  FOREIGN KEY (carrier_id) REFERENCES bol_carriers(id) ON DELETE SET NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bols_number ON bols(bol_number);
CREATE INDEX IF NOT EXISTS idx_bols_date ON bols(date);
CREATE INDEX IF NOT EXISTS idx_bols_customer ON bols(customer_id);
```

### 2. API Routes

#### Customer Routes

`GET /api/bol-customers`
- Query params: `?search=text` (searches company, attention, city), `?active=1`
- Returns all matching customers ordered by company name
- Default: only active customers

`POST /api/bol-customers`
- Create a new customer address. Generates UUID.

`PUT /api/bol-customers/:id`
- Update a customer address. Sets `updated_at`.

`DELETE /api/bol-customers/:id`
- Soft delete: sets `is_active = 0`

#### Carrier Routes

`GET /api/bol-carriers`
- Returns all active carriers ordered by name

`POST /api/bol-carriers`
- Create a new carrier. Generates UUID.

#### BOL Routes

`GET /api/bols`
- Query params: `?days=30`, `?customer_id=uuid`, `?search=text`
- Returns BOL records ordered by `bol_number DESC`

`GET /api/bols/next-number`
- Returns the next available BOL number: `SELECT MAX(bol_number) + 1 FROM bols`
- If no BOLs exist yet, return 3600 (continuing from the ~3523 seen in the most recent BOLs)

`POST /api/bols`
- Create a new BOL record. Generates UUID.
- If `bol_number` is not provided, auto-assign from next-number logic.
- Returns the created BOL with all fields.

`GET /api/bols/:id`
- Get a single BOL by ID

### 3. Seed Data

Create a seed endpoint `POST /api/bol-customers/seed` that inserts the extracted customer data if the table is empty. This should only run once. Embed the seed data directly in the route handler:

[
  {"company":"ABC Supply - Dunnellon #497","attention":"","street":"7975 W. Grover Cleveland Blvd.","city":"Homosassa","state":"FL","zip":"34446","contact_name":"Austin","phone":"352-564-8319"},
  {"company":"AF Barriers","attention":"Attn: Scott Fullerton","street":"4455 18th St. East","city":"Bradenton","state":"FL","zip":"34203","contact_name":"Kody Deiter","phone":"941-584-3906"},
  {"company":"All Florida Weatherproofing","attention":"Attn: Rick Fulford","street":"4231 112th Terrace North","city":"Clearwater","state":"FL","zip":"33762","contact_name":"Rick","phone":"352-702-5052"},
  {"company":"Accusolar","attention":"Attn: Trish Nicholson","street":"1800 SW 13th Ct.","city":"Pompano Beach","state":"FL","zip":"33069","contact_name":"Trish Nicholson","phone":"954-785-7557"},
  {"company":"Accudock","attention":"Attn: PM Nicholson","street":"1790 SW 13th Ct.","city":"Pompano Beach","state":"FL","zip":"33069","contact_name":"Trish Nicholson","phone":"954-785-7557"},
  {"company":"Alumflo Inc.","attention":"Attn: Mark Daniel","street":"2445 51st. Ave. N","city":"St. Petersburg","state":"FL","zip":"33714","contact_name":"Mark Daniel","phone":""},
  {"company":"Architechtural Foam Fab, LLC","attention":"","street":"8360 Currency Dr., Ste 2","city":"West Palm Beach","state":"FL","zip":"33404","contact_name":"","phone":""},
  {"company":"Atlantic Packaging Corp.","attention":"Attn: Ken Thorpe","street":"5301 W 5th St., Ste 1","city":"Jacksonville","state":"FL","zip":"32254","contact_name":"Ken Thorpe","phone":"904-409-3560"},
  {"company":"BMMI","attention":"Attn: Scott Reed","street":"8210 Manasota Key Rd.","city":"Englewood","state":"FL","zip":"34223","contact_name":"Kyle","phone":"863-990-8347"},
  {"company":"Bellingham Marine","attention":"Attn: Josh Hebert","street":"2014 Dennis St.","city":"Jacksonville","state":"FL","zip":"32204","contact_name":"Josh Hebert","phone":""},
  {"company":"CG3 - Victory Mgmt. Sol. Inc.","attention":"Attn: Enrique Aranda","street":"2423 Ryan Blvd","city":"Punta Gorda","state":"FL","zip":"33950","contact_name":"Enrique Aranda","phone":"305-803-2256"},
  {"company":"Prestige Spa Covers (CORE)","attention":"Attn: Charline Fisher","street":"2875 MCI Dr.","city":"Pinellas Park","state":"FL","zip":"33782","contact_name":"Charline Fisher","phone":""},
  {"company":"Collis Roofing, Inc.","attention":"","street":"485 Commerce Way","city":"Longwood","state":"FL","zip":"32750","contact_name":"","phone":""},
  {"company":"Comfort Cover Systems Inc.","attention":"","street":"711 Turner St.","city":"Clearwater","state":"FL","zip":"33756","contact_name":"Bob","phone":"727-298-0955"},
  {"company":"Community Roofing","attention":"Attn: Joe Perrini","street":"14042 66th Street","city":"Largo","state":"FL","zip":"33771","contact_name":"Joe Perrini","phone":"352-410-0548"},
  {"company":"Coolstructures Inc.","attention":"","street":"7173 Gasparilla Rd.","city":"Port Charlotte","state":"FL","zip":"33981","contact_name":"Al","phone":"855-220-0240"},
  {"company":"Crown Packaging","attention":"","street":"2716 Hazelhurst Ave.","city":"Orlando","state":"FL","zip":"32804","contact_name":"","phone":""},
  {"company":"Diversitech","attention":"Attn: Daniel Dees","street":"1632 3rd St.","city":"Leesburg","state":"FL","zip":"34748","contact_name":"Daniel Dees","phone":"352-530-4930"},
  {"company":"Foam World, LLC","attention":"Attn: Devin Angels","street":"3591 Work Dr. Bldg. B","city":"Fort Myers","state":"FL","zip":"33916","contact_name":"Devin Angels","phone":""},
  {"company":"Gulfeagle Supply - #002","attention":"","street":"2649 Rosselle St.","city":"Jacksonville","state":"FL","zip":"32204","contact_name":"","phone":""},
  {"company":"John Abell Corp.","attention":"attn: Jesus Quintana","street":"10500 SW 186 ST.","city":"Miami","state":"FL","zip":"33157","contact_name":"Jesus Quintana","phone":""},
  {"company":"Lansing Building Products - Ocala","attention":"","street":"5371 SE Maricamp Rd.","city":"Ocala","state":"FL","zip":"34480","contact_name":"","phone":""},
  {"company":"Lion TB Construction","attention":"Attn: Sam Kazmarek","street":"10020 US Hwy 301 N","city":"Tampa","state":"FL","zip":"33637","contact_name":"Sam Kazmarek","phone":"813-985-0850"},
  {"company":"New Panel Kits LLC","attention":"Attn: Jeanne Bishop","street":"510 Paul Morris Dr","city":"Englewood","state":"FL","zip":"34223","contact_name":"Brian Bishop","phone":"941-915-3090"},
  {"company":"Ocala Architechtural Foam, LLC","attention":"","street":"7175 S. Pine Ave. STE A","city":"Ocala","state":"FL","zip":"34480","contact_name":"Nicholas","phone":""},
  {"company":"Precast & Foam Works","attention":"","street":"6612 Osteen Rd.","city":"New Port Richey","state":"FL","zip":"34653","contact_name":"Gabor","phone":""},
  {"company":"Net Zero Building / Spray Rock Mnfg.","attention":"","street":"7980 SW Jack James Dr.","city":"Stuart","state":"FL","zip":"34997","contact_name":"John","phone":"954-205-9577"},
  {"company":"Supply One ORL","attention":"","street":"3505 NW 112th St.","city":"Miami","state":"FL","zip":"33167","contact_name":"","phone":""},
  {"company":"Town & Country #816","attention":"Attn: Darcy Miller","street":"4311 Shader Rd. Ste 100","city":"Orlando","state":"FL","zip":"32808","contact_name":"Kosta","phone":"407-292-1517"},
  {"company":"Virginia Foam","attention":"attn: Alex Gonzalez","street":"1120 Summit St.","city":"Fredericksburg","state":"VA","zip":"22401","contact_name":"Alex Gonzalez","phone":"540-681-7665"},
  {"company":"Yanaex Inc.","attention":"Attn: Misha Gryb","street":"8802 Corporate Square Ct., Ste. #106-206","city":"Jacksonville","state":"FL","zip":"32216","contact_name":"Misha Gryb","phone":""},
  {"company":"Spectrum Eng. & Mfg. Inc","attention":"","street":"11609 Pyramid Dr.","city":"Odessa","state":"FL","zip":"33556","contact_name":"","phone":""}
]

---

### 4. Update Logistics Dashboard

Add a tile/button on `/logistics/index.html` for the BOL Generator:

- Title: `BOL Generator`
- Description: `Generate Bills of Lading with saved customer addresses`
- Links to: `/logistics/bol-generator.html`

Place this alongside the existing outbound/inbound views and the Load Builder link. It should feel like a core tool, not a secondary link.

---

## Rules

- No frameworks. Vanilla HTML, CSS, JavaScript only.
- Follow existing `_worker.js` patterns exactly.
- All new routes under `/api/bol-*` namespace.
- UUID generation matches existing pattern in worker.
- No authentication on routes (matching existing pattern).
```

---

### Prompt 2: BOL Generator UI Page + PDF Generation

```
You are working inside the xPanda Operations Platform repository.

Follow all rules defined in AGENTS.md.

**Prerequisite:** The Logistics Dashboard at `/logistics/` exists. The `bol_customers`, `bol_carriers`, and `bols` tables exist in D1 with API routes at `/api/bol-customers`, `/api/bol-carriers`, and `/api/bols`. The seed data has been loaded.

---

## Objective

Build the BOL Generator page at `/logistics/bol-generator.html`. This page lets users fill out a Bill of Lading form, select from saved customers or enter a custom address, and generate a filled PDF based on the Xpanda Foam blank BOL template.

---

## Scope of Changes

### New file: `/logistics/bol-generator.html`

Uses `logistics-shared.css` and `logistics-header.js`.

Page title: `BOL Generator`
Page subtitle: `Generate Bills of Lading`

---

### Section 1: Form Layout

The form mirrors the physical BOL layout. Organize in sections matching the actual document:

**Header Section:**
- Date (date input, defaults to today)
- BOL Number (auto-populated from `GET /api/bols/next-number`, editable)
- Delivery Time (text input — e.g., "MON. 8:00am", "Fri. 10:00am")

**Ship To Section:**
- Customer selector: a searchable dropdown/combobox that searches `GET /api/bol-customers?search=` as user types
  - When a customer is selected, auto-fill company, attention, street, city, state, zip, contact, phone from the saved record
  - Include a "Custom Address" toggle/button that clears the saved fields and enables manual entry for job-site deliveries or new customers
  - When using a saved customer, allow editing the address fields (for job-site overrides). Show a subtle indicator: "Using saved address for [Company]" or "Custom address (not saved)"
- Ship To Company (text)
- Ship To Attention / c/o (text)
- Ship To Street (text)
- Ship To Street 2 (text, optional)
- Ship To City (text)
- Ship To State (text, default "FL")
- Ship To Zip (text)
- Location No (text, optional)

**Project/Job Site Fields:**
- Project Name (text, optional — when filled, the Ship To will render as "Project Name c/o Company" on the BOL, which is the pattern used for job-site deliveries)

**Carrier Section:**
- Carrier Name (searchable dropdown from `GET /api/bol-carriers`, with free-text fallback)
- Trailer No (text)
- Seal Number (text)
- SCAC (text)
- Pro No (text)

**Freight Terms Section:**
- Radio buttons: Prepaid (default), Collect, 3rd Party, Scrap Pick-Up
- 3rd Party Bill To (text, shown only when "3rd Party" selected)

**Special Instructions Section:**
- Contact Name (text — pre-filled from customer record)
- Contact Phone (text — pre-filled from customer record)
- PO# (text)
- Additional Instructions (textarea)
- Master BOL checkbox

**Commodity Description Section:**
- Large textarea for product description
- This is free-text — examples from actual BOLs:
  - "640 pcs - 1.0#EPS 1.25\" x 96\" x 11/9\" TAPER"
  - "1\" - 8 bundles (288 pcs)\n2\" - 25 bundles (450 pcs)\n..."
  - "Total 143 pcs - 1.0# EPS block\n* see packing list for actual sizes & quantities"

**Weight/Handling Section (optional, collapsible):**
- Handling Unit QTY / TYPE
- Package QTY / TYPE
- Weight
- H.M. (X)
- NMFC No / Class

---

### Section 2: PDF Generation

**Approach:** Use the blank Xpanda BOL template PDF (`BLANK_BOL_Xpanda.pdf`) as the base. The template is stored as a static asset at `/logistics/assets/BLANK_BOL_Xpanda.pdf`.

**PDF generation happens client-side using pdf-lib** (loaded from CDN: `https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js`).

The generation process:
1. Fetch the blank template PDF
2. Load it with pdf-lib
3. Draw text at the exact coordinates for each field (coordinates determined from the template structure — see coordinate reference below)
4. For checkboxes (freight terms, Master BOL), draw an "X" character at the checkbox position
5. Save the modified PDF
6. Open in a new tab or trigger download

**Template coordinate reference** (PDF coordinates, origin at bottom-left, units in points — 72 points/inch, letter size 612x792):

The blank template `BLANK_BOL_Xpanda.pdf` has the following field positions (these are approximate — the implementation should fine-tune by testing):

| Field | x | y (from bottom) | Font Size | Notes |
|-------|---|-----------------|-----------|-------|
| Date | 338 | 711 | 10 | After "Date:" label |
| BOL Number | 380 | 685 | 24 | Large bold, centered in box |
| Carrier Name | 400 | 648 | 10 | After "Carrier Name:" label |
| Trailer No | 400 | 633 | 10 | After "Trailer No:" |
| Seal Number | 400 | 618 | 10 | After "Seal Number(s):" |
| SCAC | 400 | 603 | 10 | After "SCAC:" |
| Pro No | 400 | 588 | 10 | After "Pro No:" |
| Ship To Line 1 | 55 | 610 | 10 | Company name |
| Ship To Line 2 | 55 | 597 | 10 | Attention / c/o |
| Ship To Line 3 | 55 | 584 | 10 | Street |
| Ship To Line 4 | 55 | 571 | 10 | City, State Zip |
| Location No | 215 | 625 | 10 | After "Location No:" |
| Freight Prepaid checkbox | 49 | 535 | 10 | "X" for check |
| Freight Collect checkbox | 105 | 535 | 10 | "X" for check |
| Freight 3rd Party checkbox | 164 | 535 | 10 | "X" for check |
| Freight Scrap checkbox | 245 | 535 | 10 | "X" for check |
| 3rd Pty Bill To | 55 | 510 | 9 | Below freight terms |
| Special Instructions | 310 | 530 | 9 | Multi-line area |
| Master BOL checkbox | 538 | 545 | 10 | "X" for check |
| Commodity Description | 245 | 430 | 10 | Multi-line, start below header |
| Delivery Time | 36 | 760 | 10 | Above the title, if provided |

**IMPORTANT:** These coordinates are estimates. The developer MUST test the PDF output and fine-tune positions. The approach should be:
1. Start with these estimates
2. Generate a test PDF with sample data
3. Compare overlay positions with the blank template
4. Adjust coordinates until text lands in the correct boxes

**Ship From is pre-printed on the template** — do NOT draw Ship From text. It's already on the blank:
- Xpanda Foam, LLC
- 1090 Gills Dr.
- Orlando, FL 32824

---

### Section 3: Actions & Workflow

**"Generate BOL" button:**
1. Validates required fields (date, BOL number, at least company name in ship-to)
2. POSTs to `/api/bols` to save the record
3. Generates the PDF client-side
4. Opens PDF in a new tab for printing/download
5. Shows success toast: "BOL #XXXX generated"

**"Save Draft" button:**
- Saves to D1 without generating PDF

**"Clear Form" button:**
- Resets all fields, fetches next BOL number

**Recent BOLs sidebar/section:**
- Shows last 10 BOLs from `GET /api/bols?days=30`
- Each entry shows: BOL#, date, customer, carrier
- Clicking loads that BOL's data into the form for reprinting/editing
- "Reprint" button generates the PDF again from saved data

---

### Section 4: Customer Address Manager (inline)

Include a collapsible "Manage Addresses" section at the bottom or as a slide-out panel:

- Table of all saved customers from `GET /api/bol-customers`
- Search/filter box
- "Add New Customer" button → opens an inline form
- Each row has Edit and Deactivate buttons
- Edit opens the same inline form pre-filled
- Changes save via `PUT /api/bol-customers/:id`
- Deactivate calls `DELETE /api/bol-customers/:id` (soft delete)

---

## Technical Notes

- pdf-lib CDN: `https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js`
- The blank template must be copied to `/logistics/assets/BLANK_BOL_Xpanda.pdf` as a static asset served by Cloudflare Pages
- Font for PDF text: use pdf-lib's embedded StandardFonts.Helvetica (matches the template's clean look)
- For the BOL number, use StandardFonts.HelveticaBold at ~24pt
- The commodity description area supports multi-line — split on newlines and draw each line with ~14pt line spacing
- All form state is vanilla JS — no frameworks

---

## Rules

- No frameworks. Vanilla HTML, CSS, JavaScript only.
- Follow existing logistics section patterns for styling.
- PDF generation is entirely client-side using pdf-lib.
- Mobile-friendly — the form should work on iPad (this is used on the production floor).
- Keep code readable for a single maintainer.
- The customer search dropdown is the most important UX element — it must be fast and keyboard-navigable.
- Test the PDF output coordinates carefully — text must land inside the correct boxes on the template.
```

---

### Prompt 3 (Optional): Integration with Job Board

```
You are working inside the xPanda Operations Platform repository.

Follow all rules defined in AGENTS.md.

**Prerequisite:** The BOL Generator at `/logistics/bol-generator.html` is fully functional. The Job Board at `/jobs/` exists with the `jobs` table.

---

## Objective

Add a soft integration between the Job Board and the BOL Generator. When a job is ready to ship, the user can generate a BOL pre-filled from the job data.

---

## Changes

### 1. Job Board → BOL link

On the Job Board (`/jobs/index.html`), add a "Generate BOL" action button on job cards that are in the "Done" or "Shipped" column. This button links to:

`/logistics/bol-generator.html?job_id={job_id}`

### 2. BOL Generator: Accept job_id query param

When `/logistics/bol-generator.html` loads with a `?job_id=` parameter:

1. Fetch the job via `GET /api/jobs/{job_id}`
2. Pre-fill the BOL form:
   - Customer: match by job's customer name against `bol_customers` (fuzzy search). If found, select it. If not, populate the custom address fields with whatever the job has.
   - PO#: from the job's PO/invoice number
   - Commodity Description: from the job's line items (parts list with quantities)
   - Contact: from the job's contact field
   - Carrier: from the job's carrier/method field if present
3. Show a banner: "Pre-filled from Job: [customer] — [job description]"
4. The user reviews, adjusts as needed, and generates

### 3. BOL record links back to job

When a BOL is generated from a job, store the `job_id` in the `bols` table. On the job card, show the BOL number as a link once generated.

---

## Rules

- This is a soft integration — the BOL generator works fine without a job_id
- Don't modify any existing job board functionality
- The pre-fill is a convenience, not a forced workflow
- If the job doesn't have enough data to fill a field, leave it blank
```
