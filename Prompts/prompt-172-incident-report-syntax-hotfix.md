# Prompt 172 — Hotfix: incident report customer list broken by malformed function declaration

## Required reading (do this first)
1. Read `AGENTS.md` (platform conventions).
2. Read `xpanda-ops-agents.md` (multi-agent definition).
3. Assume the **qc-agent** role (`qc/*`). Single-file frontend hotfix. No DB, no worker, no permission key.

## Context
On `qc/incident-report.html`, the customer dropdown is stuck on "Loading Customers". The console shows `Uncaught SyntaxError: Unexpected token 'return'` at line 349. Root cause: the `getCheckedDepartments` function declaration (line 348) is missing its parameter list and opening brace `() {`, so the `return` on the next line parses as top-level code. A parse error aborts the **entire** inline `<script>`, so initialization — including the customer fetch — never runs.

`getCheckedDepartments` is live code (the submit handler calls it to collect checked departments), so it must be repaired, not removed.

Byte-exact find/replace, verified to appear exactly once at HEAD. Confirm `count == 1` before applying.

## Edit — repair the function declaration (`qc/incident-report.html`)
FIND (exactly once):
```
    function getCheckedDepartments
      return Array.from(document.querySelectorAll('.checks input[type="checkbox"]:checked'))
```
REPLACE:
```
    function getCheckedDepartments() {
      return Array.from(document.querySelectorAll('.checks input[type="checkbox"]:checked'))
```

The matching `}` already exists below the `.map(...)` line, so this closes the function correctly.

## Validation
`qc/incident-report.html` has inline `<script>` blocks. Extract each with `re.findall` to **real temp files** (do NOT pipe via `/dev/stdin`), then `node --check` each. Confirm **all** blocks pass — a syntax error masks anything after it, so the whole script must parse clean, not just the edited line. Delete temp files after.

## Manual sanity (notes for Steve, no action by Claude Code)
- Open `qc/incident-report.html`: the customer dropdown populates (no longer stuck on "Loading Customers").
- Console is clean of the `Unexpected token 'return'` error.
- Submitting an incident still collects the checked departments correctly.

## What NOT to change
- Do NOT alter the body of `getCheckedDepartments`, the submit handler, or any other function.
- Do NOT touch any other file.
- Do NOT reflow unrelated code (the pre-existing over-indentation near `riskLevel` is cosmetic — leave it).

## Deliverables summary
- `qc/incident-report.html` — one-line declaration fix.
- All inline scripts pass `node --check`.
