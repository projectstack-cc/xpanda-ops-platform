# Prompt 137 — Platform QC Pass: AI Slop / Spaghetti Audit (REPORT ONLY)

## Mandatory reading (do this first, before anything else)

1. Read **`AGENTS.md`** in full.
2. Read **`xpanda-ops-agents.md`** in full.
3. For this task you are operating as the **Orchestrator** coordinating a read-only audit. Apply each domain agent's lens to its own module:
   - **job-board-agent** → `jobs/*`
   - **logistics-agent** → `logistics/*`
   - **production-agent** → `production/*`, `manufacturing/*`
   - **qc-agent** → `qc/*`
   - **safety-agent** → `safety/*`
   - **reports-agent** → `reports/*`
   - **admin-auth-agent** → `admin/*`, `login.html`
   - **db-api-agent** → `_worker.js/*`, `DB_Migrations/*`
   - The **PO-to-PDF investigation** (Section C) is owned by **logistics-agent** with **db-api-agent**.

## This is a REPORT-ONLY pass. Read these rules and do not break them.

- **Make no fixes. Change no behavior.** Do not edit, refactor, reformat, or "clean up" any existing file.
- The **only** file you may create is the audit report described in Section D (`qc-slop-audit.md` at repo root). Nothing else on disk changes.
- **Do not touch** `STORAGE_KEY` (`foam_trailer_loader_v31`) or the load builder auto-pack algorithm — not even to read-and-comment on internals beyond what's needed to note they exist.
- **Do not run, generate, or apply any D1 migration.** Migrations are out of scope entirely for this pass.
- Diagnose against **landed code only**. Run `git pull` first and work from current `main`. Do not reference local pre-change artifacts.

## Scope exclusions (do NOT report these as findings — they are expected)

- `.git/`, `.wrangler/` (build/dev artifacts — the bundled worker copy under `.wrangler/tmp/*` is not source).
- Vendored third-party libraries (pdf-lib, pdf.js, SheetJS/xlsx, Chart.js) — do not lint other people's code.
- `fetch(` calls **inside `_worker.js/*`** — server-side fetch (`env.ASSETS.fetch`, external APIs) is correct and is not the `shared/shared-api.js` helper's domain.
- `admin/*` headers being hand-rolled rather than using `shared/shared-header.js` — this is a documented, intentional exemption. Note it once, do not flag per-page.
- The existing audit files at repo root: `permissions-audit.md`, `design-token-audit.md`, `r2-migration-inventory.md`. Do **not** re-derive them. Reference them, and only flag a finding if one is now **stale or contradicted** by landed code.

---

## A. What to hunt for ("slop / spaghetti" taxonomy)

For each category, the goal is an inventory with exact `file:line` anchors, a one-line description, and a severity. Concrete starting targets from a pre-scan are listed where known — confirm them and find the rest; the lists below are seeds, not the full set.

1. **Dead / orphaned code & files** — unreferenced files, functions never called, scaffolding left behind.
   - Confirmed seed: `temp-home.html` (0 bytes, repo root) — orphan.
   - Check: `jobs/packing-slip-test.html`, `logistics/bol-test.html` — confirm whether each is reachable from any nav/link and classify (intentional dev harness vs. true orphan). Note that BACKLOG already calls for hiding `packing-slip-test.html`.

2. **Duplication / multiple sources of truth (drift)** — the same logic, constant, or coordinate defined in more than one place. This is the highest-value category given the platform's history (the entire P123–P128 BOL re-unification existed to kill this).
   - Verify the BOL flow is genuinely single-engine now: `logistics/bol-shared.js` (coords/render), `logistics/bol-compose.js` (modal/state/generate/save/review), `logistics/bol-editor.js` (overlay). Flag any field, coordinate, or render branch defined in two of these, or any logic in `bol-generator.html` / `load-builder.html` that duplicates the shared engine instead of calling it.
   - Look for repeated density formulas, date formatters, `escHtml`/`truncate`-style helpers reimplemented inline despite `shared/shared-utils.js` existing.

3. **Abandoned-migration debt (helper adopted in some places, not others)** — the platform shipped shared helpers (F1) but most modules still hand-roll.
   - Confirmed seed: raw `fetch(` still used instead of `api.*` (`shared/shared-api.js`) in `admin/*` (~50 sites), `manufacturing/*` (~6), `safety/*` (~5), `shared/*` (~9), and a few in `logistics/*` (~4). Inventory these by file with counts; do **not** convert them.
   - `document.write(...)` legacy header pattern present in: `shared/shared-header.js`, `jobs/jobs-header.js`, `qc/qc-header.js`, `logistics/logistics-header.js`, `production/production-header.js`, `reports/reports-header.js`, `manufacturing/manufacturing-header.js`, and `logistics/load-builder.html`. Confirm and list. (Known debt per db-api-agent — inventory it, do not fix.)

