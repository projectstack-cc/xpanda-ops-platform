You are working inside the xPanda Operations Platform repository.

Follow all rules defined in AGENTS.md.

Objective:
Create a new QC utility tool for day-to-day floor use:

/qc/density-calculator.html

This is a standalone mobile-friendly calculator for foam density.

--------------------------------------------------
SCOPE
--------------------------------------------------

Allowed edits:

1. create /qc/density-calculator.html

Optional only if needed to make the tool reachable:
2. update the QC dashboard page to add a new tile linking to /qc/density-calculator.html

Do NOT modify:
- Apps Script
- backend routes
- shared CSS files
- shared header files
- other QC tools unless adding the dashboard link is necessary

Do NOT introduce frameworks.
Do NOT redesign the QC system.

All changes must be surgical and aligned with existing QC page patterns.

--------------------------------------------------
TOOL PURPOSE
--------------------------------------------------

This page calculates foam density in lb/ft³ using dimensions and weight.

Primary use case:
A user on the floor enters a part/block size and weight, and the page immediately calculates density.

--------------------------------------------------
UI REQUIREMENTS
--------------------------------------------------

Use the existing QC page pattern:
- inject shared header via /qc/qc-header.js
- use /qc/qc-shared.css
- mobile-friendly layout
- same card/button visual language as existing QC tools

Page title:
Density Calculator

Page subtitle:
Calculate foam density from dimensions and weight.

Create a simple calculator layout with one main card.

--------------------------------------------------
INPUTS
--------------------------------------------------

Required inputs:

- Length
- Width
- Height
- Weight (lbs)

Assume dimensions are entered in inches.

Input behavior:
- numeric-friendly mobile input modes
- clear labels
- lightweight help text indicating dimensions are in inches and weight is in pounds

--------------------------------------------------
CALCULATIONS
--------------------------------------------------

Use these formulas:

1. Cubic inches:
length × width × height

2. Cubic feet:
cubic_inches / 1728

3. Density (lb/ft³):
weight / cubic_feet

Display:
- Cubic Inches
- Cubic Feet
- Density (lb/ft³)

Format output cleanly and reasonably:
- cubic inches can be shown as a normal number
- cubic feet and density should be rounded to 3 decimal places or similar readable precision

--------------------------------------------------
OPTIONAL TARGET COMPARISON
--------------------------------------------------

Also include an optional input:

- Target Density (lb/ft³)

If target density is provided:
- show variance from target
- show whether actual density is:
  - Above Target
  - Below Target
  - On Target (if equal after reasonable rounding)

If target density is blank:
- do not show comparison messaging

Keep comparison simple and readable.

--------------------------------------------------
INTERACTION REQUIREMENTS
--------------------------------------------------

Add buttons:
- Calculate
- Reset

Preferred behavior:
- also recalculate automatically on input changes if easy to implement cleanly
- but explicit Calculate button is required

Validation:
- all required inputs must be greater than 0
- if invalid, show a clear status/error message in the same style as other QC tools

--------------------------------------------------
OUTPUT REQUIREMENTS
--------------------------------------------------

Show results in a separate results card or results section on the page.

Suggested fields:
- Cubic Inches
- Cubic Feet
- Density
- Target Density (if entered)
- Variance (if target entered)
- Comparison Result (if target entered)

Keep wording practical for shop-floor use.

--------------------------------------------------
PRESERVE QC PATTERNS
--------------------------------------------------

Use the same general page structure and conventions as other QC pages:
- shared header
- card layout
- buttons
- footer from qc-header.js

Do not overbuild this tool.
Do not add persistence.
Do not add backend submission.
Do not add report storage.

This is a local calculator only.

--------------------------------------------------
OPTIONAL DASHBOARD LINK
--------------------------------------------------

If the QC dashboard contains tiles/links for QC tools, add a new tile for:

Density Calculator

Use brief supporting text similar to the other QC tools.

If adding this link requires touching the dashboard page, keep that change minimal.

If the dashboard file is not in scope or not needed for this task, create only the calculator page.

--------------------------------------------------
DELIVERABLE
--------------------------------------------------

Return:

1. full contents of /qc/density-calculator.html
2. if updated, the minimal dashboard code addition needed to link to the new tool

Keep everything production-safe, mobile-friendly, and aligned with the current QC tool patterns.