4. **Dangling references / broken wiring** — calls to functions/ids/handlers that no longer exist, or are defined but never wired. (Precedent: P128 fixed a dangling `closeBolReviewLB` ref.) Grep for `onclick=`/`addEventListener` handlers and `getElementById` targets that have no matching definition/element, especially in the large files (`load-builder.html`, `bol-generator.html`, `jobs/index.html`, `admin/roles.html`).

5. **Eval-time DOM access** — top-level/IIFE code that touches `document.body` or queries elements at script-eval time (before the body exists). This was the P128 crash class. Flag any top-level DOM read/manipulation that isn't deferred to a function/`DOMContentLoaded`.

6. **Oversized files / functions doing too much** — note files that have grown unwieldy (`load-builder.html` ~140KB, `block-calculator.html`, `jobs/index.html`, `bol-generator.html`) and call out specific monster functions (>~150 lines or mixing concerns), as candidates for future extraction. Inventory only.

7. **Debug / leftover cruft** — `console.log`/`console.debug` left in shipped paths (seed: `_worker.js/routes/qc.js` ×5, `qc/incident-report.html` ×1), commented-out code blocks, `TODO`/`FIXME`/`HACK` markers, unused variables/imports.

8. **Inconsistency** — naming drift (camelCase vs snake_case for the same concept across the boundary), magic numbers that should be named constants, copy-pasted blocks that diverged slightly. Cross-reference `design-token-audit.md` for styling/token drift rather than re-auditing tokens; only add findings it doesn't already cover.

## B. Per-module pass

Walk each module with its domain-agent lens and record findings under that module's heading in the report. For every finding capture: `file:line`, category (from Section A), one-line description, severity (Critical / High / Medium / Low), and a one-line "suggested direction" (NOT applied — just the note for triage).

Severity guide:
- **Critical** — a functional bug, data-integrity risk, or auth/permission gap.
- **High** — duplicated source-of-truth or broken pattern that actively causes drift/regressions.
- **Medium** — real debt (abandoned-migration sites, dead code, oversized units).
- **Low** — cosmetic (naming, stray console.logs, comments).

## C. Targeted investigation — PO number not rendering on `bol-generator.html` BOLs

A user reports that a PO/purchase-order number entered on `logistics/bol-generator.html` does not appear on the generated BOL PDF. Confirm the root cause against landed code and document it in the report. **Do not fix it** — this pass produces the diagnosis only.

Trace and verify this exact chain:
1. `logistics/bol-shared.js` — the renderer draws PO from `bol.po_number || bol.poNumber` (look at the `poNumber` entry in `COORDS`/`FIELD_MAP` and the "PO / Invoice Number" draw block, ~lines 32, 59, 206–211). Confirm the renderer *is* capable of drawing PO when the key is present.
2. `logistics/bol-generator.html` — `collectPayload()` (the object it returns) and the form fields (`id="f-*"`). Confirm whether any field/key supplies `po_number`/`poNumber`. Also confirm whether the form even contains a PO input.
3. `logistics/bol-generator.html` — `doGenerate()` builds `tempBol` from `payload` and passes `[tempBol]` to `BolCompose.reviewRecords(...)`; confirm nothing injects PO between `collectPayload()` and the render.
4. `prefillFromJob()` in `bol-generator.html` — confirm whether the job→BOL prefill maps the job's `po_number` onto the form/payload, or whether it only folds `invoice_number` into another line (e.g., the contact/location line).

Document: (a) the precise reason the PO is blank, (b) whether the data exists upstream (jobs carry `po_number`) but is never plumbed in, (c) the minimal surface a future fix would touch (which file(s), which function(s), whether a new form field is implied), and (d) whether the load-builder/BolCompose path renders PO correctly today (i.e., is this generator-only or platform-wide). Keep it to findings — no edits.

## D. Output

Create one new file at repo root: **`qc-slop-audit.md`**. Structure:

```
# xPanda Ops — QC Slop / Spaghetti Audit
# Generated: <date>  |  Commit: <short SHA of HEAD>  |  REPORT ONLY — no fixes applied

## Executive summary
- Counts by severity (Critical / High / Medium / Low)
- Top 5 highest-leverage findings

## C. PO-to-PDF bug — root cause
<the Section C diagnosis>

## Findings by module
### jobs/ (job-board-agent)
### logistics/ (logistics-agent)
### production/ + manufacturing/ (production-agent)
### qc/ (qc-agent)
### safety/ (safety-agent)
### reports/ (reports-agent)
### admin/ + login.html (admin-auth-agent)
### _worker.js/ (db-api-agent)
### shared/ + root

## Cross-cutting themes
- Abandoned-migration inventory (raw fetch vs api.*, document.write, inline calcs vs utils.*) — tables with file:line counts
- Duplication / drift watch
- Dead / orphaned files

## Appendix: scope exclusions honored
```

Every finding line: `path:line — [SEVERITY] [category] — description — suggested direction (not applied)`.

End the run by printing the path to the report and the severity counts. Do not apply anything.
